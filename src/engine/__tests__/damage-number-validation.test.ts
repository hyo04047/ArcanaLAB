import { describe, expect, it } from 'vitest';
import { computeMultipliers, rollHit } from '../damage';
import type { DamageEnv } from '../damage';
import { createRng } from '../rng';
import type { SkillDef } from '../types';

const invalid = ['2', null, undefined, NaN, Infinity, {}];
const skill: SkillDef = { id: 'control', name: '통제', kind: 'normal', cooldown: 1, castTime: 1, hits: 1, directCoef: 1 };
const ctx = { skill, stacks: 0, component: 'direct' as const };
const base = computeMultipliers({ atkBase: 1 }, [], ctx);

describe('finite numeric damage inputs without implicit coercion', () => {
  it.each(invalid)('rejects attack power %s', value => {
    expect(() => computeMultipliers({ atkBase: value as number }, [], ctx)).toThrow('기본 공격력');
  });
  it.each(invalid.filter(value => value !== undefined))('rejects raid captain ratio %s', value => {
    expect(() => computeMultipliers({ atkBase: 1, raidCaptainRatio: value as number }, [], ctx)).toThrow('돌격대장');
  });
  it.each((['base', 'ratio', 'cap'] as const).flatMap(key => invalid.map(value => ({ key, value }))))('rejects blunt thorn $key = $value', ({ key, value }) => {
    const env: DamageEnv = { atkBase: 1, bluntThorn: { base: 0.1, ratio: 0.5, cap: 0.5, [key]: value } as NonNullable<DamageEnv['bluntThorn']> };
    expect(() => computeMultipliers(env, [], ctx)).toThrow('뭉툭한 가시');
  });
  it.each(invalid.flatMap(value => [{ field: 'coef', value }, ...(value === undefined ? [] : [{ field: 'flat', value }])]))(
    'rejects $field = $value before consuming critical RNG', ({ field, value }) => {
      const rng = createRng(1), control = createRng(1);
      expect(() => rollHit(rng, field === 'coef' ? value as number : 1, base, field === 'flat' ? value as number : 0)).toThrow('피해의 계수');
      expect(rng.next()).toBe(control.next());
    });
  it.each([-1, 0, 1])('preserves finite signed value %s and omitted defaults', value => {
    const env = { atkBase: value }, before = structuredClone(env);
    const m = computeMultipliers(env, [], ctx);
    expect(m.atk).toBe(value); expect(env).toEqual(before);
    expect(rollHit(createRng(1), value, base, value).dmg).toBe(value * 2);
    expect(rollHit(createRng(1), 1, base).dmg).toBe(1);
  });
  it('preserves explicit zero ratios and normal blunt thorn arithmetic', () => {
    const m = computeMultipliers({ atkBase: 10, raidCaptainRatio: 0, bluntThorn: { base: 0.1, ratio: 0.5, cap: 0.5 } },
      [{ bucket: 'critRate', value: 1, source: '통제' }], ctx);
    expect(m.critRate).toBe(0.8); expect(m.evoDmg).toBeCloseTo(1.2);
  });
});
