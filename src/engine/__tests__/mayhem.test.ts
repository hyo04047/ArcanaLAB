import { describe, expect, it } from 'vitest';
import { useCard } from '../cards';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import cards from '../../../data/cards.json';

function state() {
  const build = empressInkomsu440();
  build.passiveMods = []; build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = [];
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  build.skills = [{ id: 'control', name: '통제', kind: 'normal', cooldown: 0, castTime: 0, directCoef: 0, hits: 1 }];
  return new SimState(build, createRng(1), []);
}
const cast = (sim: SimState) => sim.cast(sim.build.skills[0]!, 100);

describe('Mayhem attack speed stacks', () => {
  it('starts with no attack speed and reaches 15% after three casts', () => {
    const sim = state(); useCard('mayhem', sim);
    expect(sim.atkSpeed()).toBe(0);
    for (const expected of [0.05, 0.1, 0.15, 0.15]) { cast(sim); expect(sim.atkSpeed()).toBeCloseTo(expected); }
  });
  it('does not gain stacks from casting without Mayhem or from using another card', () => {
    const sim = state(); cast(sim); expect(sim.atkSpeed()).toBe(0);
    useCard('mayhem', sim); useCard('ghost', sim); expect(sim.atkSpeed()).toBe(0);
  });
  it('counts a multi-hit cast once, including subsequent delayed hits', () => {
    const sim = state(), skill = sim.build.skills[0]!;
    skill.delayedHits = { duration: 1, spawnAt: 0, hits: [0, 1, 2].map(after => ({ after, directCoef: 0, directFlat: 0 })) };
    useCard('mayhem', sim); cast(sim); sim.advanceTo(2);
    expect(sim.atkSpeed()).toBeCloseTo(0.05);
  });
  it('refreshes all stacks for four seconds, then rebuilds from one stack', () => {
    const sim = state(); useCard('mayhem', sim); cast(sim);
    sim.advanceTo(3); cast(sim); sim.advanceTo(6.999);
    expect(sim.atkSpeed()).toBeCloseTo(0.1);
    sim.advanceTo(7); expect(sim.atkSpeed()).toBe(0);
    cast(sim); expect(sim.atkSpeed()).toBeCloseTo(0.05);
  });
  it('does not add or refresh stacks at the 30-second window boundary', () => {
    const sim = state(); useCard('mayhem', sim); sim.advanceTo(29); cast(sim);
    sim.advanceTo(30); cast(sim); expect(sim.atkSpeed()).toBeCloseTo(0.05);
    sim.advanceTo(33); expect(sim.atkSpeed()).toBe(0);
  });
  it('refreshes the card window without adding, clearing, or extending the current speed stacks', () => {
    const sim = state(); useCard('mayhem', sim); sim.advanceTo(29); cast(sim);
    sim.advanceTo(30); useCard('mayhem', sim); expect(sim.atkSpeed()).toBeCloseTo(0.05);
    sim.advanceTo(33); expect(sim.atkSpeed()).toBe(0);
    cast(sim); expect(sim.atkSpeed()).toBeCloseTo(0.05);
    sim.advanceTo(60); cast(sim); expect(sim.atkSpeed()).toBe(0);
  });
  it('applies each gained stack to its own cast, subject to the global 140% cap', () => {
    const sim = state(), skill = sim.build.skills[0]!; skill.castTime = 1.4;
    sim.build.passiveMods = [{ bucket: 'atkSpeed', value: 0.3, source: '통제 공속' }];
    useCard('mayhem', sim); cast(sim); expect(sim.now).toBeCloseTo(1.4 / 1.35);
    const secondStart = sim.now; cast(sim); expect(sim.now - secondStart).toBeCloseTo(1);
    const thirdStart = sim.now; cast(sim); expect(sim.now - thirdStart).toBeCloseTo(1);
    expect(sim.activeMods().find(m => m.source === '광기' && m.bucket === 'atkSpeed')?.value).toBeCloseTo(0.15);
  });
  it('keeps the card description aligned with 5% increments', () => {
    expect(cards.cards.find(c => c.id === 'mayhem')?.effect).toContain('+5%');
  });
});
