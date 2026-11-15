import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function fixture(threshold: unknown, stacks = 1) {
  const build = empressInkomsu440(); build.passiveMods = []; build.bluntThorn = undefined; build.onRuinAt4 = [];
  const skill: SkillDef = { id: 'control', name: '스택 유지 최소 조건 통제', kind: 'ruin', cooldown: 10, castTime: 0.5, hits: 1, directCoef: 1,
    keepStacksChance: 1, keepStacksMin: threshold as number };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.ruin = 0;
  build.params.stackEffectCoefPerStack = 1; build.params.stackEffectScale = [0, 1, 2, 3, 4];
  const checks: number[] = [], rng = createRng(1, 'partitioned-v1'), stream = rng.stream!;
  rng.stream = key => JSON.parse(key)[0] === 'keepStacks' ? { ...stream(key), chance(p) { checks.push(p); return p === 1; } } : stream(key);
  const state = new SimState(build, rng, []); state.stacks = stacks;
  return { state, skill, checks, hit: () => state.hit(skill, state.breakdown.get('control')!) };
}

describe.each([0, 1, 4])('stack preservation threshold at %s stacks', stacks => {
  it.each(['1', 'bad', '', true, false, {}, [], NaN, Infinity, -Infinity].map(value => ({ value })))
    ('rejects $value before a preservation trial or stack consumption', ({ value }) => {
      const { state, checks, hit } = fixture(value, stacks);
      expect(hit).toThrow('스택 유지 최소 조건'); expect(checks).toEqual([]); expect(state.stacks).toBe(stacks);
      expect(state.total).toBe(1 + stacks);
    });
});

it.each([
  [undefined, 1, 0], [undefined, 4, 4], [null, 1, 0], [null, 4, 4],
  [0, 1, 1], [-1, 1, 1], [0.5, 1, 1], [1.5, 1, 0], [4.5, 4, 0], [5, 4, 0], [4, 4, 4],
] as const)('keeps threshold %s at %s stacks', (threshold, stacks, remaining) => {
  const { state, checks, hit } = fixture(threshold, stacks); hit();
  expect(state.stacks).toBe(remaining); expect(checks).toEqual(remaining ? [1] : []);
});

it.each([0, undefined, null, false])('leaves the threshold unused for disabled chance %s', chance => {
  const { state, skill, checks, hit } = fixture('bad'); skill.keepStacksChance = chance as unknown as number;
  expect(hit).not.toThrow(); expect(state.stacks).toBe(0); expect(checks).toEqual([]);
});

it('leaves the threshold unused under Judgment with no actual stacks', () => {
  const { state, checks, hit } = fixture('bad', 0);
  state.applyBuff({ id: 'judgment', duration: 1, mod: { bucket: 'critRate', value: 0, source: '통제' } });
  expect(hit).not.toThrow(); expect(checks).toEqual([]); expect(state.stacks).toBe(0);
});

it('leaves the threshold unused for a non-ruin skill', () => {
  const { state, skill, checks, hit } = fixture('bad'); skill.kind = 'normal'; state.build.params.gaugePerHit.normal = 0;
  expect(hit).not.toThrow(); expect(checks).toEqual([]); expect(state.stacks).toBe(1);
});

it('checks a changed threshold on the next hit', () => {
  const { state, skill, checks, hit } = fixture(1); hit();
  skill.keepStacksMin = 'bad' as unknown as number;
  expect(hit).toThrow('스택 유지 최소 조건'); expect(state.stacks).toBe(1); expect(checks).toEqual([1]);
});
