import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';

function fixture(tags: unknown, json = false) {
  let build = empressInkomsu440(); build.bluntThorn = undefined; build.onRuinAt4 = []; build.onDestiny = [];
  build.passiveMods = [{ bucket: 'dmgToEnemy', value: 1, filter: { kinds: ['normal'] }, source: '태그 통제' }];
  build.skills = [{ id: 'control', name: '태그 통제', kind: 'hyper_awakening', tags: tags as string[],
    cooldown: 10, castTime: 0.5, hits: 1, directCoef: 1 }];
  build.params.atkBase = 1; build.params.gaugePerHit.hyper_awakening = 0;
  build.params.stackEffectCoefPerStack = 1; build.params.stackEffectScale = [0, 1, 2, 3, 4];
  if (json) build = JSON.parse(JSON.stringify(build));
  const state = new SimState(build, createRng(1), []); state.stacks = 4;
  const skill = build.skills[0]!, result = state.breakdown.get(skill.id)!;
  return { state, skill, result, hit: () => state.hit(skill, result) };
}

describe.each([false, true])('skill tags after JSON roundtrip: %s', json => {
  it.each(['abnormal', 'ruined', '', null, false, 0, 1, {}, ['ruin', null], [1]].map(tags => ({ tags })))
    ('rejects invalid tag list $tags during state creation', ({ tags }) => {
      expect(() => fixture(tags, json)).toThrow('스킬 태그');
    });
});

it.each([
  { tags: undefined, direct: 1, stack: 0, remaining: 4 },
  { tags: [], direct: 1, stack: 0, remaining: 4 },
  { tags: ['normal'], direct: 2, stack: 0, remaining: 4 },
  { tags: ['ruin'], direct: 1, stack: 4, remaining: 0 },
  { tags: ['abnormal'], direct: 1, stack: 0, remaining: 4 },
  { tags: ['ruined'], direct: 1, stack: 0, remaining: 4 },
  { tags: ['normal', 'ruin'], direct: 2, stack: 8, remaining: 0 },
  { tags: ['ruin', 'ruin'], direct: 1, stack: 4, remaining: 0 },
])('preserves exact tag list $tags', ({ tags, direct, stack, remaining }) => {
  const { state, result, hit } = fixture(tags); hit();
  expect(result.direct).toBe(direct); expect(result.stackEffect).toBe(stack); expect(state.stacks).toBe(remaining);
});

it.each(['hit', 'cast'])('checks tags changed before the next %s', path => {
  const { state, skill, hit } = fixture(['normal']); hit(); const previous = state.total;
  skill.tags = 'ruined' as unknown as string[];
  expect(() => path === 'hit' ? hit() : state.cast(skill, 3)).toThrow('스킬 태그');
  expect(state.total).toBe(previous); expect(state.stacks).toBe(4); expect(state.readyAt.size).toBe(0);
});

it('checks a tag array mutated after state creation', () => {
  const { state, skill, hit } = fixture(['normal']); skill.tags!.push(null as unknown as string);
  expect(hit).toThrow('스킬 태그'); expect(state.total).toBe(0); expect(state.stacks).toBe(4);
});

it('keeps arbitrary string tags without inferring a known category', () => {
  const { state, result, hit } = fixture(['future-tag', '__proto__', 'constructor']); hit();
  expect(result.direct).toBe(1); expect(result.stackEffect).toBe(0); expect(state.stacks).toBe(4);
});
