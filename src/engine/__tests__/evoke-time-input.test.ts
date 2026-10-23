import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { SkillDef } from '../types';

const base: SkillDef = { id: 'evoke', name: '설치 시간 통제', kind: 'normal', cooldown: 10, castTime: 1,
  directCoef: 1, directFlat: 0, hits: 1 };
const split: SkillDef = { ...base, splitEvoke: { duration: 1, placementAt: 0.25, delay: 0.5, window: 3 } };
const manual: SkillDef = { ...base, manualEvoke: { duration: 1, placementAt: 0.25, minRecastDelay: 0,
  lifetime: 5, recastRecovery: 0, hits: [{ after: 0, weight: 1 }] } };
function input(skill: SkillDef) {
  const preset = empressInkomsu440();
  return { ...preset, variant: 'emperor' as const, skills: [skill], passiveMods: [], bluntThorn: undefined,
    onCardUse: [], onDestiny: [], onRuinAt4: [],
    rotation: { ruinPriority: [], stackPriority: [], fillers: [skill.id] },
    params: { ...preset.params, atkBase: 10, raidCaptainRatio: 0, gaugePerHit: { ...preset.params.gaugePerHit, normal: 0 } } };
}
const reversed = [
  { ...split, splitEvoke: { ...split.splitEvoke!, delay: -0.5 } },
  { ...manual, manualEvoke: { ...manual.manualEvoke!, hits: [{ after: -2, weight: 1 }] } },
  { ...manual, manualEvoke: { ...manual.manualEvoke!, recastRecovery: -0.5 } },
];
const invalid: [string, SkillDef][] = [split, manual].flatMap(skill => {
  const key = skill.splitEvoke ? 'splitEvoke' : 'manualEvoke';
  return [
    ...[['duration', 0], ['duration', Infinity], ['placementAt', -0.25], ['placementAt', 1.25]].map(([field, value]) =>
      [`${key} ${field} ${value}`, { ...skill, [key]: { ...skill[key], [field!]: value } }] as [string, SkillDef]),
    [`${key} negative cast`, { ...skill, castTime: -1 }] as [string, SkillDef],
    [`${key} nonfinite cast`, { ...skill, castTime: Infinity }] as [string, SkillDef],
  ];
});
invalid.push(['negative split delay', reversed[0]!],
  ['negative window', { ...split, splitEvoke: { ...split.splitEvoke!, window: -1 } }],
  ['negative wait', { ...manual, manualEvoke: { ...manual.manualEvoke!, minRecastDelay: -1 } }],
  ['negative lifetime', { ...manual, manualEvoke: { ...manual.manualEvoke!, lifetime: -1 } }],
  ['negative recovery', reversed[2]!], ['negative explosion', reversed[1]!]);

describe('saved installation and detonation timing', () => {
  it.each(invalid)('rejects %s before state changes', (_name, skill) => {
    const rng = createRng(1), calls: number[] = [];
    rng.chance = value => { calls.push(value); return false; };
    const state = new SimState(input(skill), rng, []);
    expect(() => state.cast(skill, 2)).toThrow('설치·격발 시각');
    expect(state.now).toBe(0); expect(state.readyAt.size).toBe(0); expect(calls).toEqual([]);
    expect(state.breakdown.get(skill.id)!.casts).toBe(0);
    state.advanceTo(5); expect(state.total).toBe(0); expect(state.readyAt.size).toBe(0);
  });
  it.each(reversed)('rejects serialized time reversal before returning a summary', skill => {
    const build = JSON.parse(JSON.stringify(input(skill)));
    expect(() => simulate(build, [], { durationSec: 2, iterations: 1, seed: 1 })).toThrow('설치·격발 시각');
  });
  it.each([
    [{ ...split, castTime: 0, splitEvoke: { ...split.splitEvoke!, placementAt: 0, delay: 0 } }, [0, 0], 20],
    [manual, [1], 10],
    [{ ...manual, manualEvoke: { ...manual.manualEvoke!, hits: [{ after: 2, weight: 0.25 }, { after: 0, weight: 0.75 }] } }, [1, 3], 10],
    [{ ...manual, manualEvoke: { ...manual.manualEvoke!, hits: [] } }, [], 0],
    [{ ...split, splitEvoke: { ...split.splitEvoke!, window: 0 } }, [0.75], 10],
  ] satisfies [SkillDef, number[], number][])('preserves zero timing, sorted explosion queues, empty hits and zero window', (skill, expected, damage) => {
    const state = new SimState(input(skill), createRng(1), []), hits: number[] = [], hit = state.hit.bind(state);
    state.hit = (...args) => { hits.push(state.now); hit(...args); };
    state.cast(skill, 5);
    if (state.isReady(skill.id)) state.cast(skill, 5);
    state.advanceTo(5);
    expect(hits).toEqual(expected); expect(state.total).toBe(damage);
  });
});
