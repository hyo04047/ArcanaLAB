import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier, SkillFilter } from '../types';

function fixture(component: unknown) {
  const build = empressInkomsu440(); build.bluntThorn = undefined; build.onRuinAt4 = [];
  const mod: Modifier = { bucket: 'dmgToEnemy', value: 1, source: '피해 대상 조건 통제', filter: { component: component as SkillFilter['component'] } };
  build.passiveMods = [mod];
  const skill = { id: 'control', name: '피해 대상 조건 통제', kind: 'ruin' as const, cooldown: 10, castTime: 0.25, hits: 1, directCoef: 1,
    manaPoison: { coef: 1, flat: 0, duration: 1, maxStacks: 1, firstTick: 0.5, interval: 1 } };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.ruin = 0;
  build.params.stackEffectCoefPerStack = 0.25; build.params.stackEffectScale = [0, 1, 2, 3, 4];
  const state = new SimState(build, createRng(1), []); state.stacks = 4; const result = state.breakdown.get('control')!;
  return { state, skill, mod, result, hit: () => state.hit(skill, result) };
}

describe.each(['direct', 'stack', 'dot'])('invalid component at actual %s damage', target => {
  it.each(['diretc', 'unknown', '', null, false, true, 0, 1, {}, []].map(value => ({ value })))('rejects $value', ({ value }) => {
    const { state, mod, result, hit } = fixture(target === 'dot' ? 'dot' : value);
    if (target === 'stack') mod.bucket = 'stackEffectDmg';
    if (target === 'dot') {
      hit(); mod.filter!.component = value as SkillFilter['component'];
      expect(() => state.advanceTo(0.5)).toThrow('피해 대상 조건');
      expect(result.dot).toBeUndefined(); expect(result.direct).toBe(1); expect(result.stackEffect).toBe(1);
    } else {
      expect(hit).toThrow('피해 대상 조건'); expect(result.stackEffect).toBe(0); expect(state.stacks).toBe(4);
      expect(result.direct).toBe(target === 'stack' ? 1 : 0);
    }
  });
});

it.each([undefined, 'direct', 'stack', 'dot'])('preserves valid component %s', component => {
  const { state, result, hit } = fixture(component); hit(); state.advanceTo(0.5);
  expect([result.direct, result.stackEffect, result.dot]).toEqual(['direct', 'stack', 'dot'].map(target => !component || target === component ? 2 : 1));
});

it.each([{ kinds: ['normal'] }, { excludeKinds: ['ruin'] }, { ids: ['other'] }] satisfies SkillFilter[])
  ('leaves a component behind skill exclusion unused %j', filter => {
    const { state, mod, result, hit } = fixture('bad'); Object.assign(mod.filter!, filter);
    hit(); state.advanceTo(0.5); expect([result.direct, result.stackEffect, result.dot]).toEqual([1, 1, 1]);
  });

it('keeps the minimum-stack condition ahead of the component condition', () => {
  const { state, mod, result, hit } = fixture('bad'); mod.filter!.minStacks = 5;
  hit(); state.advanceTo(0.5); expect([result.direct, result.stackEffect, result.dot]).toEqual([1, 1, 1]);
});

it('does not add a damage component condition to cooldown calculation', () => {
  const { state, skill, mod } = fixture('bad'); mod.bucket = 'cooldown'; mod.value = 0.2;
  expect(state.cooldownMultiplier(skill)).toBe(0.8);
});

it('checks the component of an active damage buff', () => {
  const { state, mod, hit } = fixture('bad'); state.build.passiveMods = [];
  state.buffs.apply({ id: 'bad', duration: 1, mod }, 0);
  expect(hit).toThrow('피해 대상 조건'); expect(state.total).toBe(0);
});

it('leaves the component of an expired buff unused', () => {
  const { state, mod, hit } = fixture('bad'); state.build.passiveMods = [];
  state.buffs.apply({ id: 'bad', duration: 0.1, mod }, 0); state.advanceTo(0.2);
  expect(hit).not.toThrow(); expect(state.total).toBe(2);
});
