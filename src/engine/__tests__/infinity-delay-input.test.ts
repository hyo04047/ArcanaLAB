import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { Build } from '../types';

const saved = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-19-infinity-delay-input-before.json', 'utf8')) as
  { config: { durationSec: number; iterations: number; seed: number }; rows: { build: Build }[] };
function fixture(delay: number) {
  const build = structuredClone(saved.rows[0]!.build);
  build.infinityDeck!.judgment!.delay = delay;
  const state = new SimState(build, createRng(1), cardsFor(build.variant, build.deckOverrides));
  state.advanceTo(1); state.readyAt.set('ruin', 20);
  return state;
}
function play(state: SimState, card = 'judgment') { state.drawCards(1, card); state.useCardNow(card); }

it.each([-1, NaN, Infinity, -Infinity])('rejects invalid Infinity delay %s before queuing an event', delay => {
  const state = fixture(delay);
  expect(() => play(state)).toThrow('쿨 감소 지연');
  expect(state.now).toBe(1);
  state.advanceTo(2); expect(state.readyAt.get('ruin')).toBe(20);
});
it.each(saved.rows)('does not complete a serialized negative delay', ({ build }) => {
  const input: Build = JSON.parse(JSON.stringify(build));
  expect(() => simulate(input, cardsFor(input.variant, input.deckOverrides), saved.config)).toThrow('쿨 감소 지연');
});
it('keeps an immediate event at the current time', () => {
  const state = fixture(0); play(state);
  expect(state.readyAt.get('ruin')).toBe(20);
  state.advanceTo(1); expect(state.readyAt.get('ruin')).toBeCloseTo(17.15);
});
it('keeps the six-second candidate and exact event boundary', () => {
  const state = fixture(6); play(state);
  state.advanceTo(6.999); expect(state.readyAt.get('ruin')).toBe(20);
  state.advanceTo(7); expect(state.readyAt.get('ruin')).toBeCloseTo(18.05);
});
it('does not inspect the unused effect when Judgment is absent', () => {
  const state = fixture(-1);
  expect(() => state.useCardNow('judgment')).not.toThrow();
  expect(state.cardsUsed).toBe(0);
});
it('does not apply the delay check to a different card', () => {
  const state = fixture(-1);
  expect(() => play(state, 'balance')).not.toThrow();
  state.advanceTo(2); expect(state.readyAt.get('ruin')).toBe(20);
});
