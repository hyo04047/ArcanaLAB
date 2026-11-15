import { describe, expect, it, vi } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function fixture(cooldown: unknown, maxCharges?: number) {
  const skill: SkillDef = { id: 'control', name: '기본 쿨타임 통제', kind: 'normal', cooldown: cooldown as number,
    castTime: 0, directCoef: 1, hits: 1, maxCharges };
  const build = empressInkomsu440(); build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onDestiny = []; build.onRuinAt4 = []; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const rng = createRng(1), chance = vi.spyOn(rng, 'chance');
  return { skill, chance, state: new SimState(build, rng, []) };
}
describe.each([undefined, 2])('base cooldown with charges %s', maxCharges => {
  it.each([null, '1', '', true, false, [], [1], {}].map(cooldown => ({ cooldown })))
    ('rejects $cooldown without scheduling or reset RNG', ({ cooldown }) => {
      const { state, skill, chance } = fixture(cooldown, maxCharges); skill.cdResetChance = 1;
      expect(() => state.cast(skill, 3)).toThrow('기본 쿨타임');
      expect(state.readyAt.size).toBe(0); expect(state.total).toBe(0); expect(chance).not.toHaveBeenCalled();
    });
  it.each([0, 0.5, 1])('keeps numeric %s and its existing recharge behavior', cooldown => {
    const { state, skill } = fixture(cooldown, maxCharges); state.cast(skill, 3);
    if (cooldown === 0 && maxCharges === 2) expect(state.readyAt.has(skill.id)).toBe(false);
    else expect(state.readyAt.get(skill.id)).toBe(cooldown);
    state.advanceTo(cooldown); expect(state.isReady(skill.id)).toBe(true);
  });
});
it('does not consume Wheel when the original cooldown is invalid', () => {
  const { state, skill, chance } = fixture(null); state.nextSkillCdReset = true;
  expect(() => state.cast(skill, 3)).toThrow('기본 쿨타임');
  expect(state.nextSkillCdReset).toBe(true); expect(chance).not.toHaveBeenCalled();
});
it.each(['1', null])('checks the mutated original cooldown before scheduling another recovery (%s)', cooldown => {
  const { state, skill } = fixture(1, 2); state.cast(skill, 3); state.cast(skill, 3);
  skill.cooldown = cooldown as unknown as number;
  expect(() => state.advanceTo(1)).toThrow('기본 쿨타임'); expect(state.readyAt.get(skill.id)).toBe(1);
});
it.each(['wheel', 'chance'])('keeps a valid cooldown reset through %s', mode => {
  const { state, skill } = fixture(10, 2);
  if (mode === 'wheel') state.nextSkillCdReset = true; else skill.cdResetChance = 1;
  state.cast(skill, 3); expect(state.isReady(skill.id)).toBe(true); expect(state.readyAt.size).toBe(0);
});
