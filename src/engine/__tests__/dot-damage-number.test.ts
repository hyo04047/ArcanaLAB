import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { PoisonDamage, SkillDef } from '../types';

const effects = ['manaPoison', 'fearOfDeath'] as const;
function fixture(key: typeof effects[number], field: 'coef' | 'flat', value: unknown, duration = 2) {
  const build = empressInkomsu440(); build.passiveMods = []; build.bluntThorn = undefined;
  const effect: PoisonDamage = { coef: 2, flat: 3, duration, maxStacks: key === 'manaPoison' ? 2 : 1, firstTick: 0.5, interval: 1 };
  effect[field] = value as number;
  const skill: SkillDef = { id: 'control', name: '도트 수치 통제', kind: 'normal', cooldown: 10, castTime: 0.25, directCoef: 0, hits: 1, [key]: effect };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const state = new SimState(build, createRng(1), []), result = state.breakdown.get(skill.id)!;
  state.hit(skill, result); expect(state.total).toBe(0);
  return { state, skill, effect, result };
}
describe.each(effects)('%s original damage', key => {
  describe.each(['coef', 'flat'] as const)('%s', field => {
    it.each(['2', true, false, null, undefined, NaN, Infinity, -Infinity, {}, []].map(value => ({ value })))('rejects $value at the first live tick', ({ value }) => {
      const { state, result } = fixture(key, field, value); state.advanceTo(0.49);
      expect(() => state.advanceTo(0.5)).toThrow('도트 피해 수치');
      expect(state.total).toBe(0); expect(result.dot).toBeUndefined();
    });
    it('checks a value changed after application', () => {
      const { state, effect } = fixture(key, field, 2); effect[field] = '2' as unknown as number;
      expect(() => state.advanceTo(0.5)).toThrow('도트 피해 수치');
    });
  });
  it.each([
    ['coef', 0, 3], ['coef', -2, 1], ['coef', 0.25, 3.25],
    ['flat', 0, 2], ['flat', -4, -2], ['flat', 0.25, 2.25],
  ] as const)('preserves finite %s=%s', (field, value, damage) => {
    const { state, result } = fixture(key, field, value); state.advanceTo(0.5);
    expect(result.dot).toBe(damage); state.advanceTo(1.5); expect(result.dot).toBe(2 * damage);
  });
  it('preserves the configured stack cap', () => {
    const { state, skill, effect, result } = fixture(key, 'coef', 2);
    state.hit(skill, result); state.advanceTo(0.5); expect(result.dot).toBe(5 * effect.maxStacks);
  });
  it('does not inspect damage when expiry prevents the first tick', () => {
    const { state, result } = fixture(key, 'coef', '2', 0.5);
    expect(() => state.advanceTo(0.5)).not.toThrow(); expect(result.dot).toBeUndefined(); expect(state.total).toBe(0);
  });
});
