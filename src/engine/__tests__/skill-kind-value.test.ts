import { describe, expect, it, vi } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillKind } from '../types';

function input(kind: unknown) {
  const build = empressInkomsu440(); build.bluntThorn = undefined; build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = [];
  build.passiveMods = [{ bucket: 'dmgToEnemy', value: 1, filter: { kinds: ['normal'] }, source: '분류 통제' }];
  build.skills = [{ id: 'control', name: '분류 통제', kind: kind as SkillKind, stacksGranted: 2,
    cooldown: 10, castTime: 0.5, hits: 1, directCoef: 1 }];
  build.params.atkBase = 1; build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  build.params.stackEffectCoefPerStack = 1; build.params.stackEffectScale = [0, 1, 2, 3, 4];
  return build;
}

const invalid = [undefined, null, false, true, 0, 1, '', 'future-kind', '__proto__', 'constructor', {}, [], ['normal'], ['stack'], ['ruin']];
describe.each([false, true])('actual skill kind after JSON roundtrip: %s', json => {
  it.each(invalid.map(kind => ({ kind })))('rejects invalid kind $kind before state creation', ({ kind }) => {
    const build = input(kind);
    expect(() => new SimState(json ? JSON.parse(JSON.stringify(build)) : build, createRng(1), [])).toThrow('스킬 분류');
  });
});

it.each([
  { kind: 'normal', direct: 2, stack: 0, remaining: 1 },
  { kind: 'stack', direct: 1, stack: 0, remaining: 3 },
  { kind: 'ruin', direct: 1, stack: 1, remaining: 0 },
  { kind: 'hyper_awakening', direct: 1, stack: 0, remaining: 1 },
  { kind: 'awakening', direct: 1, stack: 0, remaining: 1 },
  { kind: 'identity_card', direct: 1, stack: 0, remaining: 1 },
])('preserves the registered kind $kind', ({ kind, direct, stack, remaining }) => {
  const build = input(kind), state = new SimState(build, createRng(1), []), skill = build.skills[0]!;
  state.stacks = 1; state.cast(skill, 3); const result = state.breakdown.get(skill.id)!;
  expect(result.direct).toBe(direct); expect(result.stackEffect).toBe(stack); expect(state.stacks).toBe(remaining);
});

it.each(['cast', 'hit'] as const)('rejects a changed kind before %s changes state or RNG', action => {
  const build = input('normal'), rng = createRng(1), chance = vi.spyOn(rng, 'chance');
  const state = new SimState(build, rng, []), skill = build.skills[0]!, result = state.breakdown.get(skill.id)!;
  state.stacks = 1; Object.assign(skill, { kind: ['normal'] });
  expect(() => action === 'cast' ? state.cast(skill, 3) : state.hit(skill, result)).toThrow('스킬 분류');
  expect([state.now, state.total, state.stacks, state.readyAt.size, result.casts, result.direct, result.stackEffect]).toEqual([0, 0, 1, 0, 0, 0, 0]);
  expect(chance).not.toHaveBeenCalled();
});

it('preserves T tags and unknown filter strings without turning them into actual kinds', () => {
  const build = input('hyper_awakening'); build.skills[0]!.tags = ['normal', 'future-tag'];
  build.passiveMods.push({ bucket: 'dmgToEnemy', value: 5, filter: { kinds: ['future-kind' as SkillKind] }, source: '비매칭' });
  const state = new SimState(build, createRng(1), []); state.cast(build.skills[0]!, 3);
  expect(state.total).toBe(2);
});
