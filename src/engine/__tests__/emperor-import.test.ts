import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState, runOnce } from '../sim';
import type { Build } from '../types';

function input(): RawArmory {
  const r = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
  return { profiles: r.profiles.data, combatSkills: r['combat-skills'].data, equipment: r.equipment.data,
    arkpassive: r.arkpassive.data, arkgrid: r.arkgrid.data, engravings: r.engravings.data, gems: r.gems.data };
}
function focused(name: string) {
  const raw = input(); raw.combatSkills = raw.combatSkills.filter(s => s.Name === name);
  raw.arkpassive = null; raw.arkgrid = null; raw.engravings = null; raw.gems = null;
  const { build, warnings } = buildFromArmory(raw);
  build.variant = 'emperor'; build.passiveMods = []; build.bluntThorn = undefined; build.stats.swift = 0;
  build.params.gaugeGainBonus = 0; build.params.normalGaugePenalty = 0;
  build.params.gaugePerHit = { normal: 0.1, stack: 0.01, ruin: 0, awakening: 0, hyper_awakening: 0 };
  return { raw, build, warnings };
}
const flower = '댄싱 오브 스파인플라워';
const stampede = '신비한 쇄도';
const skillDamage = (build: Build, id: string) => computeMultipliers({ atkBase: 1 }, build.passiveMods,
  { skill: build.skills.find(s => s.id === id)!, stacks: 0, component: 'direct' }).skillDmg;

describe('Whole Emperor import', () => {
  it('preserves Emperor identity, all 11 gem effects and reconstructed attack power', () => {
    const { build, summary } = buildFromArmory(input()); expect(build.variant).toBe('emperor');
    expect(summary.some(s => s.includes('보석 효과 11개'))).toBe(true);
    expect(build.attackPower?.status).toBe('matched-display'); expect(build.attackPower?.base).toBe(222811);
  });
  it('converts Fake Flip to normal without leaving stack generation or stack priority', () => {
    const { build } = buildFromArmory(input()), s = build.skills.find(s => s.id === 'dancing_of_spineflower')!;
    expect(s.kind).toBe('normal'); expect(s.stacksGranted).toBe(0);
    expect(build.rotation.stackPriority).not.toContain(s.id); expect(build.rotation.fillers).toContain(s.id);
  });
  it('keeps thorn damage without the 14P profile explicitly unresolved', () => {
    const { build, warnings } = focused(flower);
    expect(build.skills[0]!.flowerThornChance).toBeUndefined();
    expect(warnings.some(w => w.includes('페이크 플립 가시') && w.includes('미반영'))).toBe(true);
  });
  it('does not generate stacks on Fake Flip and follows normal gauge/effect filters', () => {
    const { build } = focused(flower), skill = build.skills[0]!;
    build.passiveMods = [{ bucket: 'skillDmg', value: 0.5, filter: { kinds: ['normal'] }, source: '범위 통제' }];
    expect(skillDamage(build, skill.id)).toBe(1.5);
    const sim = new SimState(build, createRng(42), cardsFor('emperor')); sim.cast(skill, 100);
    expect(sim.stacks).toBe(0); expect(sim.deck.gauge).toBeCloseTo(skill.hits * 0.1);
  });
  it('only changes the selected exact Fake Flip tooltip, not other skills or altered clauses', () => {
    const raw = input(), s = raw.combatSkills.find(s => s.Name === flower)!;
    const t = s.Tripods!.find(t => t.Name === '페이크 플립')!;
    t.IsSelected = false; expect(buildFromArmory(raw).build.skills.find(s => s.id === 'dancing_of_spineflower')?.kind).toBe('stack');
    t.IsSelected = true; t.Tooltip = t.Tooltip!.replace('형태로 변경되고', '형태로 생명력이 낮을 때 변경되고');
    expect(buildFromArmory(raw).build.skills.find(s => s.id === 'dancing_of_spineflower')?.kind).toBe('stack');
  });
  it('applies Night Bloom crit damage only to the flower', () => {
    const { build } = focused(flower), skill = build.skills[0]!, mods = skill.mods ?? [];
    expect(computeMultipliers({ atkBase: 1 }, mods, { skill, stacks: 0, component: 'direct' }).critDmg).toBeCloseTo(3.35);
    expect(computeMultipliers({ atkBase: 1 }, mods, { skill: { ...skill, id: 'other' }, stacks: 0, component: 'direct' }).critDmg).toBe(2);
  });
  it('does not silently ignore an added Night Bloom condition', () => {
    const { raw } = focused(flower), t = raw.combatSkills[0]!.Tripods!.find(t => t.Name === '밤에 피는 꽃')!;
    t.Tooltip = t.Tooltip!.replace('치명타 피해가', '체력이 낮을 때 치명타 피해가');
    const { build, warnings } = buildFromArmory(raw);
    expect(build.skills[0]!.mods?.some(m => m.source === '밤에 피는 꽃')).toBe(false);
    expect(warnings.some(w => w.includes('밤에 피는 꽃') && w.includes('미반영'))).toBe(true);
  });
  it('starts with two Stampede uses and preserves the first recovery deadline', () => {
    const { build } = focused(stampede), skill = build.skills[0]!; skill.hitRune = undefined;
    const sim = new SimState(build, createRng(42), cardsFor('emperor'));
    expect(skill.maxCharges).toBe(2); sim.cast(skill, 100); const ready = sim.readyAt.get(skill.id);
    expect(sim.isReady(skill.id)).toBe(true); sim.cast(skill, 100);
    expect(sim.isReady(skill.id)).toBe(false); expect(sim.readyAt.get(skill.id)).toBe(ready);
    sim.advanceTo(ready!); expect(sim.isReady(skill.id)).toBe(true);
  });
  it('checks the first-hit Quick Draw independently for each Stampede use', () => {
    const { build } = focused(stampede), skill = build.skills[0]!; skill.hitRune = undefined;
    build.params.gaugePerHit.normal = 0;
    const rng = { ...createRng(42), chance: vi.fn((p: number) => p === 0.3) };
    const sim = new SimState(build, rng, cardsFor('emperor'));
    sim.cast(skill, 100); sim.cast(skill, 100); expect(sim.cardDraws.quickDraw).toBe(2);
    expect(rng.chance.mock.calls.filter(([p]) => p === 0.3)).toHaveLength(2);
  });
  it('does not enable charges from an unselected or changed strategy', () => {
    const { raw } = focused(stampede), t = raw.combatSkills[0]!.Tripods!.find(t => t.Name === '신비한 전략')!;
    t.IsSelected = false; expect(buildFromArmory(raw).build.skills[0]!.maxCharges).toBeUndefined();
    t.IsSelected = true; t.Tooltip = t.Tooltip!.replace('스택 가능하게', '치명타 적중 후 스택 가능하게');
    expect(buildFromArmory(raw).build.skills[0]!.maxCharges).toBeUndefined();
  });
  it.each([16, 17, 20])('applies Shuffle Dance cooldown and damage together at %sP', point => {
    const raw = input(), slot = raw.arkgrid!.Slots.find(s => s.Name.endsWith('셔플 댄스'))!; slot.Point = point;
    const { build } = buildFromArmory(raw); const without = structuredClone(raw); without.arkgrid!.Slots = without.arkgrid!.Slots.filter(s => !s.Name.endsWith('셔플 댄스'));
    const base = buildFromArmory(without).build;
    expect(build.skills.find(s => s.id === 'unlimited_shuffle')!.cooldown).toBe(point >= 17 ? 44 : 24);
    expect(skillDamage(build, 'unlimited_shuffle') / skillDamage(base, 'unlimited_shuffle')).toBeCloseTo(point >= 17 ? 1.8 : 1);
  });
  it('reads the synthetic ancient value without hard-coding relic damage', () => {
    const raw = input(), slot = raw.arkgrid!.Slots.find(s => s.Name.endsWith('셔플 댄스'))!;
    slot.Tooltip = slot.Tooltip!.replace('80.0%', '90.0%');
    const { build } = buildFromArmory(raw); expect(build.passiveMods.find(m => m.source === '셔플 댄스 17P')?.value).toBe(0.9);
  });
  it('rejects an unknown core name or added condition without applying half the option', () => {
    const raw = input(), slot = raw.arkgrid!.Slots.find(s => s.Name.endsWith('셔플 댄스'))!;
    slot.Tooltip = slot.Tooltip!.replace('언리미티드 셔플의 재사용', '치명타 적중 시 언리미티드 셔플의 재사용');
    let result = buildFromArmory(raw); expect(result.build.skills.find(s => s.id === 'unlimited_shuffle')!.cooldown).toBe(24);
    expect(result.build.passiveMods.some(m => m.source === '셔플 댄스 17P')).toBe(false);
    slot.Name = '알 수 없는 코어'; result = buildFromArmory(raw);
    expect(result.build.skills.find(s => s.id === 'unlimited_shuffle')!.cooldown).toBe(24);
  });
  it('keeps converted normal Flower reachable in the automatic Emperor policy', () => {
    const raw = input(); raw.combatSkills = raw.combatSkills.filter(s => s.Name === flower);
    const { build } = buildFromArmory(raw);
    const result = runOnce(build, cardsFor('emperor'), 1, 60);
    expect(result.breakdown.find(s => s.id === 'dancing_of_spineflower')?.casts).toBeGreaterThan(1);
  });
});
