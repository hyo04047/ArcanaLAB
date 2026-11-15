import { describe, expect, it } from 'vitest';
import { BuffManager } from '../buffs';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef, TimedEffect } from '../types';

const invalid: unknown[] = [0, -1, 0.5, 1.5, '2', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, []];
const effect: TimedEffect = { id: 'control', duration: 3, mod: { bucket: 'skillDmg', value: 1, source: '통제' } };
const kinds = ['manaPoison', 'fearOfDeath'] as const;
function control(kind: typeof kinds[number], maxStacks = 2) {
  const skill: SkillDef = { id: 'control', name: '통제', kind: 'normal', cooldown: 1, castTime: 0.1, hits: 1, directCoef: 0,
    [kind]: { coef: 1, flat: 0, duration: 3, firstTick: 1, interval: 1, maxStacks } };
  const build = empressInkomsu440(); build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onDestiny = []; build.onRuinAt4 = []; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const sim = new SimState(build, createRng(1), []);
  return { sim, skill, b: sim.breakdown.get(skill.id)! };
}

describe('positive integer stack limits', () => {
  it.each(invalid.flatMap(value => [false, true].map(existing => ({ value, existing }))))(
    'rejects buff limit $value with existing=$existing', ({ value, existing }) => {
      const buffs = new BuffManager(); if (existing) buffs.apply(effect, 0);
      expect(() => buffs.apply({ ...effect, maxStacks: value as number }, 1)).toThrow('중첩 상한');
      expect(buffs.modsAt(1)).toEqual(existing ? [effect.mod] : []);
      expect(buffs.remaining(effect.id, 1)).toBe(existing ? 2 : 0);
    });
  it.each(kinds.flatMap(kind => [...invalid, undefined].flatMap(value => [false, true].map(existing => ({ kind, value, existing })))))(
    'rejects $kind limit $value with existing=$existing', ({ kind, value, existing }) => {
      const { sim, skill, b } = control(kind); if (existing) sim.hit(skill, b);
      const bad = { ...skill, [kind]: { ...skill[kind]!, maxStacks: value as number } };
      expect(() => sim.hit(bad, b)).toThrow('중첩 상한');
      sim.advanceTo(1); expect(b.dot ?? 0).toBe(existing ? 1 : 0);
    });
  it.each([undefined, 1, 2, Number.MAX_SAFE_INTEGER])('preserves buff limit %s and expiry', maxStacks => {
    const buffs = new BuffManager(), input = { ...effect, maxStacks }, before = structuredClone(input);
    for (const now of [0, 0.25, 0.5]) buffs.apply(input, now);
    expect(buffs.modsAt(1)).toEqual([{ ...effect.mod, value: Math.min(maxStacks ?? 1, 3) }]);
    expect(buffs.remaining(effect.id, 1)).toBe(2.5); expect(buffs.modsAt(3.5)).toEqual([]); expect(input).toEqual(before);
  });
  it.each(kinds.flatMap(kind => [1, 2, Number.MAX_SAFE_INTEGER].map(maxStacks => ({ kind, maxStacks })) ))(
    'preserves $kind limit $maxStacks and expiry', ({ kind, maxStacks }) => {
      const { sim, skill, b } = control(kind, maxStacks), before = structuredClone(skill);
      for (let i = 0; i < 3; i++) sim.hit(skill, b);
      sim.advanceTo(1); expect(b.dot).toBe(Math.min(maxStacks, 3));
      sim.advanceTo(4); expect(b.dot).toBe(Math.min(maxStacks, 3) * 2); expect(skill).toEqual(before);
    });
});
