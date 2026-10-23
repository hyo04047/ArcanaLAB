import { coreTestPassives } from './core-fixture';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { empressInkomsu440 } from '../presets';
import { computeMultipliers } from '../damage';
import { createRng } from '../rng';
import { SimState } from '../sim';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function input(point = 17): RawArmory {
  const s = structuredClone(load('tests/fixtures/audit/2026-10-13-hit-buff-sources.json').official.data.find((s: { Name: string }) => s.Name === '스트림 오브 엣지'));
  s.Rune = null;
  const slot = structuredClone(load('tests/fixtures/audit/2026-10-13-stream-core-sources.json').slot);
  slot.Point = point; slot.Gems = [];
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [s],
    arkpassive: coreTestPassives(), arkgrid: { Slots: [slot] }, engravings: null, gems: null };
}
function fixture(raw = input()) {
  const result = buildFromArmory(raw), build = result.build;
  build.passiveMods = []; build.bluntThorn = undefined;
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  const s = build.skills[0]!; s.onCast = []; s.cooldown = 0;
  return { ...result, s, sim: new SimState(build, createRng(1), []) };
}
const bonus = (sim: SimState) => sim.activeMods().filter(m => m.source.includes('스트림') && m.bucket === 'critDmg').reduce((sum, m) => sum + m.value, 0);

describe('Stream core Darkness Edge critical damage', () => {
  it.each([[16, 0], [17, 0.08], [18, 0.08]])('requires the actual 17-point threshold (%s)', (points, expected) => {
    const { sim, s } = fixture(input(points)); sim.cast(s, 20); sim.advanceTo(4.8);
    expect(bonus(sim)).toBeCloseTo(expected, 10);
  });
  it('gains critical damage with the landed hit stacks, never from cast alone', () => {
    const { sim, s, build } = fixture(); sim.cast(s, 0.598);
    expect(bonus(sim)).toBe(0); expect(build.passiveMods.some(m => m.source.includes('스트림') && m.bucket === 'critDmg')).toBe(false);
    sim.advanceTo(0.6); expect(bonus(sim)).toBeCloseTo(0.016);
    sim.advanceTo(0.9); expect(bonus(sim)).toBeCloseTo(0.032);
    sim.advanceTo(1.8); expect(bonus(sim)).toBeCloseTo(0.08);
    sim.advanceTo(4.8); expect(bonus(sim)).toBeCloseTo(0.08);
  });
  it('shares refresh and expiry with Darkness Edge and restarts at one stack', () => {
    const { sim, s } = fixture(); sim.cast(s, 20); sim.advanceTo(7.798);
    expect(bonus(sim)).toBeCloseTo(0.08); expect(sim.buffs.has('darkness_edge', sim.now)).toBe(true);
    sim.advanceTo(7.8); expect(bonus(sim)).toBe(0); expect(sim.buffs.has('darkness_edge', sim.now)).toBe(false);
    sim.cast(s, 8.4); expect(bonus(sim)).toBeCloseTo(0.016);
  });
  it('adds to a separate class critical-damage buff and also applies to identity-card damage', () => {
    const { sim, s } = fixture(); sim.cast(s, 20); sim.advanceTo(2);
    sim.applyBuff({ id: 'arcana_crit_damage', duration: 7, mod: { bucket: 'critDmg', value: 0.775, source: '노출된 어둠' } });
    const card = { ...s, id: 'card_emperor', kind: 'identity_card' as const };
    expect(computeMultipliers({ atkBase: 1 }, sim.activeMods(), { skill: card, stacks: 0, component: 'direct' }).critDmg).toBeCloseTo(2.855);
  });
  it('uses the supplied percentage rather than a hard-coded maximum', () => {
    const raw = input(); raw.arkgrid!.Slots![0]!.Tooltip = raw.arkgrid!.Slots![0]!.Tooltip!.replace('1.6%', '2.0%');
    const { sim, s } = fixture(raw); sim.cast(s, 20); sim.advanceTo(4.8);
    expect(bonus(sim)).toBeCloseTo(0.1);
  });
  it('requires Darkness Edge to be equipped', () => {
    const raw = input(); raw.combatSkills![0]!.Tripods!.forEach(t => { if (t.Name === '다크니스 엣지') t.IsSelected = false; });
    const { sim, s, warnings } = fixture(raw); sim.cast(s, 20); sim.advanceTo(4.8);
    expect(bonus(sim)).toBe(0);
    expect(warnings.some(w => w.includes('17P') && w.includes('다크니스 엣지') && w.includes('미반영'))).toBe(true);
  });
  it('does not apply an unrecognized conditional core sentence', () => {
    const raw = input(); raw.arkgrid!.Slots![0]!.Tooltip = raw.arkgrid!.Slots![0]!.Tooltip!.replace('버프 중첩 당', '버프가 최대일 때 중첩 당');
    const { sim, s, warnings } = fixture(raw); sim.cast(s, 20); sim.advanceTo(4.8);
    expect(bonus(sim)).toBe(0); expect(warnings.some(w => w.includes('17P') && w.includes('미모델'))).toBe(true);
  });
  it('connects the same conditional bonus to the reference preset', () => {
    const build = empressInkomsu440(), s = build.skills.find(s => s.id === 'stream_of_edge')!;
    expect(s.onHit?.find(e => e.mod.bucket === 'critDmg')).toMatchObject({ maxStacks: 5, duration: 3, mod: { value: 0.016 } });
  });
});
