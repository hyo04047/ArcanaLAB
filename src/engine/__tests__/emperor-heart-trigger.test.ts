import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';
import { coreTestPassives } from './core-fixture';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-14-emperor-heart-trigger-sources.json', 'utf8'));
const profile = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-impact-mate-sources.json', 'utf8')).responses.profiles.data;
function input(point = 14): RawArmory {
  const core = structuredClone(source.core); core.Point = point; core.Gems = [];
  return { profiles: profile, combatSkills: [], arkpassive: coreTestPassives(true), arkgrid: { Slots: [core] }, engravings: null, gems: null };
}
function state(point = 14, proc = true, patch: Partial<SkillDef> = {}) {
  const { build } = buildFromArmory(input(point));
  build.passiveMods = []; build.bluntThorn = undefined; build.stats = { crit: 0, spec: 0, swift: 0 };
  build.onDestiny = [{ id: 'test_destiny', duration: 15, mod: { bucket: 'skillDmg', value: 0.1, source: 'test' } }];
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  build.params.raidCaptainRatio = 0;
  const skill: SkillDef = { id: 'test', name: '통제', kind: 'normal', usesMana: true, directCoef: 0, hits: 1, castTime: 1, cooldown: 20, ...patch };
  build.skills = [skill];
  const chance = vi.fn((p: number) => p === 0.18 && proc);
  const sim = new SimState(build, { ...createRng(42), chance }, cardsFor('emperor'));
  const destiny = vi.spyOn(sim, 'triggerDestiny');
  return { sim, skill, chance, destiny };
}

describe('Emperor Heart first-cast trigger with explicit unresolved scope', () => {
  it.each([[13, undefined], [14, 0.18], [17, 0.18], [20, 0.18]] as const)('requires 14P (%s)', (point, probability) => {
    const { build, warnings } = buildFromArmory(input(point));
    expect(build.emperorHeartChance).toBe(probability);
    if (point >= 14) {
      expect(warnings.some(w => w.includes('황제의 심장 14P') && w.includes('첫 시전') && w.includes('미반영'))).toBe(true);
      expect(cardSupplyWarnings(build).some(w => w.includes('황제의 심장 14P') && w.includes('부분 구현'))).toBe(true);
    }
  });
  it.each(['name', 'nodes', 'condition', 'probability'])('does not enable an unknown or ineligible option: %s', change => {
    const raw = input(), core = raw.arkgrid!.Slots[0]!;
    if (change === 'name') core.Name = '질서의 달 코어 : 알 수 없는 코어';
    if (change === 'nodes') raw.arkpassive = coreTestPassives(false);
    if (change === 'condition') core.Tooltip = core.Tooltip!.replace('스택트 스킬과 일반 스킬 사용 시', '생명력이 낮을 때 스택트 스킬과 일반 스킬 사용 시');
    if (change === 'probability') core.Tooltip = core.Tooltip!.replace('18.0%', '118.0%');
    expect(buildFromArmory(raw).build.emperorHeartChance).toBeUndefined();
  });
  it.each(['normal', 'stack'] as const)('rolls once at %s use before any hit, even if the run ends mid-cast', kind => {
    const { sim, skill, chance, destiny } = state(14, true, { kind, hits: 8 });
    const hit = vi.spyOn(sim, 'hit');
    sim.cast(skill, 0.5);
    expect(chance.mock.calls.filter(([p]) => p === 0.18)).toHaveLength(1);
    expect(destiny).toHaveBeenCalledTimes(1); expect(sim.buffs.has('test_destiny', 0)).toBe(true);
    expect(hit).not.toHaveBeenCalled();
  });
  it('does not roll again for delayed hits or create a card without a draw effect', () => {
    const { sim, skill, chance, destiny } = state(14, true, { delayedHits: { duration: 1, spawnAt: 0,
      hits: [1, 2, 3].map(after => ({ after, directCoef: 1, directFlat: 0 })) } });
    sim.cast(skill, 10); sim.advanceTo(4);
    expect(chance.mock.calls.filter(([p]) => p === 0.18)).toHaveLength(1);
    expect(destiny).toHaveBeenCalledTimes(1); expect(sim.cardDraws.destiny).toBe(0);
  });
  it.each([[13, true], [14, false]] as const)('has no destiny for inactive core or failed chance (%s, %s)', (point, proc) => {
    const { sim, skill, chance, destiny } = state(point, proc); sim.cast(skill, 10);
    expect(chance.mock.calls.filter(([p]) => p === 0.18)).toHaveLength(point === 14 ? 1 : 0);
    expect(destiny).not.toHaveBeenCalled();
  });
  it.each(['ruin', 'awakening', 'hyper_awakening', 'identity_card'] as const)('keeps %s outside the confirmed first-cast scope, even with a normal tag', kind => {
    const { sim, skill, chance, destiny } = state(14, true, { kind, tags: ['normal'] }); sim.cast(skill, 10);
    expect(chance.mock.calls.filter(([p]) => p === 0.18)).toHaveLength(0); expect(destiny).not.toHaveBeenCalled();
  });
  it('does not roll on a rejected cast or on card draw/use', () => {
    const { sim, skill, chance, destiny } = state(); sim.readyAt.set(skill.id, 10);
    expect(() => sim.cast(skill, 20)).toThrow('cooldown');
    sim.drawCards(1, 'star'); sim.useCardNow('star');
    expect(chance).not.toHaveBeenCalled(); expect(destiny).not.toHaveBeenCalled();
  });
  it('rolls for each spent charge, not for recovery or an unavailable third charge', () => {
    const { sim, skill, chance, destiny } = state(14, true, { maxCharges: 2 });
    sim.cast(skill, 60); sim.cast(skill, 60); expect(() => sim.cast(skill, 60)).toThrow('cooldown');
    sim.advanceTo(40); expect(destiny).toHaveBeenCalledTimes(2);
    sim.cast(skill, 60); expect(destiny).toHaveBeenCalledTimes(3);
    expect(chance.mock.calls.filter(([p]) => p === 0.18)).toHaveLength(3);
  });
  it.each(['split', 'manual'] as const)('keeps %s Evoke recast unresolved instead of inventing another roll', mode => {
    const patch = mode === 'split'
      ? { splitEvoke: { duration: 1, placementAt: 0, delay: 2, window: 3 } }
      : { manualEvoke: { duration: 1, placementAt: 0, minRecastDelay: 0.5, lifetime: 5, recastRecovery: 0, hits: [{ after: 0, weight: 1 }] } };
    const { sim, skill, chance, destiny } = state(14, true, { id: 'evoke', ...patch });
    sim.cast(skill, 10); sim.cast(skill, 10); sim.advanceTo(6);
    expect(chance.mock.calls.filter(([p]) => p === 0.18)).toHaveLength(1);
    expect(destiny).toHaveBeenCalledTimes(1);
  });
  it('reduces current cooldown through Normal Enhance but applies High Tempo to later cooldowns', () => {
    const { sim, skill } = state();
    sim.build.normalEnhanceCooldown = 0.1;
    sim.build.onDestiny = [{ id: 'high_tempo', duration: 15, mod: { bucket: 'cooldown', value: 0.08, filter: { usesMana: true }, source: 'test' } }];
    sim.cast(skill, 60); expect(sim.readyAt.get(skill.id)).toBe(18);
    sim.advanceTo(2); sim.readyAt.set(skill.id, 2); sim.cast(skill, 60);
    expect(sim.readyAt.get(skill.id)).toBeCloseTo(2 + 20 * 0.92 * 0.9);
  });
});
