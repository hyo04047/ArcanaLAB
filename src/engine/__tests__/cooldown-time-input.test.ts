import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { Build, Modifier } from '../types';

const saved = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-19-cooldown-time-input-before.json', 'utf8')) as
  { config: { durationSec: number; iterations: number; seed: number }; rows: { build: Build }[] };
const base = saved.rows[0]!.build;
const original = { ...base.skills[0]!, cooldown: 1, castTime: 0 };
const reduction = (value: number): Modifier => ({ bucket: 'cooldown', value, source: '쿨 시간 통제' });
function fixture(cooldown = 1, maxCharges?: number, passiveMods: Modifier[] = []) {
  const skill = { ...original, cooldown, maxCharges };
  const build = { ...base, skills: [skill], passiveMods };
  return { skill, build, state: new SimState(build, createRng(1), []) };
}

describe.each([undefined, 2])('effective cooldown with charges %s', maxCharges => {
  it.each([-1, NaN, Infinity])('rejects cooldown %s before scheduling', cooldown => {
    const { state, skill } = fixture(cooldown, maxCharges);
    expect(() => state.cast(skill, 3)).toThrow('쿨타임');
    expect(state.readyAt.size).toBe(0); expect(state.total).toBe(0);
  });
  it.each([2, NaN, Infinity])('rejects an invalid effective reduction %s', value => {
    const { state, skill } = fixture(1, maxCharges, [reduction(value)]);
    expect(() => state.cast(skill, 3)).toThrow('쿨타임');
    expect(state.readyAt.size).toBe(0);
  });
  it('rejects a nonfinite product of finite inputs', () => {
    const { state, skill } = fixture(Number.MAX_VALUE, maxCharges, [reduction(-1)]);
    expect(() => state.cast(skill, 3)).toThrow('쿨타임');
  });
  it.each([[0, 0], [1, 1]])('keeps zero effective cooldown (%s, %s)', (cooldown, value) => {
    const { state, skill } = fixture(cooldown, maxCharges, [reduction(value)]);
    for (let i = 0; i < 3; i++) state.cast(skill, 3);
    expect(state.isReady(skill.id)).toBe(true);
    expect(state.breakdown.get(skill.id)!.casts).toBe(3);
  });
});

it.each(saved.rows)('does not complete a serialized invalid cooldown Build', ({ build }) => {
  expect(() => simulate(JSON.parse(JSON.stringify(build)), [], saved.config)).toThrow('쿨타임');
});
it('checks the current buff when the next stored charge starts recharging', () => {
  const { state, skill } = fixture(1, 2);
  state.cast(skill, 3); state.cast(skill, 3);
  state.applyBuff({ id: 'bad', duration: 3, mod: reduction(2) });
  expect(() => state.advanceTo(2)).toThrow('쿨타임');
  expect(state.now).toBe(1); expect(state.readyAt.get(skill.id)).toBe(1);
});
it('keeps the current buff for a valid next recharge', () => {
  const { state, skill } = fixture(1, 2);
  state.cast(skill, 3); state.cast(skill, 3);
  state.applyBuff({ id: 'half', duration: 3, mod: reduction(0.5) });
  state.advanceTo(1); expect(state.readyAt.get(skill.id)).toBe(1.5);
  state.advanceTo(1.5); expect(state.readyAt.has(skill.id)).toBe(false);
});
it('allows a finite cooldown increase and respects the target filter', () => {
  const invalidOther = { ...reduction(2), filter: { ids: ['other'] } };
  const { state, skill } = fixture(1, undefined, [reduction(-0.2), invalidOther]);
  state.cast(skill, 3); expect(state.readyAt.get(skill.id)).toBe(1.2);
});
it.each(['wheel', 'chance'])('keeps a valid cooldown reset by %s', reset => {
  const { state, skill } = fixture(10, 2);
  if (reset === 'wheel') state.nextSkillCdReset = true;
  else skill.cdResetChance = 1;
  state.cast(skill, 3);
  expect(state.readyAt.has(skill.id)).toBe(false); expect(state.isReady(skill.id)).toBe(true);
});
