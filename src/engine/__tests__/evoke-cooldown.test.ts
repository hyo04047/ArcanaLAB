import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function state(mode: 'manual' | 'split') {
  const evoke: SkillDef = { id: 'evoke', name: '이보크', kind: 'normal', usesMana: true,
    cooldown: 10, castTime: 1, directCoef: 1, hits: 1,
    ...(mode === 'manual' ? { manualEvoke: { duration: 1, placementAt: 0.25, minRecastDelay: 1, lifetime: 10,
      recastRecovery: 0, hits: [{ after: 0, weight: 1 }] } }
      : { splitEvoke: { duration: 1, placementAt: 0.25, delay: 2, window: 3 } }) };
  const other: SkillDef = { id: 'other', name: '다른 스킬', kind: 'normal', cooldown: 20, castTime: 0.5, directCoef: 0, hits: 1 };
  const base = empressInkomsu440();
  const build = { ...base, skills: [evoke, other], passiveMods: [], onCardUse: [], onDestiny: [], onRuinAt4: [],
    rotation: { ruinPriority: [], stackPriority: [], fillers: ['evoke'], wheelTargets: ['evoke'] },
    params: { ...base.params, gaugePerHit: { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 } } };
  const sim = new SimState(build, createRng(1), cardsFor('empress'));
  const buff = (duration: number) => sim.applyBuff({ id: 'cooldown_test', duration,
    mod: { bucket: 'cooldown', value: 0.5, filter: { ids: ['evoke'], usesMana: true }, source: '합성 쿨감' } });
  return { sim, evoke, other, buff, expires: mode === 'manual' ? 10.25 : 3.25 };
}

describe.each(['manual', 'split'] as const)('%s Evoke cooldown start', mode => {
  it('includes a cooldown buff acquired between installation and second input', () => {
    const { sim, evoke, buff } = state(mode);
    sim.cast(evoke, 100); buff(10); sim.advanceTo(2); sim.cast(evoke, 100);
    expect(sim.readyAt.get('evoke')).toBe(7);
  });
  it.each([1.5, 2])('excludes installation-time buffs that expire by followup (%s)', duration => {
    const { sim, evoke, buff } = state(mode);
    buff(duration); sim.cast(evoke, 100); sim.advanceTo(2); sim.cast(evoke, 100);
    expect(sim.readyAt.get('evoke')).toBe(12);
  });
  it('leaves Wheel available for another skill between installation and detonation', () => {
    const { sim, evoke, other } = state(mode);
    sim.setNextSkillCooldownReset(); sim.cast(evoke, 100);
    expect(sim.nextSkillCdReset).toBe(true); expect(sim.readyAt.has('evoke')).toBe(false);
    sim.cast(other, 100); expect(sim.readyAt.get('other')).toBe(1);
    sim.advanceTo(2); sim.cast(evoke, 100);
    expect(sim.readyAt.get('evoke')).toBe(12); expect(sim.nextSkillCdReset).toBe(false);
  });
  it('consumes Wheel acquired after installation on the actual second input', () => {
    const { sim, evoke } = state(mode);
    sim.cast(evoke, 100); sim.setNextSkillCooldownReset(); sim.advanceTo(2); sim.cast(evoke, 100);
    expect(sim.readyAt.get('evoke')).toBe(2); expect(sim.nextSkillCdReset).toBe(false);
  });
  it('assumes expiry reads current cooldown buffs without consuming a held Wheel', () => {
    const { sim, evoke, buff, expires } = state(mode);
    sim.cast(evoke, 100); buff(20); sim.setNextSkillCooldownReset(); sim.advanceTo(expires);
    expect(sim.readyAt.get('evoke')).toBe(expires + 5); expect(sim.nextSkillCdReset).toBe(true);
  });
  it('only reduces the running cooldown after second input, leaving the chain window intact', () => {
    const { sim, evoke } = state(mode);
    sim.cast(evoke, 100); sim.reduceAllCooldowns(0.5); sim.advanceTo(2);
    expect(sim.isReady('evoke')).toBe(true); expect(sim.readyAt.has('evoke')).toBe(false);
    sim.cast(evoke, 100); const now = sim.now;
    sim.reduceAllCooldowns(0.5); expect(sim.readyAt.get('evoke')).toBe(now + (12 - now) * 0.5);
  });
  it('saves an automatically targeted Wheel in hand until the followup input', () => {
    const { sim } = state(mode);
    sim.drawCards(1, 'wheel_of_fortune'); sim.run(1);
    expect(sim.deck.hand).toContain('wheel_of_fortune'); expect(sim.nextSkillCdReset).toBe(false);
    sim.advanceTo(2); sim.run(2.1);
    expect(sim.deck.hand).not.toContain('wheel_of_fortune'); expect(sim.nextSkillCdReset).toBe(false);
    expect(sim.readyAt.get('evoke')).toBe(2);
  });
});
