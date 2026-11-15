import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillKind } from '../types';

function fixture(maxCharges?: number, kind: SkillKind = 'normal') {
  const build = empressInkomsu440(); build.passiveMods = []; build.bluntThorn = undefined;
  const skill = { id: 'control', name: '쿨 감소 통제', kind, cooldown: 10, castTime: 0, maxCharges, directCoef: 0, hits: 1 };
  build.skills = [skill]; build.params.gaugePerHit.normal = 0;
  const state = new SimState(build, createRng(1), []);
  state.cast(skill, 30); state.advanceTo(2);
  return { state, skill };
}
describe.each([undefined, 2])('original fraction with charges %s', maxCharges => {
  it.each(['0.5', null, true, false, '', undefined, [], {}].map(value => ({ value })))('rejects $value before changing the active recovery', ({ value }) => {
    const { state, skill } = fixture(maxCharges);
    expect(() => state.reduceAllCooldowns(value as number)).toThrow('감소 비율');
    expect(state.readyAt.get(skill.id)).toBe(10); expect(state.now).toBe(2);
  });
  it.each([[0, 10], [0.15, 8.8], [0.3, 7.6], [1, 2], [-0.25, 12]])('preserves numeric fraction %s', (fraction, readyAt) => {
    const { state, skill } = fixture(maxCharges); state.reduceAllCooldowns(fraction);
    expect(state.readyAt.get(skill.id)).toBeCloseTo(readyAt);
  });
});
it('does not inspect a fraction for excluded awakening skills', () => {
  const { state, skill } = fixture(undefined, 'awakening');
  expect(() => state.reduceAllCooldowns(null as unknown as number)).not.toThrow();
  expect(state.readyAt.get(skill.id)).toBe(10);
});
it('does not inspect a fraction outside the target filter', () => {
  const { state, skill } = fixture();
  expect(() => state.reduceAllCooldowns('0.5' as unknown as number, { ids: ['other'] })).not.toThrow();
  expect(state.readyAt.get(skill.id)).toBe(10);
});
it('does not reschedule an already-ready skill', () => {
  const { state, skill } = fixture(); state.readyAt.set(skill.id, 1);
  expect(() => state.reduceAllCooldowns(true as unknown as number)).not.toThrow();
  expect(state.readyAt.get(skill.id)).toBe(1);
});
it('keeps an empty request inert', () => {
  const { state } = fixture(); state.readyAt.clear();
  expect(() => state.reduceAllCooldowns(undefined as unknown as number)).not.toThrow();
});
it('checks a changed rune fraction when its effect runs', () => {
  const { state } = fixture(); const skill = state.skill('control');
  skill.runeCdReduce = { chance: 1, fraction: '0.5' as unknown as number }; state.advanceTo(10);
  expect(() => state.cast(skill, 30)).toThrow('감소 비율');
});
