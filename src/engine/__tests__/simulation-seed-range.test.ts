import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { runOnce, simulate } from '../sim';

const build = empressInkomsu440(), cards = cardsFor('empress');
const config = { durationSec: 10, iterations: 3 };

describe('Monte Carlo seeds across the safe integer range', () => {
  it.each([
    { seed: Number.MAX_SAFE_INTEGER, equivalent: 0xffffffff },
    { seed: Number.MIN_SAFE_INTEGER, equivalent: 1 },
    { seed: -1, equivalent: 0xffffffff },
    { seed: 0x100000001, equivalent: 1 },
  ])('keeps all repetitions identical for equivalent seed $seed', ({ seed, equivalent }) => {
    expect(simulate(build, cards, { ...config, seed })).toEqual(simulate(build, cards, { ...config, seed: equivalent }));
  });

  it('advances the largest accepted seed by 7919 without rounding away a bit', () => {
    const actual = simulate(build, cards, { ...config, seed: Number.MAX_SAFE_INTEGER });
    const expected = [0xffffffff, 7918, 15837].map(seed => runOnce(build, cards, seed, config.durationSec).dps);
    expect(actual.samples).toEqual(expected);
  });

  it('retains the existing repetition sequence for ordinary seeds', () => {
    const actual = simulate(build, cards, { ...config, seed: 42 });
    const expected = [42, 7961, 15880].map(seed => runOnce(build, cards, seed, config.durationSec).dps);
    expect(actual.samples).toEqual(expected);
  });
});
