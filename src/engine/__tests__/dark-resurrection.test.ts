import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef, SkillBreakdown } from '../types';
import data from '../../../data/dark_resurrection_effects.json';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-damage-sources.json', 'utf8')).official.data.find((s: { Name: string }) => s.Name === '다크 리저렉션');
function input(third = '죽음의 공포', level = 14): RawArmory {
  return { profiles: JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8')),
    combatSkills: [{ ...source, Level: level, Rune: null, Tripods: source.Tripods.map((t: { Name: string }) => ({ ...t, IsSelected: ['꿰뚫는 일격', '퀵 드로', third].includes(t.Name) })) }],
    arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
class Trace extends SimState {
  impacts: { at: number; direct: number; last: boolean }[] = [];
  override hit(s: SkillDef, b: SkillBreakdown, first = true, last = true): void {
    const before = b.direct; super.hit(s, b, first, last);
    if (s.id === 'dark_resurrection') this.impacts.push({ at: this.now, direct: b.direct - before, last });
  }
}
function state(third = '죽음의 공포') {
  const { build } = buildFromArmory(input(third));
  build.passiveMods = []; build.bluntThorn = undefined; build.onCardUse = []; build.onDestiny = [];
  build.params.atkBase = 100; build.params.gaugePerHit.normal = 0;
  const skill = build.skills[0]!; delete skill.defenseIgnore;
  const checks: number[] = [];
  const sim = new Trace(build, { ...createRng(1), chance(p) { if (p === 0.4) checks.push(p); return p === 0.4 || p === 1; } }, cardsFor('empress'));
  return { sim, skill, checks, b: () => sim.breakdown.get(skill.id)! };
}

describe('Dark Resurrection conversion', () => {
  it('uses the official 30% defense ignore rather than the public 60% candidate', () => {
    const r = buildFromArmory(input()); const s = r.build.skills[0]!;
    expect(s.defenseIgnore).toEqual({ chance: 1, fraction: 0.3 });
    expect(s.directCoef).toBeCloseTo(2 * 2.464 + 19.695); expect(s.directFlat).toBe(3698.5);
    expect(s.castTime).toBe(1.4); expect(s.delayedHits!.spawnAt).toBe(0.565);
    expect(s.fearOfDeath).toMatchObject({ duration: 3, firstTick: 0.5, interval: 1, maxStacks: 1 });
    expect(s.fearOfDeath!.coef).toBeCloseTo(4.106 * 1.66, 12);
    expect(s.fearOfDeath!.flat).toBeCloseTo(616.5 * 1.66, 12);
    expect(r.warnings.some(w => w.includes('죽음의 공포') && w.includes('공개 후보'))).toBe(true);
  });
  it('applies Rage damage only to the last hit and crit damage to all direct hits', () => {
    const basic = buildFromArmory(input('')).build.skills[0]!;
    const rage = buildFromArmory(input('분노의 일격')).build.skills[0]!;
    expect(rage.fearOfDeath).toBeUndefined(); expect(rage.castTime).toBe(1.933);
    rage.delayedHits!.hits.forEach((h, i) => {
      const base = basic.delayedHits!.hits[i]!;
      expect(h.directCoef).toBeCloseTo(base.directCoef * (i === 2 ? 1.7 : 1));
      expect(h.directFlat).toBeCloseTo(base.directFlat * (i === 2 ? 1.7 : 1));
    });
    expect(computeMultipliers({ atkBase: 100 }, rage.mods!, { skill: rage, component: 'direct', stacks: 0 }).critDmg).toBe(2.8);
    expect(computeMultipliers({ atkBase: 100 }, rage.mods!, { skill: rage, component: 'dot', stacks: 0 }).critDmg).toBe(2);
  });
  it.each([1, 10, 14, 20])('retains both first-hit instances and the final hit at Lv%s', level => {
    const s = buildFromArmory(input('죽음의 공포', level)).build.skills[0]!;
    expect(s.delayedHits!.hits).toHaveLength(3);
    expect(s.directCoef).toBeCloseTo(data.effects[0]!.apByLevel[level - 1]! * 2 + data.effects[1]!.apByLevel[level - 1]!);
  });
  it('ignores the character-specific poison tooltip damage', () => {
    const a = input(); const b = input();
    b.combatSkills[0]!.Tripods!.find(t => t.Name === '죽음의 공포')!.Tooltip = source.Tripods.find((t: { Name: string }) => t.Name === '죽음의 공포').Tooltip.replace('1,286,200', '999,999,999');
    expect(buildFromArmory(a).build.skills[0]!.fearOfDeath).toEqual(buildFromArmory(b).build.skills[0]!.fearOfDeath);
  });
  it.each(['죽음의 공포', '분노의 일격', '꿰뚫는 일격'])('rejects unknown %s text without guessing its effect', name => {
    const raw = input(name); raw.combatSkills[0]!.Tripods!.find(t => t.Name === name)!.Tooltip = '조건이 바뀐 새 툴팁';
    const r = buildFromArmory(raw);
    expect(r.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    if (name === '죽음의 공포') expect(r.build.skills[0]!.fearOfDeath).toBeUndefined();
    if (name === '꿰뚫는 일격') expect(r.build.skills[0]!.defenseIgnore).toBeUndefined();
    if (name === '분노의 일격') expect(r.build.skills[0]!.delayedHits!.spawnAt).toBe(1);
  });
  it('omits unsupported poison levels and keeps the direct damage fallback labeled', () => {
    const r = buildFromArmory(input('죽음의 공포', 21));
    expect(r.build.skills[0]!.fearOfDeath).toBeUndefined(); expect(r.build.skills[0]!.delayedHits).toBeUndefined();
    expect(r.warnings.some(w => w.includes('죽음의 공포') && w.includes('지원 레벨'))).toBe(true);
  });
  it('labels Dark gems as unknown DOT scope rather than reusing the Evoke exclusion evidence', () => {
    const raw = input(); raw.gems = { Effects: { Skills: [{ Name: '다크 리저렉션', Description: ['피해 44.00% 증가'] }] } };
    const r = buildFromArmory(raw);
    expect(r.build.passiveMods.find(m => m.source === '보석 다크 리저렉션')!.dotScope).toBeUndefined();
    expect(r.warnings.some(w => w.startsWith('죽음의 공포 적용 미확인') && w.includes('보석 다크 리저렉션'))).toBe(true);
  });
});

describe('Dark delayed direct hits and independent poison', () => {
  it('triggers Quick Draw and poison only on the last direct hit after recovery', () => {
    const { sim, skill, checks, b } = state(); sim.cast(skill, 10);
    expect(sim.now).toBe(1.4); expect(sim.impacts).toHaveLength(1); expect(checks).toHaveLength(0); expect(b().dot).toBeUndefined();
    sim.advanceTo(1.864); expect(sim.impacts).toHaveLength(2); expect(checks).toHaveLength(0);
    sim.advanceTo(1.866); expect(sim.impacts).toHaveLength(3); expect(checks).toHaveLength(1); expect(sim.cardDraws.quickDraw).toBe(1);
    expect(b().dot).toBeUndefined(); sim.advanceTo(5);
    expect(b().direct).toBeCloseTo(skill.directCoef * 100 + skill.directFlat!);
    expect(b().dot).toBeCloseTo(3 * (skill.fearOfDeath!.coef * 100 + skill.fearOfDeath!.flat));
    expect(checks).toHaveLength(1); expect(sim.cardDraws.gauge).toBe(0);
  });
  it('keeps projectile and poison intervals fixed when motion is faster', () => {
    const { sim, skill, b } = state(); sim.build.passiveMods = [{ bucket: 'atkSpeed', value: 0.4, source: '합성 공속' }];
    sim.cast(skill, 10); expect(sim.now).toBeCloseTo(1); sim.advanceTo(5);
    sim.impacts.forEach((h, i) => expect(h.at).toBeCloseTo(0.565 / 1.4 + [0, 1.1, 1.3][i]!));
    expect(b().dot).toBeCloseTo(3 * (skill.fearOfDeath!.coef * 100 + skill.fearOfDeath!.flat));
  });
  it('refreshes a single poison rather than stacking or keeping two independent applications', () => {
    const { sim, skill, b } = state(); sim.cast(skill, 10); sim.reduceAllCooldowns(1); sim.cast(skill, 10); sim.advanceTo(7);
    expect(sim.impacts).toHaveLength(6);
    expect(b().dot).toBeCloseTo(4 * (skill.fearOfDeath!.coef * 100 + skill.fearOfDeath!.flat));
  });
  it('keeps Evoke poison and Fear of Death independent even with simultaneous ticks', () => {
    const { sim, skill, b } = state(); sim.cast(skill, 10); sim.advanceTo(0.565 + 1.3);
    const evoke: SkillDef = { id: 'evoke', name: '이보크 통제', kind: 'normal', cooldown: 10, castTime: 1, directCoef: 0, hits: 1,
      manaPoison: { coef: 0.1, flat: 2, duration: 3, maxStacks: 3, firstTick: 0.5, interval: 1 } };
    const eb: SkillBreakdown = { id: 'evoke', name: evoke.name, casts: 1, direct: 0, stackEffect: 0 };
    sim.breakdown.set('evoke', eb); sim.hit(evoke, eb); sim.hit(evoke, eb); sim.advanceTo(6);
    expect(eb.dot).toBe(3 * 2 * 12);
    expect(b().dot).toBeCloseTo(3 * (skill.fearOfDeath!.coef * 100 + skill.fearOfDeath!.flat));
    expect(sim.total).toBeCloseTo(b().direct + b().dot! + eb.dot!);
  });
  it('reads a late buff on poison ticks without granting extra card checks', () => {
    const { sim, skill, b, checks } = state(); sim.cast(skill, 10); sim.advanceTo(2);
    sim.applyBuff({ id: 'late', duration: 1, mod: { bucket: 'dmgToEnemy', value: 1, source: '합성 버프' } });
    sim.advanceTo(6);
    expect(b().dot).toBeCloseTo(4 * (skill.fearOfDeath!.coef * 100 + skill.fearOfDeath!.flat)); expect(checks).toHaveLength(1);
  });
  it.each([[1.864, 2, 0], [2.364, 3, 0], [2.366, 3, 1], [4.366, 3, 3]])('counts only reached direct/DOT events through %ss', (end, hits, ticks) => {
    const { sim, skill, b, checks } = state(); sim.run(end);
    expect(sim.impacts).toHaveLength(hits); expect(checks).toHaveLength(hits === 3 ? 1 : 0);
    expect(b().dot ?? 0).toBeCloseTo(ticks * (skill.fearOfDeath!.coef * 100 + skill.fearOfDeath!.flat));
  });
});
