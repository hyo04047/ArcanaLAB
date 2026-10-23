import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { Build } from '../types';

const saved = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-19-duplicate-skill-id-before.json', 'utf8')) as
  { rows: { build: Build }[] };
const build = saved.rows[0]!.build;
const a = build.skills[0]!, b = build.skills[1]!;
const config = { durationSec: 3, iterations: 1, seed: 1 };

describe('unique skill identity in a saved Build', () => {
  it.each([
    [a, b], [b, a], [a, { ...a }], [a, { ...b, id: 'other' }, b],
  ])('rejects a duplicate ID during state construction', (...skills) => {
    const rng = createRng(1), calls: number[] = [];
    rng.chance = value => { calls.push(value); return false; };
    expect(() => new SimState({ ...build, skills }, rng, [])).toThrow('스킬 ID가 중복');
    expect(calls).toEqual([]);
  });
  it.each(saved.rows)('rejects a serialized duplicate without a completed summary', ({ build }) => {
    expect(() => simulate(JSON.parse(JSON.stringify(build)), [], config)).toThrow('스킬 ID가 중복');
  });
  it('allows the same display name for distinct skill IDs', () => {
    const distinct = { ...build, skills: [a, { ...b, id: 'other', name: a.name }],
      rotation: { ...build.rotation, fillers: [a.id, 'other'] } };
    const result = simulate(distinct, [], config);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown.map(skill => skill.name)).toEqual([a.name, a.name]);
    expect(result.breakdown.reduce((sum, skill) => sum + skill.direct, 0)).toBe(100);
  });
  it('allows repeated rotation references to one registered skill', () => {
    const result = simulate({ ...build, skills: [a], rotation: { ...build.rotation, fillers: [a.id, a.id] } }, [], config);
    expect(result.breakdown).toMatchObject([{ id: a.id, casts: 1, direct: 10 }]);
  });
  it('keeps an empty skill set as a zero-damage control', () => {
    const result = simulate({ ...build, skills: [], rotation: { ruinPriority: [], stackPriority: [], fillers: [] } }, [], config);
    expect(result.breakdown).toEqual([]); expect(result.dps.mean).toBe(0);
  });
});
