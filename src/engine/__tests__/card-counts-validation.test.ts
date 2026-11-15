import { describe, expect, it } from 'vitest';
import { Deck, type CardDef } from '../deck';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';

const cards: CardDef[] = ['a', 'b', 'c'].map(id => ({ id, name: id, weight: 1, duration: null, availability: ['empress'] }));
const invalid: unknown[] = [null, '2', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, true];
describe('integer direct card counts', () => {
  it.each(invalid)('rejects hand capacity %s', value => {
    expect(() => new Deck(cards, value as number)).toThrow('손패 한도');
  });
  it.each([...invalid, undefined].flatMap(value => [false, true].map(full => ({ value, full }))))(
    'rejects draw count $value with full=$full before state/RNG changes', ({ value, full }) => {
      const rng = createRng(1), control = createRng(1), sim = new SimState(empressInkomsu440(), rng, cards);
      if (full) sim.deck.hand.push('a', 'b');
      sim.deck.gauge = 0.25;
      const before = { hand: [...sim.deck.hand], cardDraws: { ...sim.cardDraws } };
      expect(() => sim.drawCards(value as number)).toThrow('카드 지급 횟수');
      expect(sim.deck.hand).toEqual(before.hand); expect(sim.cardDraws).toEqual(before.cardDraws);
      expect([sim.cardsDrawn, sim.deck.drawn, sim.deck.gauge]).toEqual([0, 0, 0.25]); expect(rng.next()).toBe(control.next());
    });
  it.each([0, 1, 2, 3, Number.MAX_SAFE_INTEGER])('preserves hand capacity %s and empty-pool stop', handSize => {
    const deck = new Deck(cards, handSize), rng = createRng(1);
    for (let i = 0; i < 4; i++) deck.draw(rng);
    expect(deck.hand).toHaveLength(Math.min(handSize, cards.length)); expect(deck.drawn).toBe(deck.hand.length);
  });
  it.each([0, 1, 2, 3, Number.MAX_SAFE_INTEGER].flatMap(count => [false, true].map(forced => ({ count, forced })) ))(
    'preserves draw count $count with forced=$forced', ({ count, forced }) => {
      const sim = new SimState(empressInkomsu440(), createRng(1), cards);
      sim.drawCards(count, forced ? 'a' : undefined, 'manual');
      const expected = Math.min(count, 2);
      expect(sim.deck.hand).toHaveLength(expected); expect(sim.cardsDrawn).toBe(expected); expect(sim.cardDraws.manual).toBe(expected);
      if (forced) expect(sim.deck.hand).toEqual(Array(expected).fill('a')); else expect(new Set(sim.deck.hand).size).toBe(expected);
    });
});
