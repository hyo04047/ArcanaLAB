import { describe, expect, it } from 'vitest';
import { BuffManager } from '../buffs';
import type { TimedEffect } from '../types';

const effect: TimedEffect = { id: 'test', duration: 2, mod: { bucket: 'skillDmg', value: 1, source: '통제' } };

describe('timed buff duration validity before state mutation', () => {
  it.each([-1, NaN, Infinity, -Infinity, '2', 'bad', null, undefined, {}, []].flatMap(duration =>
    [false, true].map(existing => ({ duration, existing }))))('rejects $duration with existing=$existing', ({ duration, existing }) => {
    const buffs = new BuffManager();
    if (existing) buffs.apply(effect, 1);
    expect(() => buffs.apply({ ...effect, duration: duration as number }, 2)).toThrow('버프 지속시간');
    expect(buffs.has(effect.id, 2)).toBe(existing);
    expect(buffs.modsAt(2)).toEqual(existing ? [effect.mod] : []);
    expect(buffs.remaining(effect.id, 2)).toBe(existing ? 1 : 0);
  });

  it.each([[Number.MAX_VALUE, Number.MAX_VALUE], [1, Infinity]])('rejects nonfinite expiration for duration %s at %s', (duration, now) => {
    const buffs = new BuffManager();
    expect(() => buffs.apply({ ...effect, duration }, now)).toThrow('버프 지속시간');
    expect(buffs.modsAt(0)).toEqual([]);
  });

  it('keeps zero duration as an immediate expiry, including replacement of an active effect', () => {
    const buffs = new BuffManager(); buffs.apply(effect, 0);
    buffs.apply({ ...effect, duration: 0 }, 1);
    expect(buffs.has(effect.id, 1)).toBe(false); expect(buffs.remaining(effect.id, 1)).toBe(0);
    expect(buffs.modsAt(1)).toEqual([]);
  });

  it('preserves fractional expiry, stacking and refresh without changing the source effect', () => {
    const buffs = new BuffManager(), input = { ...effect, duration: 0.25, maxStacks: 2 };
    const original = structuredClone(input);
    buffs.apply(input, 3); buffs.apply(input, 3.125);
    expect(buffs.has(effect.id, 3.25)).toBe(true); expect(buffs.remaining(effect.id, 3.25)).toBe(0.125);
    expect(buffs.modsAt(3.25)).toEqual([{ ...effect.mod, value: 2 }]);
    expect(buffs.has(effect.id, 3.375)).toBe(false); expect(buffs.modsAt(3.375)).toEqual([]);
    expect(input).toEqual(original);
  });
});
