import { describe, expect, it } from 'vitest';
import { cardSupplyWarnings } from '../cards';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { runOnce, simulate, SimState } from '../sim';
import type { CardDrawSource, SkillDef } from '../types';

// 수급 경로 계측을 위한 합성 입력입니다. 실제 스킬 게이지 수치를 뜻하지 않습니다.
function state(gain = 0, quickDraw = false) {
  const base = empressInkomsu440();
  const skill: SkillDef = { id: 'test', name: 'test', kind: 'normal', cooldown: 0, castTime: 1,
    hits: 1, directCoef: 10, tags: quickDraw ? ['quickdraw'] : [],
    ...(quickDraw ? { quickDraw: { chance: 1, trigger: 'each' as const, attempts: 1 } } : {}) };
  return new SimState({ ...base, skills: [skill], passiveMods: [],
    rotation: { ruinPriority: [], stackPriority: [], fillers: [skill.id] }, onDestiny: ['drawCard'],
    params: { ...base.params, gaugePerHit: { normal: gain, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 },
      gaugeGainBonus: 0, normalGaugePenalty: 0 } }, createRng(42), cardsFor('empress'));
}
const hit = (s: SimState) => s.cast(s.build.skills[0]!, 100);
const sum = (s: SimState) => Object.values(s.cardDraws).reduce((a, b) => a + b, 0);

describe('card supply attribution', () => {
  it('counts only completed gauge draws, not partial gauge or blocked gains', () => {
    const s = state(0.6);
    hit(s); expect(s.cardDraws.gauge).toBe(0);
    hit(s); expect(s.cardDraws.gauge).toBe(1);
    expect(s.deck.gauge).toBeCloseTo(0.2);
    hit(s); hit(s); expect(s.cardDraws.gauge).toBe(2);
    hit(s); expect(s.cardDraws.gauge).toBe(2);
    expect(sum(s)).toBe(s.cardsDrawn);
    expect(s.deck.drawn).toBe(s.cardsDrawn);
  });

  it('distinguishes gauge and Quick Draw in the same hit and excludes full-hand attempts', () => {
    const s = state(1, true);
    hit(s);
    expect(s.cardDraws.gauge).toBe(1); expect(s.cardDraws.quickDraw).toBe(1);
    hit(s);
    expect(s.cardDraws.gauge).toBe(1); expect(s.cardDraws.quickDraw).toBe(1);
    expect(s.cardsDrawn).toBe(2);
  });

  it('does not count a failed Quick Draw proc or a hit beyond the fight end', () => {
    const s = state(0, true); s.build.skills[0]!.quickDraw!.chance = 0;
    hit(s); expect(s.cardsDrawn).toBe(0);
    s.build.skills[0]!.quickDraw!.chance = 1;
    s.cast(s.build.skills[0]!, s.now + 0.1);
    expect(s.cardDraws.quickDraw).toBe(0);
  });

  it.each([0, 1])('attributes Royal with %s other card held to the actual free slots', occupied => {
    const s = state();
    if (occupied) s.drawCards(1, 'cull');
    s.drawCards(1, 'royal'); s.useCardNow('royal');
    expect(s.cardDraws.royal).toBe(2 - occupied);
    expect(s.cardDraws.manual).toBe(1 + occupied);
    expect(s.deck.hand).toHaveLength(2);
    expect(sum(s)).toBe(s.cardsDrawn);
  });

  it('attributes a cloned card to Clown, not to the origin of the copied card', () => {
    const s = state();
    s.drawCards(1, 'moon'); s.useCardNow('moon');
    s.drawCards(1, 'moon'); s.drawCards(1, 'clown'); s.useCardNow('clown');
    expect(s.deck.hand).toEqual(['moon', 'moon']);
    expect(s.cardDraws.clown).toBe(1); expect(s.cardDraws.manual).toBe(3);
    expect(sum(s)).toBe(s.cardsDrawn);
  });

  it('does not count Clown when there is no previously used card', () => {
    const s = state(); s.drawCards(1, 'clown'); s.useCardNow('clown');
    expect(s.cardDraws.clown).toBe(0); expect(s.cardsDrawn).toBe(1);
  });

  it('separates Empress Knight, destiny and control injections', () => {
    const s = state(); s.drawCards(1, 'empress_knight'); s.useCardNow('empress_knight');
    s.triggerDestiny(); s.triggerDestiny();
    expect(s.cardDraws.empressKnight).toBe(1); expect(s.cardDraws.destiny).toBe(1);
    expect(s.cardDraws.manual).toBe(1);
    expect(sum(s)).toBe(s.cardsDrawn);
  });

  it('aggregates every source with the same duration and iteration denominator', () => {
    const s = state(0.3, true);
    const cfg = { durationSec: 37, iterations: 3, seed: 42 };
    const summary = simulate(s.build, cardsFor('empress'), cfg);
    const runs = Array.from({ length: cfg.iterations }, (_, i) => runOnce(s.build, cardsFor('empress'), cfg.seed + i * 7919, cfg.durationSec));
    for (const source of Object.keys(summary.cardsPerMinBySource) as CardDrawSource[]) {
      const expected = runs.reduce((total, r) => total + r.cardDraws[source], 0) / 3 / 37 * 60;
      expect(summary.cardsPerMinBySource[source]).toBeCloseTo(expected, 12);
    }
    expect(Object.values(summary.cardsPerMinBySource).reduce((a, b) => a + b, 0)).toBeCloseTo(summary.cardsPerMin, 12);
    expect(summary.cardsPerMinBySource.manual).toBe(0);
    expect(summary.cardSupplyWarnings).toEqual(cardSupplyWarnings(s.build));
  });

  it('exposes the placeholder gauge model and relevant unresolved mechanics', () => {
    const s = state();
    expect(cardSupplyWarnings(s.build).some(w => w.includes('임시값'))).toBe(true);
    expect(cardSupplyWarnings(s.build).some(w => w.includes('퀵 드로'))).toBe(false);
    expect(cardSupplyWarnings(state(0, true).build).some(w => w.includes('퀵 드로'))).toBe(true);
    expect(cardSupplyWarnings(empressInkomsu440()).some(w => w.includes('눈속임'))).toBe(true);
  });
});
