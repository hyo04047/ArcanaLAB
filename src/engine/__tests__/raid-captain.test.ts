import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier, SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-raid-captain-sources.json').official;
function input(equipped = true): RawArmory {
  return structuredClone({ profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'),
    combatSkills: source.find((r: { endpoint: string }) => r.endpoint === 'combat-skills').data,
    engravings: equipped ? { ArkPassiveEffects: source.find((r: { endpoint: string }) => r.endpoint === 'engravings').data.ArkPassiveEffects.filter((e: { Name: string }) => e.Name === '돌격대장') } : null,
    arkpassive: null, arkgrid: null, gems: null });
}
const control: SkillDef = { id: 'control', name: '통제 스킬', kind: 'normal', castTime: 0, cooldown: 0, directCoef: 100, hits: 1 };
function state(equipped = true, move = 0.1) {
  const { build } = buildFromArmory(input(equipped));
  build.passiveMods = [{ bucket: 'moveSpeed', value: move, source: '합성 이속' }];
  build.skills = [control]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  return new SimState(build, createRng(1), cardsFor('empress'));
}
function damage(sim: SimState) { const before = sim.total; sim.cast(control, 100); return sim.total - before; }

describe('Raid Captain conversion and live movement speed', () => {
  it('reads the current engraving coefficient without a permanent swift damage multiplier', () => {
    const { build } = buildFromArmory(input());
    expect(build.params.raidCaptainRatio).toBe(0.4);
    expect(build.passiveMods.some(m => m.bucket === 'dmgToEnemy' && m.source.includes('돌격대장'))).toBe(false);
    expect(build.passiveMods.find(m => m.bucket === 'moveSpeed')?.value).toBeCloseTo(0.03896995708154506);
  });
  it.each([false, true])('does not invent a missing or unreadable engraving, malformed=%s', malformed => {
    const raw = input(malformed);
    if (raw.engravings) raw.engravings.ArkPassiveEffects![0]!.Description = '알 수 없는 조건부 효과';
    const result = buildFromArmory(raw);
    expect(result.build.params.raidCaptainRatio).toBe(0);
    if (malformed) expect(result.warnings.some(w => w.includes('돌격대장') && w.includes('해석 못함'))).toBe(true);
  });
  it('adds Ghost and existing speed before applying one damage multiplier, then expires', () => {
    const sim = state(); expect(damage(sim)).toBeCloseTo(104);
    sim.drawCards(1, 'ghost'); sim.useCardNow('ghost');
    expect(damage(sim)).toBeCloseTo(112); // (1 + (10% + 20%) * 40%), not 1.04 * 1.08
    expect(sim.atkSpeed()).toBe(0);
    sim.advanceTo(16); expect(damage(sim)).toBeCloseTo(104);
  });
  it('never gives Ghost a damage bonus without Raid Captain', () => {
    const sim = state(false, 0.3); sim.drawCards(1, 'ghost'); sim.useCardNow('ghost');
    expect(damage(sim)).toBe(100);
  });
  it.each([[-0.2, 1], [0, 1], [0.3, 1.12], [0.4, 1.16], [0.8, 1.16]])('clamps movement bonus %s for damage %s', (move, expected) => {
    expect(damage(state(true, move))).toBeCloseTo(100 * expected);
  });
  it('refreshes Ghost without stacking it', () => {
    const sim = state(); sim.drawCards(1, 'ghost'); sim.useCardNow('ghost'); sim.advanceTo(10);
    sim.drawCards(1, 'ghost'); sim.useCardNow('ghost'); sim.advanceTo(20);
    expect(damage(sim)).toBeCloseTo(112); sim.advanceTo(26); expect(damage(sim)).toBeCloseTo(104);
  });
  it('uses hit-time speed across delayed impacts and keeps other damage factors multiplicative', () => {
    const sim = state(); const skill = { ...control, castTime: 0,
      delayedHits: { duration: 1, spawnAt: 0, hits: [0.5, 1.5].map(after => ({ after, directCoef: 100, directFlat: 0 })) } };
    sim.build.passiveMods.push({ bucket: 'dmgToEnemy', value: 0.2, source: '다른 각인' });
    sim.applyBuff({ id: 'speed', duration: 1, mod: { bucket: 'moveSpeed', value: 0.3, source: '통제 버프' } });
    sim.cast(skill, 10); sim.advanceTo(2);
    expect(sim.total).toBeCloseTo(100 * 1.2 * (1.16 + 1.04));
  });
  it('keeps attack speed independent and gives no negative damage penalty', () => {
    const mods: Modifier[] = [{ bucket: 'moveSpeed', value: 0.5, source: '이속' }, { bucket: 'moveSpeed', value: -0.3, source: '감속' }, { bucket: 'atkSpeed', value: 0.4, source: '공속' }];
    for (const component of ['direct', 'stack', 'dot'] as const) {
      expect(computeMultipliers({ atkBase: 1, raidCaptainRatio: 0.4 }, mods, { skill: control, stacks: 4, component }).nonCrit).toBeCloseTo(1.08);
    }
  });
  it('reads Safety Device and Light Step separately with their own expiration', () => {
    const { build, warnings } = buildFromArmory(input());
    const safety = build.skills.find(s => s.id === 'scratch_dealer')!.onCast!.find(e => e.mod.bucket === 'moveSpeed');
    const step = build.skills.find(s => s.id === 'spiral_edge')!.onCast!.find(e => e.mod.bucket === 'moveSpeed');
    expect(safety).toMatchObject({ duration: 5, mod: { value: 0.3 } });
    expect(step).toMatchObject({ duration: 2, mod: { value: 0.4 } });
    expect(warnings.some(w => w.includes('돌격대장') && w.includes('시점'))).toBe(true);
    const sim = state(); sim.applyBuff(safety!); sim.applyBuff(step!);
    expect(damage(sim)).toBeCloseTo(116); sim.advanceTo(2); expect(damage(sim)).toBeCloseTo(116);
    sim.advanceTo(5); expect(damage(sim)).toBeCloseTo(104);
  });
  it('warns instead of treating an unknown conditional movement buff as permanent', () => {
    const raw = input();
    const skill = raw.combatSkills.find(s => s.Name === '스파이럴 엣지')!;
    skill.Tripods!.find(t => t.Name === '가벼운 발걸음')!.Tooltip = '특정 조건에서 이동속도가 2.0초간 40.0% 증가한다.';
    const result = buildFromArmory(raw);
    expect(result.build.skills.find(s => s.id === 'spiral_edge')!.onCast?.some(e => e.mod.bucket === 'moveSpeed') ?? false).toBe(false);
    expect(result.warnings.some(w => w.includes('가벼운 발걸음') && w.includes('해석 못함'))).toBe(true);
  });
});
