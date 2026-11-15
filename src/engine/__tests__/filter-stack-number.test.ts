import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillFilter } from '../types';

function fixture(minStacks: unknown, stacks = 0) {
  const build = empressInkomsu440(); build.bluntThorn = undefined;
  build.passiveMods = [{ bucket: 'dmgToEnemy', value: 1, filter: { minStacks: minStacks as number }, source: '최소 스택 통제' }];
  const skill = { id: 'control', name: '조건 통제', kind: 'normal' as const, cooldown: 1, castTime: 0.5, directCoef: 1, hits: 1 };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const state = new SimState(build, createRng(1), []); state.stacks = stacks;
  return { state, hit: () => state.hit(skill, state.breakdown.get(skill.id)!) };
}
describe.each([0, 4])('minimum stack condition at %s stacks', stacks => {
  it.each(['4', 'bad', true, false, null, {}, [], NaN, Infinity, -Infinity].map(value => ({ value })))('rejects $value instead of silently comparing', ({ value }) => {
    const { state, hit } = fixture(value, stacks);
    expect(hit).toThrow('최소 스택 조건'); expect(state.total).toBe(0); expect(state.stacks).toBe(stacks);
  });
});
it.each([
  [undefined, 0, 2], [0, 0, 2], [-1, 0, 2], [4, 0, 1], [4, 3, 1],
  [4, 4, 2], [4.5, 4, 1], [1.5, 1, 1], [1.5, 2, 2], [5, 4, 1],
] as const)('preserves numeric threshold %s at %s stacks', (threshold, stacks, damage) => {
  const { state, hit } = fixture(threshold, stacks); hit(); expect(state.total).toBe(damage);
});
it.each([
  { kinds: ['ruin'] }, { excludeKinds: ['normal'] }, { ids: ['other'] },
] satisfies SkillFilter[])('does not inspect a threshold after skill exclusion %j', filter => {
  const { state, hit } = fixture('bad'); Object.assign(state.build.passiveMods[0]!.filter!, filter);
  hit(); expect(state.total).toBe(1);
});
it('checks a changed threshold when computing damage', () => {
  const { state, hit } = fixture(4); state.build.passiveMods[0]!.filter!.minStacks = 'bad' as unknown as number;
  expect(hit).toThrow('최소 스택 조건'); expect(state.total).toBe(0);
});
