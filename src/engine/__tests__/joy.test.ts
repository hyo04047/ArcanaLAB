import { describe, expect, it, vi } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { useCard, cardSupplyWarnings } from '../cards';
import type { SkillDef } from '../types';
import cards from '../../../data/cards.json';

function state(roll: number) {
  const build = empressInkomsu440(); build.passiveMods = [];
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  build.skills = (['normal', 'ruin', 'hyper_awakening', 'awakening'] as const).map(kind => ({
    id: kind, name: kind, kind, cooldown: 20, castTime: 0, directCoef: 0, hits: 1,
  }));
  const sim = new SimState(build, { next: () => roll, chance: p => roll < p, pick: a => a[0]! }, cardsFor('empress'));
  for (const s of build.skills) sim.readyAt.set(s.id, 24);
  sim.advanceTo(4); return sim;
}
function play(sim: SimState) { sim.drawCards(1, 'joy'); sim.useCardNow('joy'); }

describe('Joy cooldown outcomes', () => {
  it.each([[0, 18], [0.499999, 18], [0.5, 21], [0.999999, 21]])('uses a 50%% high outcome, random=%s', (roll, readyAt) => {
    const sim = state(roll); play(sim);
    for (const id of ['normal', 'ruin', 'hyper_awakening']) expect(sim.readyAt.get(id)).toBe(readyAt);
    expect(sim.readyAt.get('awakening')).toBe(24);
  });
  it('rolls once for the card, giving all cooldowns the same fraction', () => {
    const sim = state(0.2), chance = vi.spyOn(sim.rng, 'chance'); play(sim);
    expect(chance.mock.calls).toEqual([[0.5]]);
    expect(sim.readyAt.get('normal')).toBe(sim.readyAt.get('ruin'));
  });
  it('only scales remaining time and leaves already-ready skills alone', () => {
    const sim = state(0.8); sim.readyAt.set('normal', 14); sim.readyAt.set('ruin', 2); play(sim);
    expect(sim.readyAt.get('normal')).toBeCloseTo(12.5); expect(sim.readyAt.get('ruin')).toBe(2);
  });
  it('does not add a cooldown buff to future casts', () => {
    const sim = state(0.2); play(sim); sim.advanceTo(18); sim.cast(sim.skill('normal'), 50);
    expect(sim.readyAt.get('normal')).toBe(38);
    expect(sim.activeMods().some(m => m.bucket === 'cooldown')).toBe(false);
  });
  it('consumes the card and retains it as the last card for Clown', () => {
    const sim = state(0.2); play(sim);
    expect(sim.deck.hand).not.toContain('joy'); expect(sim.lastUsedCard()).toBe('joy');
    sim.drawCards(1, 'clown'); sim.useCardNow('clown'); expect(sim.deck.hand).toContain('joy');
  });
  it('does not roll or reduce anything when the card is absent', () => {
    const sim = state(0.2), chance = vi.spyOn(sim.rng, 'chance'); sim.useCardNow('joy');
    expect(chance).not.toHaveBeenCalled(); expect(sim.readyAt.get('normal')).toBe(24);
  });
  it('retains the card-use passive exactly once', () => {
    const sim = state(0.2); sim.build.onCardUse = [{ id: 'mercy', duration: 8, mod: { bucket: 'dmgToEnemy', value: 0.1, source: '자비 통제' } }];
    play(sim); expect(sim.activeMods().filter(m => m.source === '자비 통제')).toHaveLength(1);
  });
  it('affects current charge recovery, without shortening the following recovery', () => {
    const sim = state(0.8), build = sim.build;
    const s: SkillDef = { id: 'stream', name: '스트림 통제', kind: 'stack', cooldown: 20, maxCharges: 2, castTime: 0, directCoef: 0, hits: 1 };
    build.skills = [s]; const charged = new SimState(build, sim.rng, cardsFor('empress'));
    charged.cast(s, 50); charged.cast(s, 50); charged.advanceTo(4); play(charged);
    expect(charged.readyAt.get(s.id)).toBeCloseTo(17.6);
    charged.advanceTo(17.6); expect(charged.readyAt.get(s.id)).toBeCloseTo(37.6);
  });
  it('is deterministic for the same RNG seed, while preserving both possible outcomes', () => {
    const draw = () => {
      const sim = new SimState(empressInkomsu440(), createRng(72), []), values: number[] = [];
      sim.reduceAllCooldowns = value => values.push(value);
      for (let i = 0; i < 100; i++) useCard('joy', sim);
      return values;
    };
    const outcomes = draw(); expect(outcomes).toEqual(draw()); expect(new Set(outcomes)).toEqual(new Set([0.15, 0.3]));
  });
  it('keeps the tooltip and unresolved chain limitation visible', () => {
    const card = cards.cards.find(c => c.id === 'joy')!;
    expect(card.effect).toContain('15%'); expect(card.effect).toContain('50%'); expect(card.effect).toContain('30%');
    expect(cardSupplyWarnings(empressInkomsu440()).some(w => w.includes('환희') && w.includes('체인') && w.includes('미검증'))).toBe(true);
  });
});
