import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier } from '../types';

function fixture(group: unknown, json = false) {
  let build = empressInkomsu440();
  build.skills = [{ id: 'control', name: '쿨감 묶음 통제', kind: 'normal', cooldown: 10, castTime: 0.5, directCoef: 1, hits: 1 }];
  build.passiveMods = [0.2, 0.3].map(value => ({ bucket: 'cooldown', value, source: '쿨감 묶음 통제', cooldownGroup: group as Modifier['cooldownGroup'] }));
  build.bluntThorn = undefined; build.onDestiny = []; build.onRuinAt4 = [];
  build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  if (json) build = JSON.parse(JSON.stringify(build));
  return { build, skill: build.skills[0]!, state: new SimState(build, createRng(1), []) };
}

describe.each([false, true])('cooldown group after JSON roundtrip: %s', json => {
  it.each([null, true, false, 0, 1, {}, [], NaN, Infinity, -Infinity].map(group => ({ group })))
    ('rejects non-string $group before scheduling cooldown', ({ group }) => {
      const { state, skill } = fixture(group, json);
      expect(() => state.cast(skill, 3)).toThrow('쿨감 합산 묶음');
      expect(state.readyAt.size).toBe(0); expect(state.total).toBe(0);
    });
});

it.each([undefined, '', 'manaEvolution', 'nonAwakeningEvolution', 'custom-rule', '__proto__', 'constructor', 'toString'])
  ('preserves string data and missing group %s through serialization', group => {
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
    for (const json of [false, true]) {
      const { state, skill } = fixture(group, json); state.cast(skill, 3);
      expect(state.readyAt.get(skill.id)).toBeCloseTo(group ? 5 : 5.6);
    }
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype);
  });

it('checks a mutated group before starting the next cooldown', () => {
  const { state, skill, build } = fixture('custom-rule'); state.cast(skill, 3); state.advanceTo(6);
  build.passiveMods[0]!.cooldownGroup = {} as Modifier['cooldownGroup'];
  expect(() => state.cast(skill, 9)).toThrow('쿨감 합산 묶음');
  expect(state.readyAt.get(skill.id)).toBe(5); expect(state.total).toBe(1);
});

it('checks a cooldown group supplied by an active buff', () => {
  const { state, skill, build } = fixture('custom-rule');
  state.buffs.apply({ id: 'bad', duration: 1, mod: { ...build.passiveMods[0]!, cooldownGroup: null as unknown as Modifier['cooldownGroup'] } }, 0);
  expect(() => state.cast(skill, 3)).toThrow('쿨감 합산 묶음'); expect(state.readyAt.size).toBe(0);
});

it('leaves an unused group on another bucket alone', () => {
  const { state, skill, build } = fixture({});
  build.passiveMods.forEach(mod => { mod.bucket = 'atk'; }); state.cast(skill, 3);
  expect(state.readyAt.get(skill.id)).toBe(10);
});

it('leaves an excluded skill group alone', () => {
  const { state, skill, build } = fixture({});
  build.passiveMods.forEach(mod => { mod.filter = { ids: ['other'] }; }); state.cast(skill, 3);
  expect(state.readyAt.get(skill.id)).toBe(10);
});
