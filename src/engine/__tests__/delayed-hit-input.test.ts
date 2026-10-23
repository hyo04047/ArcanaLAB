import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { SkillDef } from '../types';

const skill: SkillDef = { id: 'delayed', name: '지연 시간 통제', kind: 'normal', cooldown: 10, castTime: 1,
  directCoef: 2, directFlat: 0, hits: 2, delayedHits: { duration: 1, spawnAt: 0.2,
    hits: [0.5, 1.5].map(after => ({ after, directCoef: 1, directFlat: 0 })) } };
function input(current: SkillDef) {
  const preset = empressInkomsu440();
  return { ...preset, skills: [current], passiveMods: [], bluntThorn: undefined, onCardUse: [], onDestiny: [], onRuinAt4: [],
    rotation: { ruinPriority: [], stackPriority: [], fillers: [current.id] },
    params: { ...preset.params, atkBase: 10, raidCaptainRatio: 0, gaugePerHit: { ...preset.params.gaugePerHit, normal: 0 } } };
}
const changed = (times: number[]): SkillDef => ({ ...skill, delayedHits: { ...skill.delayedHits!,
  hits: times.map(after => ({ after, directCoef: 1, directFlat: 0 })) } });

describe('saved delayed hit timing', () => {
  it.each([
    ['reversed', changed([1.5, 0.5])], ['negative delay', changed([-0.5, 0.5])],
    ['nonfinite delay', changed([0.5, Infinity])],
    ['negative spawn', { ...skill, delayedHits: { ...skill.delayedHits!, spawnAt: -0.1 } }],
    ['late spawn', { ...skill, delayedHits: { ...skill.delayedHits!, spawnAt: 1.1 } }],
    ['nonfinite spawn', { ...skill, delayedHits: { ...skill.delayedHits!, spawnAt: Infinity } }],
    ['zero duration', { ...skill, delayedHits: { ...skill.delayedHits!, duration: 0 } }],
    ['negative duration', { ...skill, delayedHits: { ...skill.delayedHits!, duration: -1 } }],
    ['nonfinite duration', { ...skill, delayedHits: { ...skill.delayedHits!, duration: Infinity } }],
    ['negative cast', { ...skill, castTime: -1 }], ['nonfinite cast', { ...skill, castTime: Infinity }],
  ] as const)('rejects %s before changing state or scheduling hits', (_name, current) => {
    const rng = createRng(1), calls: number[] = [];
    rng.chance = probability => { calls.push(probability); return false; };
    const state = new SimState(input(current), rng, []);
    expect(() => state.cast(current, 2)).toThrow('지연 적중 시각');
    expect(state.now).toBe(0); expect(state.readyAt.size).toBe(0);
    expect(state.breakdown.get(current.id)!.casts).toBe(0); expect(calls).toEqual([]);
    state.advanceTo(5); expect(state.total).toBe(0);
  });
  it.each([[1.5, 0.5], [-0.5, 0.5]])('rejects saved JSON timing %j / %j before returning a summary', (...times) => {
    const build = JSON.parse(JSON.stringify(input(changed(times))));
    expect(() => simulate(build, [], { durationSec: 2, iterations: 1, seed: 1 })).toThrow('지연 적중 시각');
  });
  it.each([
    [changed([0, 0, 3]), [0.2, 0.2, 3.2]],
    [{ ...changed([0.25, 3]), castTime: 2 }, [0.65, 3.4]],
    [{ ...changed([0.25, 3]), castTime: 0 }, [0.25, 3]],
    [changed([]), []],
    [{ ...changed([0]), delayedHits: { ...changed([0]).delayedHits!, spawnAt: 1 } }, [1]],
  ] as const)('preserves simultaneous, late, scaled, instant, empty and endpoint impacts', (current, expectedTimes) => {
    const state = new SimState(input(current), createRng(1), []);
    const rows: { at: number; first: boolean; last: boolean }[] = [], hit = state.hit.bind(state);
    state.hit = (...args) => { rows.push({ at: state.now, first: args[2] ?? true, last: args[3] ?? true }); hit(...args); };
    state.cast(current, 5); state.advanceTo(5);
    expect(rows.map(row => row.at)).toEqual(expectedTimes);
    expect(rows.map(row => [row.first, row.last])).toEqual(expectedTimes.map((_at, i) => [i === 0, i === expectedTimes.length - 1]));
    expect(state.total).toBe(expectedTimes.length * 10);
  });
});
