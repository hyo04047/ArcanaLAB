import { describe, expect, it } from 'vitest';
import { cardSupplyWarnings } from '../cards';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier } from '../types';

// 합성 입력입니다. 미확인 Lv70 카드 계수를 실측으로 검증하는 테스트가 아닙니다.
function state(atk = 100, mods: Modifier[] = [], coef = 2, flat = 30) {
  const build = empressInkomsu440();
  build.variant = 'emperor'; build.passiveMods = mods; build.bluntThorn = undefined; build.cardDurationBonus = undefined;
  build.params.atkBase = atk;
  build.params.cardDamageCoef = { emperor: coef, empress_knight: coef };
  build.params.cardDamageFlat = { emperor: flat, empress_knight: flat };
  return new SimState(build, createRng(1), cardsFor('emperor', { add: ['empress_knight'] }));
}
function play(s: SimState, card: string) { s.drawCards(1, card); s.useCardNow(card); }

describe('identity card damage control path', () => {
  it.each(['emperor', 'empress_knight'])('separates flat damage and attack coefficient for %s', card => {
    for (const atk of [0, 100, 1000]) {
      const s = state(atk); play(s, card);
      expect(s.total).toBe(30 + 2 * atk);
      expect(s.breakdown.get(`card_${card}`)).toMatchObject({ casts: 1, direct: s.total, stackEffect: 0 });
    }
  });
  it('applies flat and percentage attack bonuses to only the attack term', () => {
    const s = state(100, [{ bucket: 'atkFlat', value: 20, source: 'control' }, { bucket: 'atk', value: 0.5, source: 'control' }]);
    play(s, 'emperor'); expect(s.total).toBe(30 + 2 * (100 + 20) * 1.5);
  });
  it('supports flat-only input through actual card use', () => {
    const s = state(1000, [], 0, 30); play(s, 'emperor'); expect(s.total).toBe(30);
  });
  it('keeps coefficient-only inputs compatible', () => {
    const s = state(); delete s.build.params.cardDamageFlat;
    play(s, 'emperor'); expect(s.total).toBe(200);
  });
  it.each(['emperor', 'empress_knight'])('does not manufacture damage for missing %s inputs', card => {
    const s = state(100, [], 0, 0); play(s, card);
    expect(s.total).toBe(0); expect(s.breakdown.has(`card_${card}`)).toBe(false);
    expect(s.cardDraws.empressKnight).toBe(card === 'empress_knight' ? 1 : 0);
  });
  it.each(['emperor', 'empress_knight'])('excludes normal-only bonuses from %s in the provisional identity model', card => {
    const s = state(100, [{ bucket: 'skillDmg', value: 0.5, filter: { kinds: ['normal'] }, source: '만찬 control' }]);
    play(s, 'sovereign'); play(s, 'chancellor'); play(s, card);
    expect(s.total).toBe(230);
  });
  it.each(['emperor', 'empress_knight'])('excludes mana-only, stack-effect and unrelated skill modifiers from %s', card => {
    const s = state(100, [
      { bucket: 'skillDmg', value: 10, filter: { usesMana: true }, source: 'mana control' },
      { bucket: 'stackEffectDmg', value: 10, source: 'stack control' },
      { bucket: 'skillDmg', value: 10, filter: { ids: ['the_sun'] }, source: 'Sun control' },
    ]);
    s.stacks = 4; play(s, 'judgment'); play(s, card);
    expect(s.total).toBe(230); expect(s.stacks).toBe(4); expect(s.ruinCasts).toBe(0);
  });
  it('applies generic damage and card-specific modifiers to both terms', () => {
    const s = state(100, [
      { bucket: 'dmgToEnemy', value: 0.2, source: 'control' },
      { bucket: 'skillDmg', value: 0.5, filter: { ids: ['card_emperor'] }, source: 'control' },
    ]);
    play(s, 'emperor'); expect(s.total).toBeCloseTo(230 * 1.2 * 1.5, 10);
    play(s, 'empress_knight'); expect(s.breakdown.get('card_empress_knight')!.direct).toBeCloseTo(230 * 1.2, 10);
  });
  it.each(['emperor', 'empress_knight'])('reads Cull at %s use and drops it at expiry', card => {
    const s = state(); play(s, 'cull'); play(s, card); expect(s.total).toBe(230 * 2.5);
    s.now = 4; play(s, card); expect(s.total).toBe(230 * 3.5);
  });
  it('does not gain gauge, spend wheel, start a skill cooldown or trigger skill runes', () => {
    const s = state(); s.deck.gauge = 0.25; s.stacks = 4;
    play(s, 'wheel_of_fortune'); play(s, 'emperor');
    expect(s.nextSkillCdReset).toBe(true); expect(s.deck.gauge).toBe(0.25);
    expect(s.readyAt.size).toBe(0); expect(s.now).toBe(0);
    expect(s.stacks).toBe(4); expect(s.cardsDrawn).toBe(2);
  });
  it('does not deal damage for a card absent from the hand', () => {
    const s = state(); s.useCardNow('emperor'); expect(s.total).toBe(0);
  });
  it('reports missing automatic values and provisional scope even with manual inputs', () => {
    const s = state(); const warnings = cardSupplyWarnings(s.build);
    expect(warnings.some(w => w.includes('자동 입력이 0'))).toBe(true);
    expect(warnings.some(w => w.includes('황후의 기사') && w.includes('추가 검증'))).toBe(true);
  });
});
