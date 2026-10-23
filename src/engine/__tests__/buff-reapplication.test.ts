import { describe, expect, it } from 'vitest';
import { BuffManager } from '../buffs';
import type { TimedEffect } from '../types';

const first: TimedEffect = { id: 'first', duration: 2, maxStacks: 5,
  mod: { bucket: 'skillDmg', value: 0.15, source: 'first' } };
const second: TimedEffect = { id: 'second', duration: 10,
  mod: { bucket: 'skillDmg', value: 0.05, source: 'second' } };

describe('expired buff reapplication order', () => {
  it.each([3, 4])('does not depend on an intermediate modifier query at time %s', now => {
    const unqueried = new BuffManager(), queried = new BuffManager();
    for (const buffs of [unqueried, queried]) {
      buffs.apply(first, 0); buffs.apply(first, 1); buffs.apply(second, 1);
    }
    expect(queried.modsAt(now)).toEqual([second.mod]);
    for (const buffs of [unqueried, queried]) buffs.apply(first, now);
    expect(unqueried.modsAt(now)).toEqual(queried.modsAt(now));
    expect(unqueried.modsAt(now)).toEqual([second.mod, first.mod]);
    expect(unqueried.remaining(first.id, now)).toBe(first.duration);
  });

  it('keeps the order and accumulates stacks when the buff is still active', () => {
    const buffs = new BuffManager();
    buffs.apply(first, 0); buffs.apply(second, 0); buffs.apply(first, 1);
    expect(buffs.modsAt(2)).toEqual([{ ...first.mod, value: 0.3 }, second.mod]);
    expect(buffs.remaining(first.id, 2)).toBe(1);
  });
});
