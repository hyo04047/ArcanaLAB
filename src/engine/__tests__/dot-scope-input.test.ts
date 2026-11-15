import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier, SkillDef } from '../types';

const invalid = ['incldue', 'unknown', '', null, false, true, 0, 1, {}, []];
function fixture(bucket: 'skillDmg' | 'dmgToEnemy', scope: unknown, duration = 1) {
  const build = empressInkomsu440(); build.bluntThorn = undefined;
  const mod: Modifier = { bucket, value: 1, source: '도트 범위 통제', dotScope: scope as Modifier['dotScope'] };
  build.passiveMods = [mod];
  const skill: SkillDef = { id: 'control', name: '도트 범위 통제', kind: 'normal', cooldown: 10, castTime: 0.25, directCoef: 1, hits: 1,
    manaPoison: { coef: 1, flat: 0, duration, maxStacks: 1, firstTick: 0.5, interval: 1 } };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const state = new SimState(build, createRng(1), []), result = state.breakdown.get(skill.id)!;
  state.hit(skill, result);
  return { state, mod, result };
}
describe.each(['skillDmg', 'dmgToEnemy'] as const)('%s dot scope', bucket => {
  it.each(invalid.map(value => ({ value })))('rejects $value at the dot tick', ({ value }) => {
    const { state, result } = fixture(bucket, value);
    expect(() => state.advanceTo(0.5)).toThrow('도트 적용 범위');
    expect(result.dot).toBeUndefined(); expect(result.direct).toBe(2); expect(state.total).toBe(2);
  });
  it.each(invalid.map(value => ({ value })))('does not apply dot scope $value to direct damage', ({ value }) => {
    const { state, result } = fixture(bucket, value); expect(result.direct).toBe(2); expect(state.now).toBe(0);
  });
  it.each([undefined, 'include', 'exclude'])('preserves %s', scope => {
    const { state, result } = fixture(bucket, scope); state.advanceTo(0.5);
    expect(result.dot).toBe(scope === 'include' || (scope === undefined && bucket === 'dmgToEnemy') ? 2 : 1);
  });
  it('checks scope changed between direct damage and its dot tick', () => {
    const { state, mod } = fixture(bucket, 'include'); mod.dotScope = 'incldue' as Modifier['dotScope'];
    expect(() => state.advanceTo(0.5)).toThrow('도트 적용 범위');
  });
  it('does not inspect scope when expiry prevents the tick', () => {
    const { state, result } = fixture(bucket, 'incldue', 0.5);
    expect(() => state.advanceTo(0.5)).not.toThrow(); expect(result.dot).toBeUndefined();
  });
});
it('preserves an explicit dot component without dotScope', () => {
  const { state, mod, result } = fixture('skillDmg', undefined); mod.filter = { component: 'dot' };
  state.advanceTo(0.5); expect(result.dot).toBe(2);
});
it('keeps explicit exclusion above the dot component', () => {
  const { state, mod, result } = fixture('skillDmg', 'exclude'); mod.filter = { component: 'dot' };
  state.advanceTo(0.5); expect(result.dot).toBe(1);
});
