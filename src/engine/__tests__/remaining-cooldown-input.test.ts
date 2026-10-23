import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { Build, SkillKind } from '../types';

const saved = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-19-remaining-cooldown-input-before.json', 'utf8')) as
  { config: { durationSec: number; iterations: number; seed: number }; rows: { build: Build }[] };
const base = saved.rows[0]!.build;
function fixture(maxCharges?: number, kind: SkillKind = 'normal') {
  const skill = { ...base.skills[0]!, kind, cooldown: 10, castTime: 0, maxCharges, runeCdReduce: undefined };
  const state = new SimState({ ...base, skills: [skill] }, createRng(1), []);
  state.cast(skill, 30); state.advanceTo(2);
  return { state, skill };
}

describe.each([undefined, 2])('remaining cooldown with charges %s', maxCharges => {
  it.each([2, NaN, Infinity, -Infinity, -Number.MAX_VALUE])('rejects an invalid remaining time from fraction %s', fraction => {
    const { state, skill } = fixture(maxCharges);
    expect(() => state.reduceAllCooldowns(fraction)).toThrow('남은 쿨타임');
    expect(state.readyAt.get(skill.id)).toBe(10); expect(state.now).toBe(2);
  });
  it.each([[0, 10], [0.15, 8.8], [0.3, 7.6], [1, 2], [-0.25, 12]])('keeps fraction %s at time %s', (fraction, readyAt) => {
    const { state, skill } = fixture(maxCharges);
    state.reduceAllCooldowns(fraction);
    expect(state.readyAt.get(skill.id)).toBeCloseTo(readyAt);
  });
});
it.each(saved.rows)('does not complete a serialized invalid rune or node', ({ build }) => {
  expect(() => simulate(JSON.parse(JSON.stringify(build)), [], saved.config)).toThrow('남은 쿨타임');
});
it('keeps excluded awakening cooldowns unchanged', () => {
  const { state, skill } = fixture(undefined, 'awakening');
  expect(() => state.reduceAllCooldowns(2)).not.toThrow();
  expect(state.readyAt.get(skill.id)).toBe(10);
});
it('keeps a cooldown outside the target filter unchanged', () => {
  const { state, skill } = fixture();
  expect(() => state.reduceAllCooldowns(2, { ids: ['other'] })).not.toThrow();
  expect(state.readyAt.get(skill.id)).toBe(10);
});
it('does not reschedule an already-ready target or an empty request', () => {
  const { state, skill } = fixture();
  state.readyAt.set(skill.id, 1);
  expect(() => state.reduceAllCooldowns(NaN)).not.toThrow();
  expect(state.readyAt.get(skill.id)).toBe(1);
  state.readyAt.clear(); expect(() => state.reduceAllCooldowns(Infinity)).not.toThrow();
});
it('shortens only the current stored-charge recovery', () => {
  const { state, skill } = fixture(2);
  state.cast(skill, 30);
  state.reduceAllCooldowns(0.5);
  expect(state.readyAt.get(skill.id)).toBe(6);
  state.advanceTo(6); expect(state.readyAt.get(skill.id)).toBe(16);
});
