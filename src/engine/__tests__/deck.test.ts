import { describe, expect, it } from 'vitest';
import { Deck } from '../deck';
import { createRng } from '../rng';
import { cardsFor } from '../presets';

describe('deck', () => {
  it('draws uniformly excluding cards in hand, holds max 2, freezes gauge when full', () => {
    const deck = new Deck(cardsFor('empress'));
    const rng = createRng(1);
    const a = deck.draw(rng)!;
    const b = deck.draw(rng)!;
    expect(a).not.toBe(b);
    expect(deck.hand.length).toBe(2);
    expect(deck.draw(rng)).toBeNull();
    deck.addGauge(0.7, rng);
    expect(deck.gauge).toBe(0);
    deck.use(a);
    deck.addGauge(1.2, rng);
    expect(deck.hand.length).toBe(2);
    expect(deck.gauge).toBe(0);
  });

  it('empress deck has 14 cards and excludes emperor-only cards', () => {
    const ids = cardsFor('empress').map((c) => c.id);
    expect(ids.length).toBe(14);
    expect(ids).toContain('judgment');
    expect(ids).not.toContain('emperor');
    const emp = cardsFor('emperor').map((c) => c.id);
    expect(emp).toContain('emperor');
    // 황제 노드만으로 하사품을 가정하지 않습니다. 교체는 검색한 노드가 지정합니다.
    expect(emp).toContain('judgment');
    expect(emp).not.toContain('sovereign');
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const d = new Deck(cardsFor('empress'));
      const r = createRng(42);
      const out: string[] = [];
      for (let i = 0; i < 20; i++) {
        const c = d.draw(r);
        if (c) {
          out.push(c);
          d.use(c);
        }
      }
      return out.join(',');
    };
    expect(run()).toBe(run());
  });
});
