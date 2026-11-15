import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';

function fixture(coef: unknown, flat: unknown) {
  const build = empressInkomsu440(); build.variant = 'emperor'; build.passiveMods = []; build.bluntThorn = undefined;
  build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = []; build.params.atkBase = 1;
  build.params.cardDamageCoef = { emperor: coef as number, empress_knight: coef as number };
  build.params.cardDamageFlat = { emperor: flat as number, empress_knight: flat as number };
  const state = new SimState(build, createRng(1), cardsFor('emperor', { add: ['empress_knight'] }));
  return { state, play: (card: string) => { state.drawCards(1, card); state.useCardNow(card); } };
}

describe.each(['emperor', 'empress_knight'])('%s actual card damage', card => {
  describe.each(['coef', 'flat'])('%s before the no-damage return', field => {
    it.each(['0', '-1', '', false, [], [-1], -Infinity].map(value => ({ value })))('rejects $value', ({ value }) => {
      const { state, play } = fixture(field === 'coef' ? value : 0, field === 'flat' ? value : 0);
      expect(() => play(card)).toThrow('카드 피해 수치'); expect(state.total).toBe(0);
      expect(state.breakdown.has('card_' + card)).toBe(false); expect(state.cardsUsed).toBe(1);
      expect(state.cardDraws.empressKnight).toBe(0);
    });
    it.each([undefined, null])('preserves the missing/null %s fallback', value => {
      const { state, play } = fixture(field === 'coef' ? value : 2, field === 'flat' ? value : 2);
      play(card); expect(state.total).toBe(2);
    });
  });
  it.each([[0, 0, 0], [-1, -1, 0], [0.5, 0.25, 0.75], [-1, 2, 1], [2, -1, 1], [0, 2, 2], [2, 0, 2]])
    ('preserves finite coefficient %s and flat %s', (coef, flat, damage) => {
      const { state, play } = fixture(coef, flat); play(card); expect(state.total).toBe(damage);
      expect(state.breakdown.has('card_' + card)).toBe(damage > 0);
      expect(state.cardDraws.empressKnight).toBe(card === 'empress_knight' ? 1 : 0);
    });
  it('does not inspect damage for a card absent from the hand', () => {
    const { state } = fixture('0', false); expect(() => state.useCardNow(card)).not.toThrow(); expect(state.cardsUsed).toBe(0);
  });
});

it('checks Another Emperor before silently skipping its extra damage', () => {
  const { state, play } = fixture('0', 0); state.build.anotherEmperorChance = 1;
  expect(() => play('star')).toThrow('카드 피해 수치'); expect(state.total).toBe(0);
  expect(state.breakdown.has('card_emperor_proc')).toBe(false);
});

it.each([0, 2])('preserves Another Emperor with coefficient %s', coef => {
  const { state, play } = fixture(coef, 0); state.build.anotherEmperorChance = 1; play('star');
  expect(state.total).toBe(coef); expect(state.breakdown.has('card_emperor_proc')).toBe(coef > 0);
});

it('checks damage changed between actual card uses', () => {
  const { state, play } = fixture(0, 0); play('emperor'); state.cardDamageCoef.emperor = '0' as unknown as number;
  expect(() => play('emperor')).toThrow('카드 피해 수치'); expect(state.total).toBe(0);
});

it('leaves unused damage alone when a different card is used', () => {
  const { state, play } = fixture('0', false); expect(() => play('star')).not.toThrow(); expect(state.total).toBe(0);
});
