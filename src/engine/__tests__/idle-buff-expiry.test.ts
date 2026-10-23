import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Build, SkillDef, TimedEffect } from '../types';

// 버프 만료에 따라 기존 finisher 정책이 선택 가능해지는 통제 사례입니다.
const buff: TimedEffect = { id: 'critical', duration: 1, mod: { bucket: 'critDmg', value: 0, source: '통제' } };
function state(expiry: number) {
  const finisher: SkillDef = { id: 'finisher', name: 'finisher', kind: 'stack', cooldown: 100,
    castTime: 0.05, directCoef: 1, hits: 1, onHit: [buff] };
  const pulse: SkillDef = { id: 'pulse', name: 'pulse', kind: 'normal', cooldown: 100,
    castTime: 0.05, directCoef: 0, hits: 1 };
  const build: Build = { name: 'idle buff', variant: 'empress', stats: { crit: 0, spec: 0, swift: 0 },
    skills: [finisher, pulse], passiveMods: [], rotation: { ruinPriority: [], stackPriority: [], finisher: finisher.id },
    params: { ...empressInkomsu440().params, atkBase: 1,
      gaugePerHit: { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 } } };
  const sim = new SimState(build, createRng(1), []);
  sim.stacks = 4;
  sim.applyBuff({ ...buff, duration: expiry });
  return { sim, finisher, pulse };
}

describe('idle reevaluation at buff expiry', () => {
  it.each([0.23, 0.37, 1.07])('starts the already ready finisher when the buff expires at %s', expiry => {
    const { sim, finisher } = state(expiry);
    expect(sim.chooseAction()).toBeNull();
    expect(sim.run(expiry + 0.050001).totalDamage).toBe(1);
    expect(sim.readyAt.get(finisher.id)).toBeCloseTo(expiry + 100, 10);
  });

  it('uses the refreshed expiration instead of a stale earlier deadline', () => {
    const { sim, finisher } = state(0.23);
    sim.advanceTo(0.1);
    sim.applyBuff({ ...buff, duration: 0.37 });
    expect(sim.run(0.520001).totalDamage).toBe(1);
    expect(sim.readyAt.get(finisher.id)).toBeCloseTo(100.47, 10);
  });

  it('does not cast at the exact fight end or loop on an expired entry', () => {
    const { sim, finisher } = state(0.23);
    sim.applyBuff({ ...buff, id: 'expired', duration: 0 });
    expect(sim.run(0.23).totalDamage).toBe(0);
    expect(sim.readyAt.has(finisher.id)).toBe(false);
  });

  it('processes a simultaneous hit that renews the buff before choosing a new action', () => {
    const { sim, pulse, finisher } = state(0.23);
    pulse.onHit = [buff];
    pulse.delayedHits = { duration: 0.05, spawnAt: 0, hits: [{ after: 0.23, directCoef: 0, directFlat: 0 }] };
    sim.cast(pulse, 0.3);
    expect(sim.run(0.3).totalDamage).toBe(0);
    expect(sim.readyAt.has(finisher.id)).toBe(false);
    expect(sim.buffs.remaining(buff.id, sim.now)).toBeCloseTo(0.93, 10);
  });

  it('waits for the current animation to finish even if the buff expires during it', () => {
    const { sim, pulse, finisher } = state(0.23);
    pulse.castTime = 0.4;
    sim.cast(pulse, 1);
    expect(sim.run(0.450001).totalDamage).toBe(1);
    expect(sim.readyAt.get(finisher.id)).toBeCloseTo(100.4, 10);
  });
});
