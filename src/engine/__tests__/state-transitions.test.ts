import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { defaultRotation } from '../rotation';
import { runOnce, SimState } from '../sim';
import type { Build, SkillDef } from '../types';

// 상태 전이만 검사하는 합성 입력입니다. 실제 피해 계수나 최적 로테이션을 뜻하지 않습니다.
function skill(id: string, kind: SkillDef['kind'], extra: Partial<SkillDef> = {}): SkillDef {
  return { id, name: id, kind, cooldown: 1, castTime: 1, directCoef: 100, hits: 1, ...extra };
}

function build(skills: SkillDef[] = [], variant: Build['variant'] = 'empress'): Build {
  const params = empressInkomsu440().params;
  return {
    name: 'state transition test', variant, stats: { crit: 0, spec: 0, swift: 0 }, passiveMods: [], skills,
    rotation: defaultRotation(variant, skills),
    params: { ...params, gaugePerHit: { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 }, gaugeGainBonus: 0, normalGaugePenalty: 0 },
  };
}

const state = (b = build()) => new SimState(b, createRng(1), cardsFor(b.variant));

describe('wheel cooldown timing', () => {
  it.each(['normal', 'stack', 'ruin', 'hyper_awakening', 'awakening'] as const)('resets only the next %s cast, including T skills and regular awakening', kind => {
    const target = skill('target', kind, { cooldown: 20 });
    const s = state(build([target]));
    s.drawCards(1, 'wheel_of_fortune');
    s.useCardNow('wheel_of_fortune');
    s.cast(target, 100);
    expect(s.readyAt.get('target')).toBe(0);
    expect(s.nextSkillCdReset).toBe(false);
    s.cast(target, 100);
    expect(s.readyAt.get('target')).toBe(21);
  });

  it('does not make a cooling-down skill castable or consume the pending reset on an illegal cast', () => {
    const target = skill('celestial_rain', 'ruin', { cooldown: 20 });
    const s = state(build([target]));
    s.readyAt.set(target.id, 20);
    s.drawCards(1, 'wheel_of_fortune');
    s.useCardNow('wheel_of_fortune');
    expect(s.readyAt.get(target.id)).toBe(20);
    expect(() => s.cast(target, 100)).toThrow(/cooldown/);
    expect(s.nextSkillCdReset).toBe(true);
    expect(s.breakdown.get(target.id)!.casts).toBe(0);
    expect(s.now).toBe(0);
  });

  it('waits without spending wheel when every ruin is cooling down', () => {
    const s = state(build([skill('celestial_rain', 'ruin')]));
    s.stacks = 4;
    s.readyAt.set('celestial_rain', 20);
    s.drawCards(1, 'wheel_of_fortune');
    expect(s.chooseAction()).toBeNull();
    expect(s.deck.hand).toEqual(['wheel_of_fortune']);
  });

  it.each([
    ['celestial_rain', 'ruin', 'empress'],
    ['the_devil', 'hyper_awakening', 'empress'],
    ['the_sun', 'hyper_awakening', 'emperor'],
    ['dark_resurrection', 'normal', 'emperor'],
  ] as const)('plays wheel immediately before the ready target %s', (id, kind, variant) => {
    const s = state(build([skill(id, kind, { cooldown: 20, tags: id === 'the_devil' ? ['ruin'] : [] })], variant));
    s.stacks = 4;
    s.drawCards(1, 'wheel_of_fortune');
    s.run(1);
    expect(s.deck.hand).toEqual([]);
    expect(s.readyAt.get(id)).toBe(0);
    expect(s.nextSkillCdReset).toBe(false);
  });

  it('keeps wheel while casting a stack builder before its target', () => {
    const s = state(build([skill('scratch_dealer', 'stack', { stacksGranted: 2 }), skill('celestial_rain', 'ruin')]));
    s.drawCards(1, 'wheel_of_fortune');
    s.run(1);
    expect(s.deck.hand).toEqual(['wheel_of_fortune']);
    expect(s.readyAt.get('scratch_dealer')).toBe(1);
  });
});

describe('quick recharge remaining cooldowns', () => {
  it('reduces self and other active cooldowns, including T skills, but not awakening or ready skills', () => {
    const trigger = skill('trigger', 'normal', { cooldown: 20, runeCdReduce: { chance: 1, fraction: 0.5 } });
    const s = state(build([trigger, skill('slow', 'ruin'), skill('the_devil', 'hyper_awakening'), skill('awakening', 'awakening'), skill('ready', 'normal')]));
    s.now = 10;
    s.readyAt = new Map([['slow', 30], ['the_devil', 70], ['awakening', 310], ['ready', 5]]);
    s.cast(trigger, 100);
    expect(Object.fromEntries(s.readyAt)).toEqual({ trigger: 20, slow: 20, the_devil: 40, awakening: 310, ready: 5 });
  });

  it('does not reduce anything on a failed proc', () => {
    const trigger = skill('trigger', 'normal', { cooldown: 20, runeCdReduce: { chance: 0, fraction: 0.5 } });
    const s = state(build([trigger, skill('slow', 'normal')]));
    s.readyAt.set('slow', 30);
    s.cast(trigger, 100);
    expect(Object.fromEntries(s.readyAt)).toEqual({ slow: 30, trigger: 20 });
  });

  it('compounds successive procs against the remaining time at each use', () => {
    const a = skill('a', 'normal', { cooldown: 20, runeCdReduce: { chance: 1, fraction: 0.5 } });
    const b = skill('b', 'normal', { cooldown: 20, runeCdReduce: { chance: 1, fraction: 0.5 } });
    const s = state(build([a, b, skill('slow', 'normal')]));
    s.readyAt.set('slow', 40);
    s.cast(a, 100);
    s.cast(b, 100);
    expect(s.readyAt.get('slow')).toBe(10.5); // 40 -> 20; at t=1, 19 seconds remain.
    expect(s.readyAt.get('a')).toBe(5.5);
    expect(s.readyAt.get('b')).toBe(11);
  });

  it('procs on use even if the hit is after the fight ends', () => {
    const trigger = skill('trigger', 'normal', { runeCdReduce: { chance: 1, fraction: 0.5 } });
    const s = state(build([trigger, skill('slow', 'normal')]));
    s.readyAt.set('slow', 20);
    s.cast(trigger, 0.5);
    expect(s.readyAt.get('slow')).toBe(10);
    expect(s.total).toBe(0);
  });

  it('does not restore a cooldown removed by wheel', () => {
    const trigger = skill('trigger', 'normal', { cooldown: 20, runeCdReduce: { chance: 1, fraction: 0.5 } });
    const s = state(build([trigger, skill('slow', 'normal')]));
    s.readyAt.set('slow', 20);
    s.drawCards(1, 'wheel_of_fortune');
    s.useCardNow('wheel_of_fortune');
    s.cast(trigger, 100);
    expect(s.readyAt.get('trigger')).toBe(0);
    expect(s.readyAt.get('slow')).toBe(10);
  });
});

describe('judgment ruin classification', () => {
  it.each([0, 2, 4])('gives Devil the same four-stack effect as a ruin at %s actual stacks', stacks => {
    const results = (['ruin', 'hyper_awakening'] as const).map(kind => {
      const target = skill('target', kind, { tags: ['ruin'] });
      const s = state(build([target]));
      s.stacks = stacks;
      s.drawCards(1, 'judgment');
      s.useCardNow('judgment');
      s.cast(target, 100);
      expect(s.ruinAt4).toBe(1);
      expect(s.stacks).toBe(0);
      return s.breakdown.get('target')!.stackEffect;
    });
    expect(results[1]).toBe(results[0]);
    expect(results[1]).toBeGreaterThan(0);
  });

  // 현재 모델의 적용 구간 [사용 시각, 만료 시각)을 고정합니다. 실제 게임의 프레임 판정은 미검증입니다.
  it.each([[3.999, true], [4, false], [4.001, false]])('uses judgment only while active at hit time %s in the current model', (hitTime, active) => {
    const target = skill('the_devil', 'hyper_awakening', { tags: ['ruin'] });
    const s = state(build([target]));
    s.drawCards(1, 'judgment');
    s.useCardNow('judgment');
    s.now = hitTime - 1;
    s.cast(target, 100);
    expect(s.ruinAt4).toBe(active ? 1 : 0);
    expect(s.breakdown.get(target.id)!.stackEffect > 0).toBe(active);
  });

  it('does not give sun a ruin effect or consume its existing stacks', () => {
    const target = skill('the_sun', 'hyper_awakening');
    const s = state(build([target]));
    s.stacks = 2;
    s.drawCards(1, 'judgment');
    s.useCardNow('judgment');
    s.cast(target, 100);
    expect(s.ruinCasts).toBe(0);
    expect(s.stacks).toBe(2);
    expect(s.total).toBe(100);
  });

  it('applies four-stack conditions and on-ruin buffs to Devil under judgment', () => {
    const target = skill('the_devil', 'hyper_awakening', { tags: ['ruin'], mods: [{ bucket: 'skillDmg', value: 0.2, filter: { ids: ['the_devil'], minStacks: 4, component: 'direct' }, source: 'test' }] });
    const b = build([target]);
    b.onRuinAt4 = [{ id: 'on_ruin', duration: 6, mod: { bucket: 'atkSpeed', value: 0.08, source: 'test' } }];
    const s = state(b);
    s.drawCards(1, 'judgment');
    s.useCardNow('judgment');
    s.cast(target, 100);
    expect(s.breakdown.get(target.id)!.direct).toBe(120);
    expect(s.buffs.has('on_ruin', s.now)).toBe(true);
  });

  it.each(['cull', 'twisted_fate'])('plays held %s before a zero-stack judgment Devil', card => {
    const s = state(build([skill('the_devil', 'hyper_awakening', { tags: ['ruin'], cooldown: 20 })]));
    s.drawCards(1, 'judgment');
    s.drawCards(1, card);
    s.run(1);
    expect(s.deck.hand).toEqual([]);
    expect(s.buffs.has(card === 'cull' ? 'cull_rate' : card, s.now)).toBe(true);
    expect(s.ruinAt4).toBe(1);
  });

  it('keeps a second judgment while the first is active', () => {
    const s = state();
    s.drawCards(1, 'judgment');
    s.useCardNow('judgment');
    s.drawCards(1, 'judgment');
    s.now = 1;
    s.playHeldCardsForRuin(2, false);
    expect(s.deck.hand).toEqual(['judgment']);
    expect(s.buffs.remaining('judgment', s.now)).toBe(3);
  });
});

describe('clown card history', () => {
  it('copies the last used card, not the cards drawn since it was used', () => {
    const s = state();
    s.drawCards(1, 'moon');
    s.useCardNow('moon');
    s.drawCards(1, 'cull');
    s.drawCards(1, 'clown');
    s.useCardNow('clown');
    expect(s.deck.hand).toEqual(['cull', 'moon']);
    expect(s.cardsDrawn).toBe(4);
  });

  it('copies the latest successful use when both slots are consumed in order', () => {
    const s = state();
    s.drawCards(1, 'moon');
    s.drawCards(1, 'star');
    s.useCardNow('moon');
    s.useCardNow('star');
    s.useCardNow('corrosion'); // 손패에 없는 카드의 사용 실패는 이력을 바꾸면 안 됩니다.
    s.drawCards(1, 'clown');
    s.useCardNow('clown');
    expect(s.deck.hand).toEqual(['star']);
  });

  it('does not invent a previous card or recursively copy clown', () => {
    const s = state();
    s.drawCards(1, 'clown');
    s.useCardNow('clown');
    expect(s.deck.hand).toEqual([]);
    s.drawCards(1, 'moon');
    s.useCardNow('moon');
    s.drawCards(1, 'clown');
    s.useCardNow('clown');
    expect(s.deck.hand).toEqual(['moon']);
    s.drawCards(1, 'clown');
    s.useCardNow('clown');
    expect(s.deck.hand).toEqual(['moon']);
  });

  it('preserves the copied card identity when that card is already in hand', () => {
    const s = state();
    s.drawCards(1, 'moon');
    s.useCardNow('moon');
    s.drawCards(1, 'moon');
    s.drawCards(1, 'clown');
    s.useCardNow('clown');
    expect(s.deck.hand).toEqual(['moon', 'moon']);
    expect(s.deck.isFull).toBe(true);
    expect(s.deck.draw(s.rng, 'moon')).toBeNull();
  });

  it('allows a clown drawn by royal to copy royal instead of its draw result', () => {
    const s = new SimState(build(), createRng(1), cardsFor('empress').filter(c => ['royal', 'clown'].includes(c.id)));
    s.drawCards(1, 'royal');
    s.useCardNow('royal');
    expect(s.deck.hand).toContain('clown');
    s.useCardNow('clown');
    expect(s.deck.hand).toEqual(['royal', 'royal']);
  });
});

describe('emperor action selection', () => {
  const skills = [
    skill('scratch_dealer', 'stack', { stacksGranted: 2 }),
    skill('spiral_edge', 'stack', { stacksGranted: 2 }),
    skill('the_sun', 'hyper_awakening', { cooldown: 80 }),
    skill('dark_resurrection', 'normal', { cooldown: 27 }),
  ];

  it.each([0, 2, 4])('selects sun and normal skills independently of %s stacks', stacks => {
    const s = state(build(skills, 'emperor'));
    s.stacks = stacks;
    expect(s.build.rotation.ruinPriority).not.toContain('the_sun');
    expect(s.chooseAction()?.id).toBe('the_sun');
    s.readyAt.set('the_sun', 80);
    expect(s.chooseAction()?.id).toBe('dark_resurrection');
  });

  it.each([1, 11, 42])('continues normal skills after stacking at seed %s', seed => {
    const result = runOnce(build(skills, 'emperor'), [], seed, 60);
    expect(result.breakdown.find(s => s.id === 'the_sun')!.casts).toBe(1);
    expect(result.breakdown.find(s => s.id === 'dark_resurrection')!.casts).toBe(3);
  });

  it('uses sun with no equipped stack skills', () => {
    const result = runOnce(build([skills[2]!], 'emperor'), [], 1, 2);
    expect(result.breakdown[0]!.casts).toBe(1);
    expect(result.totalDamage).toBe(100);
  });

  it('still requires four stacks for an actual ruin when normal skills are unavailable', () => {
    const s = state(build([skill('celestial_rain', 'ruin')], 'emperor'));
    s.stacks = 2;
    expect(s.chooseAction()).toBeNull();
    s.stacks = 4;
    expect(s.chooseAction()?.id).toBe('celestial_rain');
    s.readyAt.set('celestial_rain', 10);
    expect(s.chooseAction()).toBeNull();
  });
});

describe('fight end boundary', () => {
  it.each([1, 11, 42])('does not resolve a hit beyond the end at seed %s', seed => {
    const b = build([skill('filler', 'normal')]);
    b.params.gaugePerHit.normal = 1;
    const result = runOnce(b, cardsFor('empress'), seed, 0.5);
    expect(result.totalDamage).toBe(0);
    expect(result.cardsDrawn).toBe(0);
    expect(result.breakdown[0]!.casts).toBe(1); // 시전 시작은 기록하고, 미적중 피해는 제외합니다.
  });

  it.each([[0.999, 0], [1, 100], [1.5, 100]])('counts only hits up to time %s', (duration, damage) => {
    const result = runOnce(build([skill('filler', 'normal')]), [], 1, duration);
    expect(result.totalDamage).toBe(damage);
  });

  it('does not consume stacks or apply an on-hit buff for a ruin that lands after the end', () => {
    const b = build([skill('celestial_rain', 'ruin')]);
    b.onRuinAt4 = [{ id: 'on_hit', duration: 6, mod: { bucket: 'atkSpeed', value: 0.08, source: 'test' } }];
    const s = state(b);
    s.stacks = 4;
    const result = s.run(0.5);
    expect(s.now).toBe(0.5);
    expect(s.stacks).toBe(4);
    expect(result.ruinCasts).toBe(0);
    expect(result.totalDamage).toBe(0);
    expect(s.buffs.has('on_hit', s.now)).toBe(false);
  });

  it('keeps on-cast events before the deadline even when the hit is later', () => {
    const b = build([skill('filler', 'normal', { tags: ['destiny'] })]);
    b.onDestiny = ['drawCard'];
    const s = new SimState(b, createRng(1), cardsFor('emperor').filter(c => c.id === 'emperor'));
    s.cardDamageCoef = { emperor: 500 };
    const result = s.run(0.5);
    expect(result.cardsDrawn).toBe(1);
    expect(s.deck.hand).toEqual(['emperor']);
    expect(result.totalDamage).toBe(0);
  });

  it('does not play an instant damage card drawn by a hit at the deadline', () => {
    const b = build([skill('filler', 'normal')]);
    b.params.gaugePerHit.normal = 1;
    b.params.cardDamageCoef = { emperor: 500 };
    const result = runOnce(b, cardsFor('emperor').filter(c => c.id === 'emperor'), 1, 1);
    expect(result.cardsDrawn).toBe(1);
    expect(result.totalDamage).toBe(100);
    expect(result.breakdown.some(s => s.id === 'card_emperor')).toBe(false);
  });
});
