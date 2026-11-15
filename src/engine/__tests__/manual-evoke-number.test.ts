import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const fields = ['coef', 'flat', 'weight'] as const;
function fixture(field: typeof fields[number], value: unknown, empty = false) {
  const build = empressInkomsu440(); build.passiveMods = []; build.bluntThorn = undefined;
  const skill: SkillDef = { id: 'control', name: '격발 수치 통제', kind: 'normal', cooldown: 1, castTime: 0.5, directCoef: 2, directFlat: 3, hits: 1,
    manualEvoke: { duration: 1, placementAt: 0, minRecastDelay: 0, lifetime: 10, recastRecovery: 0, hits: [{ after: 0, weight: 1 }] } };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  if (field === 'coef') skill.directCoef = value as number;
  else if (field === 'flat') skill.directFlat = value as number;
  else skill.manualEvoke!.hits[0]!.weight = value as number;
  if (empty) skill.manualEvoke!.hits = [];
  const state = new SimState(build, createRng(1), []); state.cast(skill, 20);
  expect(state.total).toBe(0);
  return { state, skill, detonate: () => state.cast(skill, 20) };
}
describe.each(fields)('%s before manual detonation', field => {
  const invalid = ['2', true, false, null, undefined, NaN, Infinity, -Infinity, {}, []]
    .filter(value => !(field === 'flat' && value == null));
  it.each(invalid.map(value => ({ value })))('rejects $value at detonation, after an inert installation', ({ value }) => {
    const { state, detonate } = fixture(field, value);
    expect(detonate).toThrow('격발 피해 수치'); expect(state.total).toBe(0);
  });
  it('checks a changed value at the second input', () => {
    const { state, skill, detonate } = fixture(field, 2);
    if (field === 'coef') skill.directCoef = '2' as unknown as number;
    else if (field === 'flat') skill.directFlat = '2' as unknown as number;
    else skill.manualEvoke!.hits[0]!.weight = '2' as unknown as number;
    expect(detonate).toThrow('격발 피해 수치'); expect(state.total).toBe(0);
  });
});
it.each([undefined, null])('preserves optional flat %s as zero', value => {
  const { state, detonate } = fixture('flat', value); detonate(); expect(state.total).toBe(2);
});
it.each([0, -1, 0.5, 1])('preserves finite weight %s', weight => {
  const { state, detonate } = fixture('weight', weight); detonate(); expect(state.total).toBe(5 * weight);
});
it.each([0, -2, 0.25])('preserves finite coefficient %s', coef => {
  const { state, detonate } = fixture('coef', coef); detonate(); expect(state.total).toBe(3 + coef);
});
it('preserves a finite negative flat', () => {
  const { state, detonate } = fixture('flat', -4); detonate(); expect(state.total).toBe(-2);
});
it('does not inspect unused damage for an empty detonation', () => {
  const { state, detonate } = fixture('coef', '2', true);
  expect(detonate).not.toThrow(); expect(state.total).toBe(0);
});
it('does not inspect damage when an installation expires without detonation', () => {
  const { state } = fixture('weight', '2'); state.advanceTo(10);
  expect(state.total).toBe(0); expect(state.readyAt.get('control')).toBe(11);
});
it('checks all weights before scheduling a valid prefix', () => {
  const { state, skill, detonate } = fixture('weight', 1);
  skill.manualEvoke!.hits.push({ after: 0.5, weight: '2' as unknown as number });
  expect(detonate).toThrow('격발 피해 수치'); state.advanceTo(1); expect(state.total).toBe(0);
});
