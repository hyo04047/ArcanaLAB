import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { runOnce, simulate, SimState } from '../sim';

function state() {
  const base = empressInkomsu440();
  const build = { ...base, skills: [], passiveMods: [], onDestiny: [], onCardUse: [],
    rotation: { ruinPriority: [], stackPriority: [] },
    params: { ...base.params, cardDamageCoef: {} } };
  return new SimState(build, createRng(42), cardsFor('emperor', { add: ['empress_knight'] }));
}

describe('card acquisition and actual use accounting', () => {
  it('counts consumption even when the card has no damage, but not a missing card', () => {
    const s = state();
    s.useCardNow('star'); expect(s.cardsUsed).toBe(0);
    s.drawCards(1, 'star'); expect(s.cardsUsed).toBe(0);
    s.useCardNow('star'); expect(s.cardsUsed).toBe(1);
    s.useCardNow('star'); expect(s.cardsUsed).toBe(1);
    expect(s.total).toBe(0);
  });

  it.each([0, 1])('counts Royal once with %s other card held, separately from new cards', held => {
    const s = state();
    if (held) s.drawCards(1, 'cull');
    s.drawCards(1, 'royal'); s.useCardNow('royal');
    expect(s.cardsUsed).toBe(1); expect(s.cardDraws.royal).toBe(2 - held);
    expect(s.cardsDrawn - s.cardsUsed).toBe(s.deck.hand.length);
  });

  it('counts two copies only when each is used, not when Clown copies a card', () => {
    const s = state();
    s.drawCards(1, 'moon'); s.useCardNow('moon');
    s.drawCards(1, 'moon'); s.drawCards(1, 'clown'); s.useCardNow('clown');
    expect(s.deck.hand).toEqual(['moon', 'moon']); expect(s.cardsUsed).toBe(2);
    s.useCardNow('moon'); s.useCardNow('moon');
    expect(s.cardsUsed).toBe(4); expect(s.cardsDrawn).toBe(4);
  });

  it('counts Knight use separately from its extra draw and ignores blocked acquisition', () => {
    const s = state();
    s.drawCards(1, 'cull'); s.drawCards(1, 'empress_knight'); s.drawCards(1, 'star');
    expect(s.cardsDrawn).toBe(2); expect(s.cardsUsed).toBe(0);
    s.useCardNow('empress_knight');
    expect(s.cardsUsed).toBe(1); expect(s.cardsDrawn).toBe(3);
    expect(s.cardDraws.empressKnight).toBe(1);
  });

  it('does not count Another Emperor damage as another use', () => {
    const s = state();
    s.build.anotherEmperorChance = 1; s.cardDamageCoef.emperor = 2;
    s.drawCards(1, 'star'); s.useCardNow('star');
    expect(s.breakdown.get('card_emperor_proc')?.casts).toBe(1);
    expect(s.cardsUsed).toBe(1); expect(s.cardsDrawn).toBe(1);
  });

  it('leaves a card acquired on the final hit in hand without extending the fight', () => {
    const s = state();
    const skill = { id: 'last_hit', name: 'last_hit', kind: 'normal' as const,
      cooldown: 10, castTime: 1, directCoef: 0, hits: 1 };
    const build = { ...s.build, skills: [skill], rotation: { ...s.build.rotation, fillers: [skill.id] },
      params: { ...s.build.params, gaugePerHit: { ...s.build.params.gaugePerHit, normal: 1 },
        gaugeGainBonus: 0, normalGaugePenalty: 0 } };
    const result = runOnce(build, cardsFor('empress'), 42, 1);
    expect(result.cardsDrawn).toBe(1); expect(result.cardsUsed).toBe(0);
    expect(result.cardsHeldAtEnd).toBe(1);
  });

  it('uses the same duration and run denominator for acquisition and use rates', () => {
    const build = empressInkomsu440(), cards = cardsFor('empress');
    const cfg = { iterations: 5, durationSec: 37, seed: 42 };
    const rows = Array.from({ length: cfg.iterations }, (_, i) => runOnce(build, cards, cfg.seed + i * 7919, cfg.durationSec));
    for (const r of rows) {
      expect(r.cardsDrawn - r.cardsUsed).toBe(r.cardsHeldAtEnd);
      expect(r.cardsHeldAtEnd).toBeGreaterThanOrEqual(0); expect(r.cardsHeldAtEnd).toBeLessThanOrEqual(2);
    }
    const summary = simulate(build, cards, cfg);
    expect(summary.cardsUsedPerMin).toBeCloseTo(rows.reduce((a, r) => a + r.cardsUsed, 0) / 5 / 37 * 60, 12);
    expect(summary.cardsHeldAtEnd).toBe(rows.reduce((a, r) => a + r.cardsHeldAtEnd, 0) / 5);
    expect((summary.cardsPerMin - summary.cardsUsedPerMin) * 37 / 60).toBeCloseTo(summary.cardsHeldAtEnd, 12);
  });
});
