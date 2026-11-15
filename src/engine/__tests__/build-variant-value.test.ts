import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { runOnce, SimState, simulate } from '../sim';
import type { Build } from '../types';

function input(variant: unknown) {
  const build = empressInkomsu440(); build.variant = variant as Build['variant'];
  build.skills = [{ id: 'control', name: '계열 통제', kind: 'normal', cooldown: 10, castTime: 0.5, hits: 1, directCoef: 1 }];
  build.passiveMods = []; build.bluntThorn = undefined; build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = [];
  build.rotation = { ruinPriority: [], stackPriority: [], fillers: ['control'] };
  build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  return build;
}
const invalid = [undefined, null, false, true, 0, 1, '', 'unknown', 'EMPEROR', [], ['emperor'], {}];
describe.each([false, true])('Build variant after JSON roundtrip: %s', json => {
  it.each(invalid.map(variant => ({ variant })))('rejects invalid variant $variant before state creation', ({ variant }) => {
    const build = input(variant);
    expect(() => new SimState(json ? JSON.parse(JSON.stringify(build)) : build, createRng(1), [])).toThrow('Build 계열');
  });
});

it.each(['empress', 'emperor'] as const)('preserves %s with an empty deck and registered overrides', variant => {
  const build = input(variant), config = { durationSec: 3, iterations: 1, seed: 1 };
  for (const cards of [[], cardsFor(variant), cardsFor(variant, { remove: ['star'], add: ['star'] })]) {
    const state = new SimState(build, createRng(1), cards), once = state.run(3);
    expect(once.totalDamage).toBe(1); expect(once.breakdown[0]!.casts).toBe(1);
    expect(runOnce(build, cards, 1, 3)).toEqual(once);
    expect(simulate(build, cards, config).samples).toEqual([1 / 3]);
  }
});

it.each(['runOnce', 'simulate'] as const)('rejects an invalid variant through %s', method => {
  const build = input('unknown');
  expect(() => method === 'runOnce' ? runOnce(build, [], 1, 3) : simulate(build, [], { durationSec: 3, iterations: 1, seed: 1 })).toThrow('Build 계열');
});
