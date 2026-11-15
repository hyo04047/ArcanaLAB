import { describe, expect, it } from 'vitest';
import { cardsFor } from '../presets';
import type { Build } from '../types';

describe('saved deck override structure and registered card IDs', () => {
  const invalid: unknown[] = [null, 'star', ['star'], 1, false,
    { add: null }, { remove: null }, { add: 'star' }, { remove: 'star' },
    { add: ['missing_card'] }, { remove: ['missing_card'] },
    { add: ['star', 'missing_card'] }, { remove: ['star', 1] }, { remove: [null] }, { addd: ['star'] }];
  it.each(invalid.map(overrides => ({ overrides })))('rejects invalid overrides $overrides before returning a partial deck', ({ overrides }) => {
    expect(() => cardsFor('empress', overrides as Build['deckOverrides'])).toThrow('덱 변경');
  });

  it.each(['empress', 'emperor'] as const)('preserves empty edits, duplicate IDs, and remove-then-add order for %s', variant => {
    const baseline = cardsFor(variant), star = baseline.find(card => card.id === 'star')!;
    expect(star).toBeDefined();
    for (const overrides of [{}, { add: [], remove: [] }, { add: ['star', 'star'] }])
      expect(cardsFor(variant, overrides)).toEqual(baseline);
    expect(cardsFor(variant, { remove: ['star', 'star'], add: ['star', 'star'] }))
      .toEqual([...baseline.filter(card => card.id !== 'star'), star]);
    expect(cardsFor(variant, { remove: baseline.map(card => card.id) })).toEqual([]);
  });

  it('keeps known unavailable cards usable as controls without asserting equipment legality', () => {
    const baseline = cardsFor('empress');
    expect(baseline.some(card => card.id === 'emperor')).toBe(false);
    expect(cardsFor('empress', { remove: ['emperor'] })).toEqual(baseline);
    expect(cardsFor('empress', { add: ['emperor'] }).map(card => card.id)).toEqual([...baseline.map(card => card.id), 'emperor']);
  });
});
