import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Build, SkillDef } from '../types';

// 대기 시각만 검증하는 통제 입력이며 실제 스킬의 쿨타임·피해가 아닙니다.
function state(cooldown: number) {
  const skill: SkillDef = { id: 'normal', name: 'normal', kind: 'normal', cooldown,
    castTime: 0.05, directCoef: 1, hits: 1 };
  const build: Build = { name: 'idle cooldown', variant: 'emperor', stats: { crit: 0, spec: 0, swift: 0 },
    skills: [skill], passiveMods: [], rotation: { ruinPriority: [], stackPriority: [], fillers: [skill.id] },
    params: { ...empressInkomsu440().params, atkBase: 1,
      gaugePerHit: { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 } } };
  return { skill, sim: new SimState(build, createRng(1), []) };
}

describe('idle cooldown event timing', () => {
  it.each([0.23, 0.37, 1.07])('casts at the exact ready time for cooldown %s', cooldown => {
    const { sim, skill } = state(cooldown);
    const result = sim.run(2 * cooldown + skill.castTime + 0.000001);
    expect(result.totalDamage).toBe(3);
    expect(result.breakdown[0]!.casts).toBe(3);
    expect(sim.readyAt.get(skill.id)).toBeCloseTo(3 * cooldown, 10);
  });

  it('does not begin a cast at the exact fight end', () => {
    const { sim } = state(0.23);
    const result = sim.run(0.46);
    expect(result.totalDamage).toBe(2);
    expect(result.breakdown[0]!.casts).toBe(2);
  });

  it('ignores already expired cooldown entries while waiting for the chosen skill', () => {
    const { sim } = state(0.23);
    sim.readyAt.set('expired', 0);
    sim.readyAt.set('older', -1);
    expect(sim.run(0.510001).totalDamage).toBe(3);
  });

  it('processes delayed hits before the next ready cast without rounding its cooldown', () => {
    const { sim, skill } = state(0.23);
    skill.delayedHits = { duration: 0.05, spawnAt: 0, hits: [{ after: 0.12, directCoef: 1, directFlat: 0 }] };
    const result = sim.run(0.580001);
    expect(result.totalDamage).toBe(3);
    expect(result.breakdown[0]!.casts).toBe(3);
    expect(sim.readyAt.get(skill.id)).toBeCloseTo(0.69, 10);
  });

  it('does not insert another cast while the current animation is still running', () => {
    const { sim, skill } = state(0.23);
    skill.castTime = 0.3;
    const result = sim.run(0.600001);
    expect(result.totalDamage).toBe(2);
    expect(result.breakdown[0]!.casts).toBe(3);
    expect(sim.readyAt.get(skill.id)).toBeCloseTo(0.83, 10);
  });
});
