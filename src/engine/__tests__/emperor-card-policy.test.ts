import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { defaultRotation } from '../rotation';
import { SimState } from '../sim';
import type { Build, SkillDef } from '../types';

// 합성 피해·시간으로 자동 사용 여부만 검사합니다. 실제 로테이션 최적화 검증이 아닙니다.
function skill(id: string, extra: Partial<SkillDef> = {}): SkillDef {
  return { id, name: id, kind: 'normal', directCoef: 100, hits: 1, cooldown: 20, castTime: 1, ...extra };
}
function state(skills = [skill('dark_resurrection')], variant: Build['variant'] = 'emperor') {
  const build = empressInkomsu440();
  build.variant = variant; build.skills = skills; build.rotation = defaultRotation(variant, skills);
  build.passiveMods = []; build.bluntThorn = undefined; build.cardDurationBonus = undefined;
  build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = [];
  build.params.atkBase = 1; build.params.gaugeGainBonus = 0; build.params.normalGaugePenalty = 0;
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  build.params.twistedFateZeroChance = 0;
  return new SimState(build, createRng(1), cardsFor(variant, { add: ['chancellor', 'sovereign'], remove: ['balance', 'judgment'] }));
}

describe('Emperor held-card baseline policy', () => {
  it.each(['dark_resurrection', 'unlimited_shuffle', 'evoke', 'the_sun'])('plays Sovereign before %s without requiring stacks', id => {
    const s = state([skill(id, id === 'the_sun' ? { kind: 'hyper_awakening', tags: ['normal'] } : {})]);
    s.drawCards(1, 'sovereign');
    expect(s.run(1).totalDamage).toBe(150); expect(s.deck.hand).toEqual([]); expect(s.stacks).toBe(0);
  });
  it('uses Cull and Sovereign together and frees both card slots', () => {
    const s = state(); s.drawCards(1, 'cull'); s.drawCards(1, 'sovereign');
    expect(s.run(1).totalDamage).toBe(375); expect(s.deck.hand).toEqual([]);
  });
  it('uses Twisted Fate on a primary normal skill', () => {
    const s = state(); s.drawCards(1, 'twisted_fate');
    expect(s.run(1).totalDamage).toBeGreaterThan(100); expect(s.deck.hand).not.toContain('twisted_fate');
  });
  it.each(['return', 'call_of_destiny', 'mysterious_stampede'])('keeps held cards for a primary skill rather than %s', id => {
    const s = state([skill(id)]); s.drawCards(1, 'cull'); s.drawCards(1, 'sovereign');
    expect(s.run(1).totalDamage).toBe(100); expect(s.deck.hand).toEqual(['cull', 'sovereign']);
  });
  it('waits when the primary is cooling down and does not discard cards during idle time', () => {
    const s = state(); s.readyAt.set('dark_resurrection', 5); s.drawCards(1, 'sovereign');
    expect(s.run(2).totalDamage).toBe(0); expect(s.deck.hand).toEqual(['sovereign']);
    expect(s.run(6.1).totalDamage).toBe(150); expect(s.deck.hand).toEqual([]);
  });
  it('does not overwrite an active buff with a copied duplicate before it expires', () => {
    const s = state([skill('dark_resurrection', { cooldown: 1 })]);
    s.drawCards(1, 'sovereign'); s.useCardNow('sovereign'); s.drawCards(1, 'sovereign');
    s.run(1); expect(s.deck.hand).toEqual(['sovereign']);
    s.now = 4; s.run(5); expect(s.deck.hand).toEqual([]); expect(s.buffs.has('sovereign', 5)).toBe(true);
  });
  it('preserves the Empress policy for normal fillers', () => {
    const s = state([skill('dark_resurrection')], 'empress'); s.drawCards(1, 'cull');
    expect(s.run(1).totalDamage).toBe(100); expect(s.deck.hand).toEqual(['cull']);
  });
  it('does not use Sovereign for a normal-looking ID with a non-normal classification', () => {
    const s = state([skill('the_sun', { kind: 'hyper_awakening' })]); s.drawCards(1, 'sovereign');
    expect(s.run(1).totalDamage).toBe(100); expect(s.deck.hand).toEqual(['sovereign']);
  });
  it('defers manual Evoke buffs from installation to detonation input', () => {
    const s = state([skill('evoke', { manualEvoke: { duration: 1, placementAt: 0.2, minRecastDelay: 1, lifetime: 10,
      recastRecovery: 0, hits: [{ after: 0, weight: 1 }] } })]);
    s.drawCards(1, 'sovereign'); s.run(1);
    expect(s.deck.hand).toEqual(['sovereign']); expect(s.total).toBe(0);
    s.run(2); expect(s.total).toBe(150); expect(s.deck.hand).toEqual([]);
  });
  it('does not hold skills waiting for an absent card', () => {
    const s = state(); expect(s.run(1).totalDamage).toBe(100);
  });
});

describe('Emperor Normal Enhance card input order', () => {
  function enhanced(id = 'unlimited_shuffle', extra: Partial<SkillDef> = {}) {
    const s = state([skill(id, extra)]);
    s.build.stackHold = true; s.build.normalEnhanceCooldown = 0.1;
    return s;
  }
  function pair(s: SimState) { s.drawCards(1, 'cull'); s.drawCards(1, 'sovereign'); }

  it.each(['unlimited_shuffle', 'the_sun'])('refunds the started %s cooldown and buffs its first hit', id => {
    const s = enhanced(id, id === 'the_sun' ? { kind: 'hyper_awakening', tags: ['normal'] } : {});
    pair(s); expect(s.run(1).totalDamage).toBe(375);
    expect(s.readyAt.get(id)).toBe(18); expect(s.cardsUsed).toBe(2);
  });
  it('keeps Dark Resurrection on the previous input policy', () => {
    const s = enhanced('dark_resurrection'); pair(s); s.run(1);
    expect(s.readyAt.get('dark_resurrection')).toBe(20);
  });
  it('keeps High Tempo before the skill when Normal Enhance is absent', () => {
    const s = enhanced(); delete s.build.normalEnhanceCooldown;
    s.build.skills[0]!.usesMana = true;
    s.build.onDestiny = [{ id: 'high_tempo', duration: 5,
      mod: { bucket: 'cooldown', value: 0.12, filter: { usesMana: true }, source: '통제' } }];
    pair(s); s.run(1); expect(s.readyAt.get('unlimited_shuffle')).toBe(17.6);
  });
  it('still uses Wheel before starting the selected skill cooldown', () => {
    const s = enhanced(); s.build.rotation.wheelTargets = ['unlimited_shuffle'];
    s.drawCards(1, 'wheel_of_fortune'); s.drawCards(1, 'sovereign'); s.run(1);
    expect(s.readyAt.get('unlimited_shuffle')).toBe(0); expect(s.nextSkillCdReset).toBe(false);
    expect(s.cardsUsed).toBe(2); expect(s.total).toBe(150);
  });
  it('applies Moon before the cooldown and the second card refund afterwards', () => {
    const s = enhanced(); s.drawCards(1, 'moon'); s.drawCards(1, 'sovereign'); s.run(1);
    expect(s.readyAt.get('unlimited_shuffle')).toBeCloseTo(14.4, 12);
  });
  it('does not invent a Destiny activation for the first card', () => {
    const s = enhanced(); s.drawCards(1, 'sovereign'); s.run(1);
    expect(s.readyAt.get('unlimited_shuffle')).toBe(20); expect(s.total).toBe(150);
  });
  it('keeps a duplicate active Cull while the other card triggers the refund', () => {
    const s = enhanced(); s.drawCards(1, 'cull'); s.useCardNow('cull'); pair(s); s.run(1);
    expect(s.deck.hand).toEqual(['cull']); expect(s.cardsUsed).toBe(2);
    expect(s.readyAt.get('unlimited_shuffle')).toBe(18); expect(s.total).toBe(375);
  });
  it('does not use a held buff without normal classification', () => {
    const s = enhanced('the_sun', { kind: 'hyper_awakening' }); pair(s); s.run(1);
    expect(s.cardsUsed).toBe(0); expect(s.deck.hand).toHaveLength(2); expect(s.total).toBe(100);
  });
  it('does not force automatic cards into a direct cast', () => {
    const s = enhanced(); pair(s); s.cast(s.skill('unlimited_shuffle'), 1);
    expect(s.cardsUsed).toBe(0); expect(s.total).toBe(100); expect(s.readyAt.get('unlimited_shuffle')).toBe(20);
  });
  it('does not consume a new card acquired at the end of this cast', () => {
    const template = enhanced('unlimited_shuffle', { quickDraw: { chance: 1, trigger: 'last', attempts: 1 } });
    const s = new SimState(template.build, createRng(1), cardsFor('emperor', { add: ['sovereign'] }).filter(c => c.id === 'sovereign'));
    s.run(1); expect(s.cardsUsed).toBe(0); expect(s.deck.hand).toEqual(['sovereign']);
  });
  it('does not adopt the policy for Empress', () => {
    const s = enhanced(); s.build.variant = 'empress'; pair(s); s.run(1);
    expect(s.cardsUsed).toBe(0); expect(s.total).toBe(100);
  });
});
