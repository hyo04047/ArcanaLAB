import { describe, expect, it } from 'vitest';
import { useCard } from '../cards';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';

function state(card: string, value: unknown) {
  const build = empressInkomsu440(); build.onCardUse = [];
  build.cardDurationBonus = { [card]: value as number };
  const sim = new SimState(build, createRng(1), cardsFor('empress'));
  sim.advanceTo(3); sim.drawCards(1, card);
  return sim;
}

describe.each([{ card: 'cull', buff: 'cull_dmg', duration: 4 }, { card: 'moon', buff: 'moon', duration: 30 }])('$card duration bonus', ({ card, buff, duration }) => {
  it.each([true, false, '2', '', NaN, Infinity, -Infinity, {}, []].map(value => ({ value })))('rejects $value before applying a buff', ({ value }) => {
    const sim = state(card, value);
    expect(() => sim.useCardNow(card)).toThrow('카드 지속시간 보정');
    expect(sim.buffs.has(buff, 3)).toBe(false); expect(sim.buffs.remaining(buff, 3)).toBe(0);
    expect(sim.buffs.has('cull_rate', 3)).toBe(false);
  });
  it.each([0, 1.5, -1, -4, undefined, null])('preserves the expiry with %s', value => {
    const sim = state(card, value), remaining = duration + (value ?? 0);
    sim.useCardNow(card);
    expect(sim.buffs.remaining(buff, 3)).toBe(remaining);
    if (remaining > 0) expect(sim.buffs.has(buff, 3 + remaining - 1e-6)).toBe(true);
    expect(sim.buffs.has(buff, 3 + remaining)).toBe(false);
  });
});
it('checks a changed bonus when the card is used', () => {
  const sim = state('cull', 1); sim.build.cardDurationBonus!.cull = true as unknown as number;
  expect(() => sim.useCardNow('cull')).toThrow('카드 지속시간 보정');
});
it('leaves negative final duration rejection to the buff check', () => {
  const sim = state('cull', -5); expect(() => sim.useCardNow('cull')).toThrow('버프 지속시간');
});
it('does not inspect a bonus for an unused effect', () => {
  const sim = state('star', true); expect(() => sim.useCardNow('star')).not.toThrow();
});
it('checks the actual duration returned by a direct CardHost', () => {
  const sim = state('cull', 0); sim.durationBonus = () => null as unknown as number;
  expect(() => useCard('cull', sim)).toThrow('카드 지속시간 보정');
});
