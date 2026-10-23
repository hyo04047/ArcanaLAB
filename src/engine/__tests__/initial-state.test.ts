import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';

afterEach(() => vi.restoreAllMocks());

describe('fresh simulation starting conditions', () => {
  it.each(['empress', 'emperor'] as const)('starts every %s iteration fresh and reports the boundary', variant => {
    const build = empressInkomsu440(); build.variant = variant;
    const states: SimState[] = [], run = SimState.prototype.run;
    vi.spyOn(SimState.prototype, 'run').mockImplementation(function (this: SimState, duration) {
      expect(this.now).toBe(0);
      expect(this.deck.hand).toEqual([]);
      expect(this.deck.gauge).toBe(0);
      expect(this.stacks).toBe(0);
      expect(this.readyAt.size).toBe(0);
      expect(this.build.skills.every(skill => this.isReady(skill.id))).toBe(true);
      expect(this.buffs.modsAt(0)).toEqual([]);
      expect(this.activeMods()).toEqual(build.passiveMods);
      expect(this.lastUsedCard()).toBeNull();
      states.push(this);
      return run.call(this, duration);
    });
    const result = simulate(build, cardsFor(variant), { durationSec: 30, iterations: 3, seed: 42 });
    expect(new Set(states).size).toBe(3);
    expect(new Set(states.map(state => state.deck)).size).toBe(3);
    expect(result.cardSupplyWarnings.filter(warning => warning.startsWith('각 반복은 빈 손패'))).toHaveLength(1);
  });

  it('does not carry a prior hand, gauge, stacks, cooldown, timed buff or card history into a fresh state', () => {
    const build = empressInkomsu440(), cards = cardsFor('empress');
    const prior = new SimState(build, createRng(42), cards);
    prior.drawCards(1, 'moon'); prior.useCardNow('moon'); prior.drawCards(1, 'cull');
    prior.deck.gauge = 0.7; prior.stacks = 4; prior.readyAt.set(build.skills[0]!.id, 100);
    const fresh = new SimState(build, createRng(42), cards);
    expect(prior.deck.hand).toEqual(['cull']);
    expect(prior.buffs.modsAt(0).length).toBeGreaterThan(0);
    expect(prior.lastUsedCard()).toBe('moon');
    expect(fresh.deck.hand).toEqual([]); expect(fresh.deck.gauge).toBe(0);
    expect(fresh.stacks).toBe(0); expect(fresh.isReady(build.skills[0]!.id)).toBe(true);
    expect(fresh.buffs.modsAt(0)).toEqual([]); expect(fresh.lastUsedCard()).toBeNull();
    expect(fresh.cardsDrawn).toBe(0); expect(fresh.cardsUsed).toBe(0);
    expect(fresh.activeMods()).toEqual(build.passiveMods);
  });
});
