import { describe, expect, it, vi } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function fixture(value: unknown, maxCharges?: number) {
  const skill: SkillDef = { id: 'control', name: '초기화 확률 통제', kind: 'normal', cooldown: 10,
    castTime: 0.5, directCoef: 1, hits: 1, maxCharges, cdResetChance: value as number };
  const build = empressInkomsu440(); build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = []; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const rng = createRng(1), chance = vi.spyOn(rng, 'chance');
  const state = new SimState(build, rng, []);
  return { state, skill, chance, perform: () => state.cast(skill, 20) };
}

describe.each([undefined, 2])('cooldown reset chance with charges %s', maxCharges => {
  it.each([null, false, '', NaN, '0', true, [], {}, Infinity, -Infinity, -0.1, 1.1].map(value => ({ value })))
    ('rejects $value without damage or cooldown scheduling', ({ value }) => {
      const { state, chance, perform } = fixture(value, maxCharges);
      expect(perform).toThrow('확률'); expect(state.total).toBe(0); expect(state.readyAt.size).toBe(0);
      if (value === null || value === false || value === '' || Number.isNaN(value)) expect(chance).not.toHaveBeenCalled();
    });
  it.each([undefined, 0, 1])('preserves %s and its RNG consumption', value => {
    const { state, chance, perform } = fixture(value, maxCharges); perform();
    expect(state.total).toBe(1);
    expect(state.readyAt.get('control')).toBe(value === 1 ? (maxCharges === 2 ? undefined : 0) : 10);
    expect(chance.mock.calls.map(([p]) => p)).toEqual(value === 1 ? [1, 0] : [0]);
  });
});

it('checks a reset chance changed after an earlier cast', () => {
  const { state, skill, perform } = fixture(0); perform(); state.advanceTo(11);
  skill.cdResetChance = false as unknown as number;
  expect(perform).toThrow('확률'); expect(state.total).toBe(1); expect(state.readyAt.get('control')).toBe(10);
});

it('does not consume a held Wheel on an invalid reset chance', () => {
  const { state, chance, perform } = fixture(false); state.nextSkillCdReset = true;
  expect(perform).toThrow('확률'); expect(state.nextSkillCdReset).toBe(true); expect(chance).not.toHaveBeenCalled();
});

it('leaves a reset chance on an unused skill untouched', () => {
  const { state, skill, perform } = fixture(0);
  state.build.skills.push({ ...skill, id: 'unused', cdResetChance: false as unknown as number }); perform();
  expect(state.total).toBe(1);
});

it('does not roll or inspect reset chance during automatic charge recovery', () => {
  const { state, skill, chance, perform } = fixture(0, 2); perform(); perform();
  expect(state.isReady('control')).toBe(false); skill.cdResetChance = false as unknown as number; chance.mockClear();
  state.advanceTo(10); expect(state.isReady('control')).toBe(true); expect(state.readyAt.get('control')).toBe(20);
  expect(chance).not.toHaveBeenCalled();
});

it('leaves reset chance and Wheel unused when a split Evoke expires without followup', () => {
  const { state, skill, perform } = fixture(false);
  skill.splitEvoke = { duration: 0.5, placementAt: 0.25, delay: 0.5, window: 1 };
  state.nextSkillCdReset = true; perform(); state.advanceTo(1.25);
  expect(state.readyAt.get('control')).toBe(11.25); expect(state.nextSkillCdReset).toBe(true);
});
