import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { Build, PoisonDamage, SkillDef } from '../types';

const skill: SkillDef = { id: 'control', name: '도트 시간 통제', kind: 'normal', cooldown: 10, castTime: 0.25, directCoef: 1, directFlat: 0, hits: 1 };
const effect: PoisonDamage = { coef: 0.1, flat: 1, duration: 2, maxStacks: 1, firstTick: 0.5, interval: 1 };
function input(key: 'manaPoison' | 'fearOfDeath', change: Partial<PoisonDamage> = {}): Build {
  const preset = empressInkomsu440();
  return { ...preset, variant: 'emperor', skills: [{ ...skill, [key]: { ...effect, ...change } }], passiveMods: [], bluntThorn: undefined,
    onCardUse: [], onDestiny: [], onRuinAt4: [], rotation: { ruinPriority: [], stackPriority: [], fillers: [skill.id] },
    params: { ...preset.params, atkBase: 10, raidCaptainRatio: 0, gaugePerHit: { ...preset.params.gaugePerHit, normal: 0 } } };
}
const invalid: [keyof PoisonDamage, number][] = [
  ['duration', -1], ['duration', NaN], ['duration', Infinity],
  ['firstTick', -0.5], ['firstTick', NaN], ['firstTick', Infinity],
  ['interval', 0], ['interval', -1], ['interval', NaN], ['interval', Infinity],
];
describe.each(['manaPoison', 'fearOfDeath'] as const)('%s time input', key => {
  it.each(invalid)('rejects %s=%s before scheduling poison', (field, value) => {
    const state = new SimState(input(key, { [field]: value }), createRng(1), []);
    expect(() => state.cast(state.build.skills[0]!, 3)).toThrow('도트 시간');
    // 직접 피해는 이미 처리됐지만 잘못된 도트는 남기지 않습니다.
    expect(state.now).toBe(0.25); expect(state.total).toBe(10);
    state.advanceTo(3); expect(state.total).toBe(10); expect(state.breakdown.get(skill.id)!.dot).toBeUndefined();
  });
  it.each([0, -1])('rejects interval %s before a bounded repeat control can stall', interval => {
    const rng = createRng(1), state = new SimState(input(key, { interval }), rng, []); let calls = 0;
    rng.chance = () => { if (++calls >= 9) throw new Error('test tick budget reached'); return false; };
    expect(() => { state.cast(state.build.skills[0]!, 2); state.advanceTo(2); }).toThrow('도트 시간');
    expect(calls).toBe(1); expect(state.now).toBe(0.25);
  });
  it('rejects a serialized negative first tick without returning a completed summary', () => {
    const build = JSON.parse(JSON.stringify(input(key, { firstTick: -0.5 })));
    expect(() => simulate(build, [], { durationSec: 2, iterations: 1, seed: 1 })).toThrow('도트 시간');
  });
  it.each([
    [{}, [0.75, 1.75]], [{ duration: 0, firstTick: 0 }, []], [{ firstTick: 0 }, [0.25, 1.25]],
    [{ firstTick: 2 }, []], [{ firstTick: 3 }, []],
  ] satisfies [Partial<PoisonDamage>, number[]][])('preserves timing %j with ticks %j', (change, expected) => {
    const rng = createRng(1), state = new SimState(input(key, change), rng, []), times: number[] = [];
    rng.chance = () => { times.push(state.now); return false; };
    state.cast(state.build.skills[0]!, 3); state.advanceTo(3);
    expect(times).toEqual([0.25, ...expected]); expect(state.total).toBe(10 + expected.length * 2);
  });
  it('does not reject an unused skill effect as if it had been applied', () => {
    const build = input(key, { interval: 0 });
    build.skills = [skill, { ...build.skills[0]!, id: 'unused' }];
    expect(simulate(build, [], { durationSec: 2, iterations: 1, seed: 1 }).dps.mean).toBe(5);
  });
});
