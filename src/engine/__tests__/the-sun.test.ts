import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { resolveSkillDamage, SKILL_BY_ID } from '../skilldata';
import type { SkillBreakdown, SkillDef } from '../types';
import candidate from '../../../data/sun_effects.json';

const evidence = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-damage-sources.json', 'utf8'));
function input(): RawArmory {
  return { profiles: JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8')),
    combatSkills: [structuredClone(evidence.official.data.find((s: { Name: string }) => s.Name === '더 썬'))],
    arkpassive: { Effects: [{ Name: '깨달음', Description: '깨달음 1티어 황제의 칙령 Lv.3' }] },
    arkgrid: null, engravings: null, gems: null };
}
class Trace extends SimState {
  hits: { id: string; at: number; damage: number; first: boolean; last: boolean }[] = [];
  override hit(s: SkillDef, b: SkillBreakdown, first = true, last = true): void {
    const before = this.total; super.hit(s, b, first, last);
    this.hits.push({ id: s.id, at: this.now, damage: this.total - before, first, last });
  }
}
function state(speed = 1) {
  const { build } = buildFromArmory(input());
  build.passiveMods = [{ bucket: 'atkSpeed', value: speed - 1, source: '합성 공속' }];
  build.params.atkBase = 100; build.params.gaugeGainBonus = 0; build.params.gaugePerHit.hyper_awakening = 0;
  build.onCardUse = []; build.onDestiny = []; build.bluntThorn = undefined;
  const sun = build.skills[0]!;
  const other: SkillDef = { id: 'other', name: '합성 동작', kind: 'normal', cooldown: 10, castTime: 2, directCoef: 0, hits: 1 };
  build.skills.push(other);
  return { sim: new Trace(build, createRng(1), []), sun, other };
}
const impactTimes = (speed = 1) => candidate.motion.hits.map(h => candidate.motion.spawnAt / speed + h.after);

describe('The Sun damage source', () => {
  it('preserves official level 1, T classification, mana and cooldown', () => {
    const r = buildFromArmory(input()); const sun = r.build.skills[0]!;
    expect(sun).toMatchObject({ level: 1, kind: 'hyper_awakening', tags: ['normal'], usesMana: true, cooldown: 80, hits: 5 });
    expect(sun.directCoef).toBeCloseTo(149.714); expect(sun.directFlat).toBe(8985.5);
    expect(sun.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level: 1, effectIds: [193401, 193402] });
    expect(r.warnings.some(w => w.includes('더 썬 Lv1') && w.includes('공개 자료 후보'))).toBe(true);
  });
  it.each([1, 10, 14, 20])('sums exactly four pull hits and one explosion at candidate level %s', level => {
    const s = resolveSkillDamage(SKILL_BY_ID.get('the_sun')!, level);
    expect(s.delayedHits!.hits).toHaveLength(5);
    expect(s.directCoef).toBeCloseTo(candidate.effects.reduce((sum, e) => sum + e.apByLevel[level - 1]! * e.hits, 0));
    expect(s.directFlat).toBeCloseTo(candidate.effects.reduce((sum, e) => sum + (e.flatMinByLevel[level - 1]! + e.flatMaxByLevel[level - 1]!) / 2 * e.hits, 0));
  });
  it('keeps unsupported levels on the labeled fallback without inventing delayed coefficients', () => {
    const s = resolveSkillDamage(SKILL_BY_ID.get('the_sun')!, 21);
    expect(s.delayedHits).toBeUndefined(); expect(s.damageReference!.source).not.toBe('public-coefficient-candidate');
  });
});

describe('The Sun projectile timeline', () => {
  it('allows another cast while late impacts continue and pays the total only once', () => {
    const { sim, sun, other } = state(); sim.cast(sun, 10);
    expect(sim.now).toBe(1.867); expect(sim.hits).toHaveLength(3);
    sim.cast(other, 10);
    const hits = sim.hits.filter(h => h.id === 'the_sun');
    expect(hits.map(h => h.at)).toEqual(impactTimes());
    expect(hits.map(h => [h.first, h.last])).toEqual([[true, false], [false, false], [false, false], [false, false], [false, true]]);
    expect(sim.total).toBeCloseTo(sun.directCoef * 100 + sun.directFlat!);
    expect(sim.breakdown.get('the_sun')!.casts).toBe(1); expect(sim.readyAt.get('the_sun')).toBe(80);
  });
  it.each([1, 1.2, 1.4])('scales spawn and recovery but not flight intervals at speed %s', speed => {
    const { sim, sun } = state(speed); sim.cast(sun, 10);
    expect(sim.now).toBeCloseTo(1.867 / speed); sim.advanceTo(5);
    sim.hits.forEach((h, i) => expect(h.at).toBeCloseTo(impactTimes(speed)[i]!));
    expect(sim.hits[4]!.at - sim.hits[0]!.at).toBeCloseTo(1.2);
  });
  it('reads new and expired buffs at each actual impact', () => {
    const { sim, sun } = state(); sim.cast(sun, 10);
    sim.applyBuff({ id: 'late', duration: impactTimes()[4]! - sim.now, mod: { bucket: 'dmgToEnemy', value: 1, source: '합성 늦은 버프' } });
    sim.advanceTo(4);
    const hits = sun.delayedHits!.hits;
    sim.hits.forEach((h, i) => expect(h.damage / (hits[i]!.directCoef * 100 + hits[i]!.directFlat)).toBeCloseTo([1, 1, 1, 2, 1][i]!, 12));
  });
  it.each([0.946, 1.246, 1.248, 1.868, 2.448])('excludes impacts beyond combat end %s', end => {
    const { sim } = state(); sim.run(end);
    expect(sim.hits.filter(h => h.id === 'the_sun')).toHaveLength(impactTimes().filter(t => t <= end).length);
    expect(sim.now).toBe(end);
  });
  it('does not create projectiles when combat ends before the spawn', () => {
    const { sim, sun } = state(); sim.cast(sun, 0.946); sim.advanceTo(10);
    expect(sim.hits).toHaveLength(0);
  });
  it('preserves pending hits when Wheel permits another cast', () => {
    const { sim, sun } = state(); sim.setNextSkillCooldownReset(); sim.cast(sun, 10); sim.cast(sun, 10); sim.advanceTo(5);
    expect(sim.hits).toHaveLength(10); expect(sim.breakdown.get('the_sun')!.casts).toBe(2);
    expect(sim.total).toBeCloseTo(2 * (sun.directCoef * 100 + sun.directFlat!));
  });
  it('grants placeholder gauge only for reached hits, not again at action end', () => {
    const { sim, sun } = state(); sim.build.params.gaugePerHit.hyper_awakening = 0.1;
    sim.cast(sun, 10); expect(sim.deck.gauge).toBeCloseTo(0.3);
    sim.advanceTo(5); expect(sim.deck.gauge).toBeCloseTo(0.5);
  });
});
