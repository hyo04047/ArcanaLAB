import { describe, expect, it } from 'vitest';
import { BuffManager } from '../buffs';
import { computeMultipliers } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Bucket, Modifier, SkillDef } from '../types';

const invalid = ['0.2', null, undefined, NaN, Infinity, {}];
const buckets: Bucket[] = ['atk', 'atkFlat', 'addDmg', 'dmgToEnemy', 'evoDmg', 'critRate', 'critDmg',
  'critHitDmg', 'skillDmg', 'emperorCardDmg', 'stackEffectDmg', 'moveSpeed'];
const skill: SkillDef = { id: 'control', name: '통제', kind: 'normal', cooldown: 10, castTime: 1, directCoef: 1, hits: 1 };
const mod = (bucket: Bucket, value: unknown): Modifier => ({ bucket, value: value as number, source: '수치 통제' });

describe('finite numeric modifier values in arithmetic paths', () => {
  it.each(buckets.flatMap(bucket => invalid.map(value => ({ bucket, value }))))('rejects $bucket value $value in damage arithmetic', ({ bucket, value }) => {
    expect(() => computeMultipliers({ atkBase: 1 }, [mod(bucket, value)], { skill, stacks: 4, component: 'stack' }))
      .toThrow('수정치 수치');
  });

  it.each((['cooldown', 'atkSpeed'] as const).flatMap(bucket => invalid.map(value => ({ bucket, value }))))(
    'rejects $bucket value $value outside direct damage', ({ bucket, value }) => {
      const build = empressInkomsu440(); build.passiveMods = [mod(bucket, value)];
      const state = new SimState(build, createRng(1), []);
      expect(() => bucket === 'cooldown' ? state.cooldownMultiplier(skill) : state.atkSpeed()).toThrow('수정치 수치');
    });

  it.each([1, 2].flatMap(stacks => invalid.map(value => ({ stacks, value }))))('rejects a $stacks-stack buff with value $value before scaling', ({ stacks, value }) => {
    const buffs = new BuffManager(), effect = { id: 'control', duration: 3, maxStacks: 2, mod: mod('skillDmg', value) };
    for (let i = 0; i < stacks; i++) buffs.apply(effect, 0);
    expect(() => buffs.modsAt(1)).toThrow('수정치 수치');
  });

  it.each([-0.2, 0, 0.2])('preserves finite signed value %s without mutating the modifier', value => {
    const input = mod('atk', value), before = structuredClone(input);
    expect(computeMultipliers({ atkBase: 10 }, [input], { skill, stacks: 0, component: 'direct' }).atk).toBe(10 * (1 + value));
    expect(input).toEqual(before);
    const build = empressInkomsu440(); build.passiveMods = [mod('cooldown', value)];
    const state = new SimState(build, createRng(1), []);
    expect(state.cooldownMultiplier(skill)).toBe(1 - value);
    build.passiveMods = [mod('atkSpeed', value)]; expect(state.atkSpeed()).toBe(value);
  });

  it('preserves negative stacked effects and repeated grouped cooldown sums', () => {
    const buffs = new BuffManager(), effect = { id: 'control', duration: 3, maxStacks: 2, mod: mod('skillDmg', -0.25) };
    buffs.apply(effect, 0); buffs.apply(effect, 1);
    expect(buffs.modsAt(1)).toEqual([mod('skillDmg', -0.5)]);
    const build = empressInkomsu440();
    build.passiveMods = [0.1, 0.2].map(value => ({ ...mod('cooldown', value), cooldownGroup: 'manaEvolution' }));
    expect(new SimState(build, createRng(1), []).cooldownMultiplier(skill)).toBeCloseTo(0.7);
  });
});
