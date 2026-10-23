import { expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';

it.each(['__proto__', 'constructor', 'toString'])('treats imported cooldown group %s as data', group => {
  const build = empressInkomsu440();
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  build.passiveMods = JSON.parse(JSON.stringify([0.1, 0.2].map(value => ({
    bucket: 'cooldown', cooldownGroup: group, value, source: 'untrusted JSON regression',
  }))));
  const state = new SimState(build, createRng(1), []);
  expect(state.cooldownMultiplier(build.skills[0]!)).toBeCloseTo(0.7);
  expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype);
});
