import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const fields = ['base', 'scale', 'multiplier'] as const;
function fixture(field: typeof fields[number], value: unknown, candidate = false) {
  const build = empressInkomsu440(); build.combatLevel = 70; build.passiveMods = []; build.bluntThorn = undefined; build.onRuinAt4 = [];
  const skill: SkillDef = { id: candidate ? 'celestial_rain' : 'control', name: '루인 수치 통제', kind: 'ruin', cooldown: 1, castTime: 0.1, directCoef: 0, hits: 1 };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.ruin = 0;
  build.params.stackEffectCoefPerStack = 2; build.params.stackEffectScale = [0, 1, 2, 3, 4];
  if (field === 'base') build.params.stackEffectCoefPerStack = value as number;
  else if (field === 'scale') build.params.stackEffectScale[4] = value as number;
  else skill.stackEffectMultiplier = value as number;
  const state = new SimState(build, createRng(1), []); state.stacks = 4;
  const result = state.breakdown.get(skill.id)!;
  return { state, skill, result, hit: () => state.hit(skill, result) };
}
describe.each(fields)('%s legacy stack factor', field => {
  const invalid = ['2', true, false, null, undefined, NaN, Infinity, -Infinity, {}, []]
    .filter(value => !(field !== 'base' && value == null));
  it.each(invalid.map(value => ({ value })))('rejects $value before stack damage or consumption', ({ value }) => {
    const { state, result, hit } = fixture(field, value);
    expect(hit).toThrow('루인 임시 계산 수치'); expect(result.stackEffect).toBe(0); expect(state.stacks).toBe(4);
  });
});
describe.each(['scale', 'multiplier'] as const)('%s fallback', field => {
  it.each([undefined, null])('preserves %s', value => {
    const { result, hit } = fixture(field, value); hit(); expect(result.stackEffect).toBe(8);
  });
});
it.each([[0, 0], [-2, -8], [0.25, 1]])('preserves finite base %s', (base, damage) => {
  const { result, hit } = fixture('base', base); hit(); expect(result.stackEffect).toBe(damage);
});
it('preserves the multiplication order and fractional factors', () => {
  const { state, skill, result, hit } = fixture('base', 0.3);
  state.build.params.stackEffectScale[4] = 1.25; skill.stackEffectMultiplier = 0.7;
  hit(); expect(result.stackEffect).toBe(0.3 * 1.25 * 0.7);
});
it('does not inspect unused legacy factors on a Lv70 candidate', () => {
  const { state, skill, result, hit } = fixture('base', '2', true);
  state.build.params.stackEffectScale[4] = false as unknown as number; skill.stackEffectMultiplier = true as unknown as number;
  hit(); expect(result.stackEffect).toBe(2380 + 15.894);
});
it('does not inspect legacy factors when no explosion occurs', () => {
  const { state, result, hit } = fixture('base', '2'); state.stacks = 0;
  expect(hit).not.toThrow(); expect(result.stackEffect).toBe(0);
});
it('checks a changed factor at the actual explosion', () => {
  const { state, hit } = fixture('base', 2); state.build.params.stackEffectCoefPerStack = null as unknown as number;
  expect(hit).toThrow('루인 임시 계산 수치');
});
