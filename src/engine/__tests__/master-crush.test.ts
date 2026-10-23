import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { BuffManager } from '../buffs';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const master = load('tests/fixtures/audit/2026-10-13-sun-nodes-details.json').official.data.Effects.find((e: { Description: string }) => e.Description.includes('달인'));
const crush = load('tests/fixtures/audit/2026-10-13-sun-nodes-sources.json').official.data.Effects.find((e: { Description: string }) => e.Description.includes('분쇄'));
const source = load('tests/fixtures/audit/2026-10-13-emperor-damage-sources.json').official.data.find((s: { Name: string }) => s.Name === '다크 리저렉션');
function input(node = master): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'),
    combatSkills: [{ ...source, Tripods: [], Rune: null }], arkpassive: { Effects: [node] }, arkgrid: null, engravings: null, gems: null };
}
function state(node = master) {
  const result = buildFromArmory(input(node)), build = result.build;
  build.passiveMods = build.passiveMods.filter(m => /달인|분쇄/.test(m.source));
  build.bluntThorn = undefined; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const skill: SkillDef = { ...build.skills[0]!, cooldown: 0, castTime: 0, directCoef: 1, directFlat: 0, hits: 1, delayedHits: undefined };
  build.skills = [skill];
  return { ...result, sim: new SimState(build, createRng(1), cardsFor('empress')), skill };
}
const mult = (sim: SimState, skill: SkillDef) => computeMultipliers({ atkBase: 1 }, sim.activeMods(), { skill, stacks: 4, component: 'direct' });

describe('Master and Crush actual tooltips', () => {
  it('starts Master at zero, stacks once per cast and caps at five', () => {
    const { sim, skill, warnings } = state();
    expect(warnings.some(w => w.includes('달인') && w.includes('해석 못함'))).toBe(false);
    expect(mult(sim, skill).critRate).toBe(0); expect(mult(sim, skill).addDmg).toBe(1);
    for (let i = 1; i <= 7; i++) {
      sim.now = i; sim.cast(skill, 100);
      expect(mult(sim, skill).critRate).toBeCloseTo(Math.min(i, 5) * 0.014);
      expect(mult(sim, skill).addDmg).toBeCloseTo(1 + Math.min(i, 5) * 0.017);
    }
  });
  it('refreshes ten seconds and restarts at one after the exact expiry boundary', () => {
    const { sim, skill } = state(); sim.cast(skill, 100); sim.now = 9; sim.cast(skill, 100);
    sim.now = 18.999; expect(mult(sim, skill).critRate).toBeCloseTo(0.028);
    sim.now = 19; expect(mult(sim, skill).critRate).toBe(0);
    sim.cast(skill, 100); expect(mult(sim, skill).critRate).toBeCloseTo(0.014);
  });
  it('does not let lazy cleanup revive expired stacks', () => {
    const effect = { id: 'master', duration: 10, maxStacks: 5, mod: { bucket: 'critRate' as const, value: 0.014, source: 'control' } };
    const buffs = new BuffManager(); buffs.apply(effect, 0); buffs.apply(effect, 1);
    // apply must not rely on a prior modsAt call to clear expired state.
    buffs.apply(effect, 11);
    expect(buffs.modsAt(11)[0]!.value).toBe(0.014);
  });
  it('increments on use even without a hit and never once per hit', () => {
    const { sim, skill } = state(); skill.castTime = 1;
    skill.hitSequence = { duration: 1, hits: [0.2, 0.4, 0.6].map(at => ({ at, directCoef: 1, directFlat: 0 })) };
    sim.cast(skill, 0.1); expect(sim.total).toBe(0); expect(mult(sim, skill).critRate).toBeCloseTo(0.014);
    sim.now = 2; sim.cast(skill, 10); expect(mult(sim, skill).critRate).toBeCloseTo(0.028);
  });
  it('does not add a Master stack from card use, while current stacks affect card damage', () => {
    const { sim, skill } = state(); sim.cast(skill, 100);
    sim.cardDamageCoef.emperor = 100; sim.drawCards(1, 'emperor'); sim.useCardNow('emperor');
    expect(mult(sim, skill).critRate).toBeCloseTo(0.014);
    const card = { ...skill, id: 'card_emperor', kind: 'identity_card' as const };
    expect(mult(sim, card).addDmg).toBeCloseTo(1.017);
  });
  it.each(['hyper_awakening', 'awakening'] as const)('counts the equipped %s cast once', kind => {
    const { sim, skill } = state(); skill.kind = kind;
    sim.cast(skill, 100); expect(mult(sim, skill).critRate).toBeCloseTo(0.014);
  });
  it('feeds excess Master critical chance into Blunt Thorn without lifting its 80 percent crit cap', () => {
    const { build, sim, skill } = state(); for (let i = 0; i < 5; i++) sim.cast(skill, 100);
    const mods = [...sim.activeMods(), { bucket: 'critRate' as const, value: 0.9, source: 'control' }];
    const m = computeMultipliers({ atkBase: 1, bluntThorn: { base: 0.15, ratio: 1.5, cap: 0.75 } }, mods, { skill, stacks: 4, component: 'direct' });
    expect(m.critRate).toBe(0.8); expect(m.evoDmg).toBeCloseTo(1 + 0.15 + 0.17 * 1.5);
    expect(build.passiveMods.some(m => m.source.includes('달인'))).toBe(false);
  });
  it('keeps Crush as additive evolution damage with no buildup', () => {
    const { sim, skill } = state(crush);
    sim.build.passiveMods.push({ bucket: 'evoDmg', value: 0.5, source: 'control' });
    expect(mult(sim, skill).evoDmg).toBe(1.7);
    expect(skill.onCast?.some(e => e.mod.source.includes('달인')) ?? false).toBe(false);
  });
  it('reads supplied stack and duration values without making them permanent', () => {
    const node = structuredClone(master);
    node.ToolTip = node.ToolTip.replace('10초간', '6초간').replace('1.4%', '2.0%').replace('1.7%', '3.0%').replace('5중첩', '3중첩');
    const { sim, skill } = state(node); for (let i = 0; i < 5; i++) sim.cast(skill, 100);
    expect(mult(sim, skill).critRate).toBe(0.06); expect(mult(sim, skill).addDmg).toBe(1.09);
    sim.now = 6; expect(mult(sim, skill).critRate).toBe(0);
  });
  it('warns on changed activation conditions instead of silently applying full stacks', () => {
    const node = structuredClone(master); node.ToolTip = node.ToolTip.replace('스킬 사용시', '스킬 치명타 적중시');
    const { sim, skill, warnings } = state(node); sim.cast(skill, 100);
    expect(mult(sim, skill).critRate).toBe(0);
    expect(warnings.some(w => w.includes('달인') && w.includes('해석 못함'))).toBe(true);
  });
});
