import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Build } from '../types';

const controls = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-19-dot-time-progress-before.json', 'utf8')).rows as
  { key: 'manaPoison' | 'fearOfDeath'; build: Build }[];
describe.each(controls)('$key representable tick progress', ({ key, build }) => {
  it('rejects a positive interval that cannot advance the current tick before adding its damage', () => {
    const rng = createRng(1), state = new SimState(build, rng, []), times: number[] = [];
    rng.chance = () => { times.push(state.now); if (times.length >= 9) throw new Error('test tick budget reached'); return false; };
    state.cast(build.skills[0]!, 2);
    expect(() => state.advanceTo(2)).toThrow('도트 반복 간격');
    expect(times).toEqual([0.25]); expect(state.total).toBe(10);
    expect(state.breakdown.get('control')!.dot).toBeUndefined();
  });
  it('keeps a very small interval when the next tick is representable', () => {
    const valid = structuredClone(build), interval = Number.EPSILON / 2;
    valid.skills[0]![key]!.interval = interval;
    const rng = createRng(1), state = new SimState(valid, rng, []), times: number[] = [];
    rng.chance = () => { times.push(state.now); if (times.length >= 9) throw new Error('test tick budget reached'); return false; };
    state.cast(valid.skills[0]!, 2); state.advanceTo(0.75 + 2 * interval);
    expect(times).toEqual([0.25, 0.75, 0.75 + interval, 0.75 + 2 * interval]);
    expect(state.total).toBe(16);
  });
  it.each([0, 0.5])('expires duration %s without requiring an unused next tick', duration => {
    const valid = structuredClone(build); valid.skills[0]![key]!.duration = duration;
    const state = new SimState(valid, createRng(1), []);
    state.cast(valid.skills[0]!, 2); state.advanceTo(2);
    expect(state.total).toBe(10); expect(state.breakdown.get('control')!.dot).toBeUndefined();
  });
});
