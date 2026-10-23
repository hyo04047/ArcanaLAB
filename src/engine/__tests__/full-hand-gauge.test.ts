import { describe, expect, it } from 'vitest';
import { Deck } from '../deck';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function state() {
  const build = empressInkomsu440();
  const skill: SkillDef = { id: 'probe', name: 'probe', kind: 'normal', cooldown: 0,
    castTime: 1, directCoef: 0, hits: 1,
    quickDraw: { chance: 1, trigger: 'each', attempts: 1 } };
  build.skills = [skill];
  build.passiveMods = [];
  build.onDestiny = ['drawCard'];
  build.rotation = { ruinPriority: [], stackPriority: [], fillers: [skill.id] };
  build.params.gaugeGainBonus = 0;
  build.params.normalGaugePenalty = 0;
  build.params.gaugePerHit.normal = 0.2;
  return new SimState(build, createRng(42), cardsFor('empress'));
}

describe('full hand clears partial gauge for every draw path', () => {
  it('preserves partial gauge with one card, then clears it on a random second draw', () => {
    const d = new Deck(cardsFor('empress')), rng = createRng(42);
    d.addGauge(0.7, rng);
    d.draw(rng);
    expect(d.gauge).toBeCloseTo(0.7);
    d.draw(rng);
    expect(d.gauge).toBe(0);
    d.use(d.hand[0]!);
    expect(d.gauge).toBe(0);
    expect(d.addGauge(0.4, rng)).toEqual([]);
    expect(d.gauge).toBeCloseTo(0.4);
  });

  it('clears gauge for a forced duplicate without changing card or RNG accounting', () => {
    const d = new Deck(cardsFor('empress')), rng = createRng(42), control = createRng(42);
    d.draw(rng, 'moon'); d.addGauge(0.7, rng);
    expect(d.draw(rng, 'moon')).toBe('moon');
    expect(d.hand).toEqual(['moon', 'moon']);
    expect(d.gauge).toBe(0);
    expect(d.drawn).toBe(2);
    expect(rng.next()).toBe(control.next());
  });

  it('keeps gauge overflow after the first card and discards it only at capacity', () => {
    const d = new Deck(cardsFor('empress')), rng = createRng(42);
    expect(d.addGauge(1.6, rng)).toHaveLength(1);
    expect(d.gauge).toBeCloseTo(0.6);
    expect(d.addGauge(1, rng)).toHaveLength(1);
    expect(d.gauge).toBe(0);
    expect(d.draw(rng)).toBeNull();
    expect(d.drawn).toBe(2);
  });

  it('does not erase partial gauge when a one-card deck has no drawable card', () => {
    const d = new Deck(cardsFor('empress').slice(0, 1)), rng = createRng(42);
    d.draw(rng); d.addGauge(0.7, rng);
    expect(d.draw(rng)).toBeNull();
    expect(d.gauge).toBeCloseTo(0.7);
    expect(d.drawn).toBe(1);
  });

  it('clears partial gauge when Quick Draw fills the second slot after a hit', () => {
    const s = state();
    s.drawCards(1, 'cull'); s.deck.addGauge(0.5, s.rng);
    s.cast(s.build.skills[0]!, 2);
    expect(s.deck.isFull).toBe(true);
    expect(s.cardDraws.quickDraw).toBe(1);
    expect(s.cardDraws.gauge).toBe(0);
    expect(s.deck.gauge).toBe(0);
  });

  it('clears partial gauge when destiny fills the second slot', () => {
    const s = state();
    s.drawCards(1, 'cull'); s.deck.addGauge(0.7, s.rng); s.triggerDestiny();
    expect(s.cardDraws.destiny).toBe(1);
    expect(s.deck.isFull).toBe(true);
    expect(s.deck.gauge).toBe(0);
  });

  it('Royal preserves a partial gauge until its draws fill the hand', () => {
    const s = state();
    s.drawCards(1, 'royal'); s.deck.addGauge(0.7, s.rng); s.useCardNow('royal');
    expect(s.cardDraws.royal).toBe(2);
    expect(s.cardsDrawn - s.cardsUsed).toBe(2);
    expect(s.deck.gauge).toBe(0);
  });

  it('Knight replaces its own slot without discarding a non-full gauge', () => {
    const s = state();
    s.drawCards(1, 'empress_knight'); s.deck.addGauge(0.7, s.rng); s.useCardNow('empress_knight');
    expect(s.cardDraws.empressKnight).toBe(1);
    expect(s.deck.hand).toHaveLength(1);
    expect(s.deck.gauge).toBeCloseTo(0.7);
  });
});
