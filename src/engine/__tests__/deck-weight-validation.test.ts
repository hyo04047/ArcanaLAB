import { describe, expect, it } from 'vitest';
import { Deck, type CardDef } from '../deck';
import { createRng } from '../rng';

const card = (id: string, weight: number): CardDef => ({ id, name: id, weight, duration: null, availability: ['empress'] });
const invalid: unknown[] = [null, undefined, '1', '0', -1, NaN, Infinity, -Infinity, {}, true];
describe('drawable card weights', () => {
  it.each(invalid)('rejects %s before hand or RNG changes', value => {
    const input = card('bad', 1), deck = new Deck([input]), rng = createRng(1), control = createRng(1);
    input.weight = value as number; deck.gauge = 0.25;
    expect(() => deck.draw(rng)).toThrow('가중치');
    expect(deck.hand).toEqual([]); expect(deck.drawn).toBe(0); expect(deck.last).toBeNull(); expect(deck.gauge).toBe(0.25);
    expect(rng.next()).toBe(control.next());
  });
  it('rejects a nonfinite sum of finite positive weights before RNG', () => {
    const deck = new Deck([card('a', 1e308), card('b', 1e308)]), rng = createRng(1), control = createRng(1);
    expect(() => deck.draw(rng)).toThrow('가중치'); expect(deck.hand).toEqual([]); expect(deck.drawn).toBe(0);
    expect(rng.next()).toBe(control.next());
  });
  it.each([[], [card('zero', 0)], [card('a', 0), card('b', 0)]].map(cards => ({ cards })))('does not draw or consume RNG from an empty weighted pool $cards', ({ cards }) => {
    const deck = new Deck(cards), rng = createRng(1), control = createRng(1);
    expect(deck.draw(rng)).toBeNull(); expect(deck.hand).toEqual([]); expect(deck.drawn).toBe(0);
    expect(rng.next()).toBe(control.next());
  });
  it('consumes unusable integer gauge while retaining the fraction for a zero-weight deck', () => {
    const deck = new Deck([card('zero', 0)]), rng = createRng(1), control = createRng(1);
    expect(deck.addGauge(2.25, rng)).toEqual([]); expect(deck.gauge).toBe(0.25); expect(deck.hand).toEqual([]);
    expect(rng.next()).toBe(control.next());
  });
  it.each([[0, 'a'], [0.39, 'a'], [0.4, 'b'], [0.99, 'b']] as const)('preserves relative weights at RNG %s', (value, expected) => {
    const deck = new Deck([card('zero-first', 0), card('a', 2), card('b', 3), card('zero-last', 0)]);
    const rng = { ...createRng(1), next: () => value };
    expect(deck.draw(rng)).toBe(expected);
  });
  it('preserves forced copies of a zero-weight card without RNG', () => {
    const deck = new Deck([card('zero', 0)]), rng = createRng(1), control = createRng(1);
    expect(deck.draw(rng, 'zero')).toBe('zero'); expect(deck.draw(rng, 'zero')).toBe('zero');
    expect(deck.hand).toEqual(['zero', 'zero']); expect(rng.next()).toBe(control.next());
  });
});
