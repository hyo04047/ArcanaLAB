import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { createRng } from '../rng';
import { SimState } from '../sim';

function input(): RawArmory {
  const r = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
  return { profiles: r.profiles.data, combatSkills: r['combat-skills'].data.filter((s: { Name: string }) => s.Name === '리턴'),
    arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
function state(raw = input()) {
  const { build, warnings } = buildFromArmory(raw), skill = build.skills[0]!;
  build.passiveMods = []; build.bluntThorn = undefined; build.onDestiny = []; build.onCardUse = [];
  build.params.atkBase = 10000; build.params.gaugeGainBonus = 0; build.params.normalGaugePenalty = 0;
  build.params.gaugePerHit.normal = 0.1; skill.mods = []; skill.onCast = []; skill.hitRune = undefined; skill.runeCdReduce = undefined;
  const rng = { ...createRng(1), chance: vi.fn((_p: number) => false) };
  return { build, warnings, skill, rng, sim: new SimState(build, rng, []) };
}
describe('Imported Return uses the synergy first input', () => {
  it.each([[10, 2.576], [14, 3.147], [20, 4.364]])('uses only the throw at level %s', (level, coefficient) => {
    const raw = input(); raw.combatSkills[0]!.Level = level!;
    const { skill, sim } = state(raw); sim.cast(skill, 10);
    expect(skill.directCoef).toBe(coefficient); expect(skill.directFlat).toBe(472); expect(skill.hits).toBe(1);
    expect(sim.total).toBeCloseTo(472 + coefficient! * 10000);
    expect(sim.deck.gauge).toBeCloseTo(0.1); expect(sim.now).toBeCloseTo(0.708);
    expect(skill.damageReference).toMatchObject({ effectIds: [192600] });
  });
  it.each([[0.299, false], [0.3, true]])('starts the self buff and synergy only on impact at %s', (end, hit) => {
    const { skill, sim } = state(); sim.cast(skill, end as number);
    expect(sim.buffs.has('arcana_crit_damage', sim.now)).toBe(hit);
    expect(sim.buffs.has('arcana_crit_resistance', sim.now)).toBe(hit);
    expect(sim.total > 0).toBe(hit);
  });
  it('does not refresh the first-hit buff at a nonexistent second hit', () => {
    const { skill, sim } = state(); sim.cast(skill, 10); sim.advanceTo(7.3);
    expect(sim.buffs.has('arcana_crit_damage', sim.now)).toBe(false);
    expect(sim.deck.gauge).toBeCloseTo(0.1);
  });
  it('only has one corrosion and hit-rune opportunity', () => {
    const { skill, sim, rng } = state(); skill.hitRune = { kind: 'conviction', chance: 0.4, duration: 3 };
    sim.applyBuff({ id: 'corrosion_window', duration: 10, mod: { bucket: 'critRate', value: 0, source: '통제' } });
    sim.cast(skill, 10);
    expect(rng.chance.mock.calls.filter(([p]) => p === 0.3)).toHaveLength(1);
    expect(rng.chance.mock.calls.filter(([p]) => p === 0.4)).toHaveLength(1);
  });
  it('uses the basic motion if Exposed Darkness was not successfully parsed', () => {
    const raw = input(), t = raw.combatSkills[0]!.Tripods!.find(t => t.Name === '노출된 어둠')!;
    t.IsSelected = false; expect(state(raw).skill.hitSequence?.hits[0]?.at).toBe(0.301);
    t.IsSelected = true; t.Tooltip = t.Tooltip!.replace('적중 시', '조건 충족 후 적중 시');
    expect(state(raw).skill.hitSequence?.hits[0]?.at).toBe(0.301);
  });
  it('applies own casting speed and global attack speed to the first phase', () => {
    const { build, skill } = state(); skill.castTime /= 1.12;
    build.passiveMods = [{ bucket: 'atkSpeed', value: 0.4, source: '통제' }];
    const sim = new SimState(build, createRng(1), []); sim.cast(skill, 10);
    expect(sim.now).toBeCloseTo(0.708 / 1.12 / 1.4);
    expect(sim.deck.gauge).toBeCloseTo(0.1);
  });
  it('keeps first-phase recovery and cooldown-start uncertainty visible', () => {
    const { warnings } = state();
    expect(warnings.some(w => w.includes('리턴') && w.includes('첫 입력') && w.includes('쿨 시작') && w.includes('미검증'))).toBe(true);
  });
});
