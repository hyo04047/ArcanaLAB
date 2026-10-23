import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { Build, SkillDef, TimedEffect } from '../types';

const skill: SkillDef = { id: 'control', name: '시전 속도 통제', kind: 'normal', cooldown: 10, castTime: 1, directCoef: 1, directFlat: 0, hits: 1 };
function input(castTime = 1, bonuses: number[] = []): Build {
  const preset = empressInkomsu440();
  return { ...preset, variant: 'emperor', skills: [{ ...skill, castTime }], bluntThorn: undefined,
    passiveMods: bonuses.map(value => ({ bucket: 'atkSpeed', value, source: '속도 통제' })),
    onCardUse: [], onDestiny: [], onRuinAt4: [], rotation: { ruinPriority: [], stackPriority: [], fillers: [skill.id] },
    params: { ...preset.params, atkBase: 10, raidCaptainRatio: 0, gaugePerHit: { ...preset.params.gaugePerHit, normal: 0 } } };
}
const slow: TimedEffect = { id: 'slow', duration: 5, mod: { bucket: 'atkSpeed', value: -2, source: '동적 감속 통제' } };

describe('saved cast duration and effective attack speed', () => {
  it.each([-1, Infinity, -Infinity, NaN])('rejects cast duration %s before changing cast state', castTime => {
    const state = new SimState(input(castTime), createRng(1), []);
    expect(() => state.cast(state.build.skills[0]!, 2)).toThrow('시전시간');
    expect(state.now).toBe(0); expect(state.readyAt.size).toBe(0);
    expect(state.breakdown.get(skill.id)!.casts).toBe(0); expect(state.total).toBe(0);
  });
  it.each([[-1], [-2], [Infinity], [-Infinity], [NaN], [-0.6, -0.4], [1e308, 1e308]])(
    'rejects an invalid effective speed from %j before advancing time', (...bonuses) => {
      const state = new SimState(input(1, bonuses), createRng(1), []);
      expect(() => state.atkSpeed()).toThrow('공격 속도');
      expect(() => state.cast(state.build.skills[0]!, 2)).toThrow('공격 속도');
      expect(state.now).toBe(0); expect(state.total).toBe(0);
    });
  it.each(['cast', 'destiny'] as const)('rejects speed introduced by a %s effect', trigger => {
    const build = input();
    if (trigger === 'cast') build.skills[0]!.onCast = [slow];
    else { build.skills[0]!.tags = ['destiny']; build.onDestiny = [slow]; }
    const state = new SimState(build, createRng(1), []);
    expect(state.atkSpeed()).toBe(0);
    expect(() => state.cast(build.skills[0]!, 2)).toThrow('공격 속도');
    expect(state.now).toBe(0); expect(state.total).toBe(0);
    // 시전 효과·쿨을 되돌리는 트랜잭션이 아니라 해당 실행의 오류입니다.
    expect(state.buffs.has('slow', 0)).toBe(true);
  });
  it('allows a speed penalty once its timed effect has expired', () => {
    const state = new SimState(input(), createRng(1), []);
    state.applyBuff({ ...slow, duration: 1 });
    expect(() => state.atkSpeed()).toThrow('공격 속도');
    state.advanceTo(1); expect(state.atkSpeed()).toBe(0);
    state.cast(state.build.skills[0]!, 3); expect(state.now).toBe(2); expect(state.total).toBe(10);
  });
  it.each([input(-1), input(1, [-1]), input(1, [-2]),
    { ...input(), skills: [{ ...skill, onCast: [slow] }] }])('rejects serialized invalid timing without a completed summary', build => {
    expect(() => simulate(JSON.parse(JSON.stringify(build)), [], { durationSec: 2, iterations: 1, seed: 1 }))
      .toThrow(/시전시간|공격 속도/);
  });
  it.each([
    [1, [], 1], [1, [-0.1], 1 / 0.9], [1, [0.7], 1 / 1.4], [1, [-2, 2], 1], [0, [-0.1], 0],
  ] satisfies [number, number[], number][])('preserves duration %s, bonuses %j and time %s', (castTime, bonuses, time) => {
    const state = new SimState(input(castTime, bonuses), createRng(1), []);
    state.cast(state.build.skills[0]!, 2);
    expect(state.now).toBeCloseTo(time); expect(state.total).toBe(10); expect(state.readyAt.get(skill.id)).toBe(10);
  });
});
