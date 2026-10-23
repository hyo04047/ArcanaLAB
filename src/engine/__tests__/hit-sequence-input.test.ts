import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { SkillDef } from '../types';

const skill: SkillDef = { id: 'timed', name: '적중 시간 통제', kind: 'normal', cooldown: 10, castTime: 1,
  directCoef: 2, directFlat: 0, hits: 2, hitSequence: { duration: 1,
    hits: [0.2, 0.8].map(at => ({ at, directCoef: 1, directFlat: 0 })) } };
function input(current: SkillDef) {
  const preset = empressInkomsu440();
  return { ...preset, skills: [current], passiveMods: [], bluntThorn: undefined,
    onCardUse: [], onDestiny: [], onRuinAt4: [],
    rotation: { ruinPriority: [], stackPriority: [], fillers: [current.id] },
    params: { ...preset.params, atkBase: 10, raidCaptainRatio: 0, gaugePerHit: { ...preset.params.gaugePerHit, normal: 0 } } };
}
const changed = (times: number[]) => ({ ...skill, hitSequence: { duration: 1,
  hits: times.map(at => ({ at, directCoef: 1, directFlat: 0 })) } });

describe('saved sequential hit timing', () => {
  it.each([
    ['reversed', changed([0.8, 0.2])], ['negative hit', changed([-0.1, 0.8])],
    ['late hit', changed([0.2, 1.1])], ['nonfinite hit', changed([0.2, Infinity])],
    ['zero duration', { ...skill, hitSequence: { ...skill.hitSequence!, duration: 0 } }],
    ['negative duration', { ...skill, hitSequence: { ...skill.hitSequence!, duration: -1 } }],
    ['nonfinite duration', { ...skill, hitSequence: { ...skill.hitSequence!, duration: Infinity } }],
    ['negative cast', { ...skill, castTime: -1 }], ['nonfinite cast', { ...skill, castTime: Infinity }],
    ['early first end', { ...skill, id: 'serendipity', hitSequence: { ...skill.hitSequence!, firstHitEnd: 0.1 } }],
    ['late first end', { ...skill, id: 'serendipity', hitSequence: { ...skill.hitSequence!, firstHitEnd: 1.1 } }],
    ['nonfinite first end', { ...skill, id: 'serendipity', hitSequence: { ...skill.hitSequence!, firstHitEnd: Infinity } }],
  ] as const)('rejects %s before time, cooldown or damage changes', (_name, current) => {
    const rng = createRng(1), calls: number[] = [];
    rng.chance = probability => { calls.push(probability); return false; };
    const state = new SimState(input(current), rng, []);
    expect(() => state.cast(current, 2)).toThrow('개별 적중 시각');
    expect(state.now).toBe(0); expect(state.readyAt.size).toBe(0);
    expect(state.breakdown.get(current.id)!.casts).toBe(0);
    expect(state.total).toBe(0); expect(calls).toEqual([]);
  });
  it('rejects a reversed saved JSON before returning a simulation summary', () => {
    const build = JSON.parse(JSON.stringify(input(changed([0.8, 0.2]))));
    expect(() => simulate(build, [], { durationSec: 2, iterations: 1, seed: 1 })).toThrow('개별 적중 시각');
  });
  it.each([
    [changed([0, 0.5, 0.5, 1]), [0, 0.5, 0.5, 1], 40],
    [{ ...changed([0.25, 1]), castTime: 2 }, [0.5, 2], 20],
    [{ ...changed([0.25, 1]), castTime: 0 }, [0, 0], 20],
    [changed([]), [], 0],
  ] as const)('preserves simultaneous, boundary, scaled, instant or empty hits', (current, expectedTimes, damage) => {
    const state = new SimState(input(current), createRng(1), []), times: number[] = [];
    const hit = state.hit.bind(state);
    state.hit = (...args) => { times.push(state.now); hit(...args); };
    state.cast(current, 3);
    expect(times).toEqual(expectedTimes); expect(state.total).toBe(damage);
  });
  it('preserves the first-hit-only boundary without judgment', () => {
    const current = { ...skill, id: 'serendipity', hitSequence: { ...skill.hitSequence!, firstHitEnd: 0.2 } };
    const state = new SimState(input(current), createRng(1), []);
    state.cast(current, 3);
    expect(state.now).toBe(0.2); expect(state.total).toBe(10);
  });
});
