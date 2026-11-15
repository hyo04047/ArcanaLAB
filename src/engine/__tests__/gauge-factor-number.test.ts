import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const fields = ['perHit', 'gainBonus', 'chainBonus', 'multiplier', 'normalPenalty'] as const;
function fixture(field: typeof fields[number], value: unknown) {
  const build = empressInkomsu440(); build.passiveMods = []; build.bluntThorn = undefined;
  const skill: SkillDef = { id: 'control', name: '게이지 통제', kind: 'normal', cooldown: 1, castTime: 0.5, directCoef: 0, hits: 1 };
  build.skills = [skill]; build.chainDraw = undefined;
  build.params.gaugePerHit.normal = 0.1; build.params.gaugePerHit.stack = 0.1;
  build.params.gaugeGainBonus = 0; build.params.normalGaugePenalty = 0;
  if (field === 'perHit') build.params.gaugePerHit.normal = value as number;
  else if (field === 'gainBonus') build.params.gaugeGainBonus = value as number;
  else if (field === 'chainBonus') build.chainDraw = { gaugeBonus: value as number };
  else if (field === 'multiplier') skill.gaugeMultiplier = value as number;
  else build.params.normalGaugePenalty = value as number;
  const state = new SimState(build, createRng(1), cardsFor('empress'));
  return { state, skill, hit: () => state.hit(skill, state.breakdown.get(skill.id)!) };
}
describe.each(fields)('%s gauge factor', field => {
  const invalid = ['0.5', true, false, null, undefined, NaN, Infinity, -Infinity, {}, []]
    .filter(value => !(['chainBonus', 'multiplier'].includes(field) && value == null));
  it.each(invalid.map(value => ({ value })))('rejects $value before changing gauge or drawing cards', ({ value }) => {
    const { state, hit } = fixture(field, value);
    expect(hit).toThrow('게이지 계산 수치'); expect(state.deck.gauge).toBe(0); expect(state.cardDraws.gauge).toBe(0);
  });
});
describe.each(['chainBonus', 'multiplier'] as const)('%s default', field => {
  it.each([undefined, null])('preserves %s', value => {
    const { state, hit } = fixture(field, value); hit(); expect(state.deck.gauge).toBeCloseTo(0.1);
  });
});
it('preserves additive bonuses, multiplicative factors and the normal penalty', () => {
  const { state, skill, hit } = fixture('gainBonus', 0.5);
  state.build.chainDraw = { gaugeBonus: 0.15 }; skill.gaugeMultiplier = 1.4; skill.hits = 3;
  state.build.params.normalGaugePenalty = -0.5; hit();
  expect(state.deck.gauge).toBeCloseTo(0.1 * 3 * 1.65 * 1.4 * 0.5);
});
it('preserves zero gain', () => {
  const { state, hit } = fixture('perHit', 0); hit(); expect(state.deck.gauge).toBe(0); expect(state.cardDraws.gauge).toBe(0);
});
it('retains the final negative-gain rejection', () => {
  const { state, hit } = fixture('gainBonus', -2);
  expect(hit).toThrow('게이지 증가'); expect(state.deck.gauge).toBe(0);
});
it('preserves finite negative factors when the resulting gain is valid', () => {
  const { state, hit } = fixture('gainBonus', -2); state.build.params.gaugePerHit.normal = -0.1;
  hit(); expect(state.deck.gauge).toBeCloseTo(0.1);
});
it('does not inspect the normal penalty for a stack skill', () => {
  const { state, skill, hit } = fixture('normalPenalty', '0.5'); skill.kind = 'stack';
  hit(); expect(state.deck.gauge).toBeCloseTo(0.1);
});
it('does not look up base gauge for an identity card', () => {
  const { state, skill, hit } = fixture('normalPenalty', '0.5'); skill.kind = 'identity_card';
  hit(); expect(state.deck.gauge).toBe(0);
});
it('checks a changed factor at the actual hit', () => {
  const { state, hit } = fixture('gainBonus', 0); state.build.params.gaugeGainBonus = '0.5' as unknown as number;
  expect(hit).toThrow('게이지 계산 수치'); expect(state.cardDraws.gauge).toBe(0);
});
