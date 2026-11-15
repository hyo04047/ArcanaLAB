import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { enlightenmentEffects } from '../enlightenmentSettings';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const load = (variant: string): RawArmory => JSON.parse(readFileSync(
  `tests/fixtures/audit/2026-10-28-gem-settings/input-${variant}.json`, 'utf8')).setting.baseline.raw;
const raw = load('emperor');
const greed = enlightenmentEffects.find(row => row.nodeId === 'empress_greed')!;
raw.arkpassive!.Effects.push(structuredClone(greed.effect));
const imported = buildFromArmory(raw).build;
delete imported.params.gaugeFactors; // 기존 저장 입력의 합산·일반 감소 계약을 유지합니다.
const sun = imported.skills.find(skill => skill.id === 'the_sun')!;
const devil = buildFromArmory(load('empress')).build.skills.find(skill => skill.id === 'the_devil')!;
// One isolated hit: keep official category and parsed passive values, disable unrelated procs.
function gauge(skill: SkillDef, penalty = imported.params.normalGaugePenalty, wealth = 1) {
  const probe: SkillDef = { id: skill.id, name: skill.name, kind: skill.kind, tags: skill.tags,
    hits: 1, directCoef: 0, cooldown: 1, castTime: 1, gaugeMultiplier: wealth };
  const state = new SimState({ ...imported, passiveMods: [], skills: [probe],
    chainDraw: undefined, ruinFullset: undefined, onRuinAt4: [],
    params: { ...imported.params, normalGaugePenalty: penalty } }, createRng(1), cardsFor('emperor'));
  state.hit(probe, state.breakdown.get(probe.id)!);
  return state.deck.gauge;
}

describe('stored Greed normal-skill condition reaches gauge calculation', () => {
  it('retains the official Sun category and the stored 50% penalty', () => {
    expect(sun.kind).toBe('hyper_awakening'); expect(sun.tags).toContain('normal');
    expect(imported.params.normalGaugePenalty).toBe(-0.5);
    expect(greed.effect.ToolTip).toContain('50.0%');
  });
  it.each([1, 1.4])('reduces Sun gauge with wealth multiplier %s without changing the base or bonus', wealth => {
    const expected = imported.params.gaugePerHit.hyper_awakening * (1 + imported.params.gaugeGainBonus) * wealth / 2;
    expect(gauge(sun, -0.5, wealth)).toBeCloseTo(expected, 14);
    expect(gauge(sun, -0.5, wealth)).toBeCloseTo(gauge(sun, 0, wealth) / 2, 14);
  });
  it.each([
    ['normal', { ...sun, kind: 'normal', tags: [] }, 0.5],
    ['Devil', devil, 1],
    ['stack', { ...sun, kind: 'stack', tags: [] }, 1],
    ['unclassified T', { ...sun, tags: [] }, 1],
    ['awakening', { ...sun, kind: 'awakening', tags: [] }, 1],
  ] as [string, SkillDef, number][])('keeps the %s scope', (_, skill, ratio) => {
    expect(gauge(skill)).toBeCloseTo(gauge(skill, 0) * ratio, 14);
  });
  it('rejects a non-finite penalty when the normal T target actually uses it', () => {
    expect(() => gauge(sun, Infinity)).toThrow('유한한 숫자');
  });
});
