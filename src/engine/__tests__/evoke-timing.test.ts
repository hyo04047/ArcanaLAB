import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillBreakdown, SkillDef } from '../types';

const evidence = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-12-evoke-sources.json', 'utf8'));
function input(selected = ['퀵 드로', '집속 마법진', '분할 마법진']): RawArmory {
  const source = evidence.officialApi.skill;
  return { profiles: JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8')),
    combatSkills: [{ Name: '이보크', Level: 10, Type: '일반', SkillType: 0, Tooltip: source.tooltip,
      Tripods: source.tripods.map((t: { Name: string }) => ({ ...t, IsSelected: selected.includes(t.Name) })) }],
    arkpassive: null, arkgrid: null, engravings: null, gems: null };
}

describe('Split Evoke conversion and provenance', () => {
  it('connects official 3s/two-use tooltip and the public placement candidate', () => {
    const result = buildFromArmory(input());
    const skill = result.build.skills[0]!;
    const motion = evidence.publicMotions.rows.find((r: { stageId: number }) => r.stageId === 2);
    expect(skill.splitEvoke).toEqual({ duration: 1.3, placementAt: 0.326, delay: 2, window: 3 });
    expect(skill.castTime * 1000).toBe(motion.durationMs);
    expect(skill.splitEvoke!.placementAt * 1000).toBe(motion.projectileSpawns[0].time_ms);
    expect(evidence.publicMotions.separateFollowupMotionFound).toBe(false);
    expect(result.warnings.some(w => w.includes('같은 모션을 가정'))).toBe(true);
    expect(result.warnings.some(w => w.includes('분할 마법진 해석 못함'))).toBe(false);
    expect(cardSupplyWarnings(result.build).some(w => w.includes('시전 종료'))).toBe(false);
    expect(cardSupplyWarnings(result.build).some(w => w.includes('시전 도중 카드'))).toBe(true);
  });

  it('supports the delayed split without Quick Draw', () => {
    const s = buildFromArmory(input(['빠른 준비', '치명적 공격', '분할 마법진'])).build.skills[0]!;
    expect(s.splitEvoke).toBeDefined(); expect(s.quickDraw).toBeUndefined();
    expect(s.cooldown).toBe(16);
  });

  it.each([{ selected: [] }, { selected: ['중첩 마법진'] }])('does not infer split from unselected tooltip: $selected', ({ selected }) => {
    expect(buildFromArmory(input(selected)).build.skills[0]!.splitEvoke).toBeUndefined();
  });

  it.each([undefined, '', '더 이상 원하는 타이밍에 터트리지 못하지만, 0.0초 동안 이보크를 2회 사용할 수 있다.',
    '더 이상 원하는 타이밍에 터트리지 못하지만, 3.0초 동안 이보크를 2회 사용할 수 있다. 추가 조건.'])('does not guess an invalid split tooltip: %s', tooltip => {
    const raw = input(); raw.combatSkills[0]!.Tripods!.find(t => t.Name === '분할 마법진')!.Tooltip = tooltip;
    const result = buildFromArmory(raw);
    expect(result.build.skills[0]!.splitEvoke).toBeUndefined();
    expect(result.warnings.some(w => w.includes('분할 마법진 해석 못함'))).toBe(true);
  });

  it('applies Gale to the motion, leaving installation delay and chain window intact', () => {
    const raw = input(); raw.combatSkills[0]!.Rune = { Name: '질풍', Grade: '전설',
      Tooltip: JSON.stringify({ Element_000: { type: 'SingleTextBox', value: '스킬 시전 속도가 14.0% 증가' } }) };
    const s = buildFromArmory(raw).build.skills[0]!;
    expect(s.castTime).toBeCloseTo(1.3 / 1.14); expect(s.splitEvoke!.delay).toBe(2); expect(s.splitEvoke!.window).toBe(3);
  });

  it('keeps poison tooltip damage out of coefficients and marks the DOT candidate', () => {
    const plain = buildFromArmory(input(['분할 마법진'])).build.skills[0]!;
    const result = buildFromArmory(input(['마나 중독', '분할 마법진']));
    const s = result.build.skills[0]!;
    expect(s.directCoef).toBe(plain.directCoef); expect(s.directFlat).toBe(plain.directFlat);
    expect(s.mods).toContainEqual({ bucket: 'skillDmg', value: -0.3, filter: { ids: ['evoke'], component: 'direct' }, source: '마나 중독' });
    expect(s.manaPoison).toBeDefined();
    expect(result.warnings.some(w => w.includes('트포 +72%'))).toBe(true);
  });
});

class TraceState extends SimState {
  hits: { id: string; at: number; damage: number }[] = [];
  override hit(skill: SkillDef, b: SkillBreakdown, first = true, last = true): void {
    const before = this.total;
    super.hit(skill, b, first, last);
    this.hits.push({ id: skill.id, at: this.now, damage: this.total - before });
  }
}

// 이진수로 정확히 표현되는 소수를 사용한 통제 시각입니다. 게임 측정값이 아닙니다.
function state(outcomes = [true, true]) {
  const evoke: SkillDef = { id: 'evoke', name: '이보크', kind: 'normal', cooldown: 10, castTime: 1,
    directCoef: 1, hits: 1, splitEvoke: { duration: 1, placementAt: 0.25, delay: 2, window: 3 },
    quickDraw: { chance: 0.2, trigger: 'each', attempts: 1 } };
  const other: SkillDef = { id: 'other', name: 'other', kind: 'normal', cooldown: 10, castTime: 3, directCoef: 0, hits: 1 };
  const build = empressInkomsu440();
  build.skills = [evoke, other]; build.variant = 'emperor'; build.passiveMods = []; build.onCardUse = [];
  build.onDestiny = []; build.bluntThorn = undefined; build.onRuinAt4 = [];
  build.rotation = { ruinPriority: [], stackPriority: [], fillers: ['evoke', 'other'], wheelTargets: ['evoke'] };
  build.params.atkBase = 100; build.params.gaugeGainBonus = 0; build.params.normalGaugePenalty = 0;
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  const checks: number[] = [];
  const rng = { ...createRng(1), chance(p: number) {
    if (p !== 0.2) return false;
    checks.push(p); return outcomes[checks.length - 1] ?? false;
  } };
  // Unknown synthetic card has no effect when used; it only tests available hand slots.
  const sim = new TraceState(build, rng, ['test', 'test2'].map(id => ({ id, name: id, weight: 1, duration: 0, availability: ['emperor'] })));
  return { sim, evoke, other, checks };
}
const evokeHits = (s: TraceState) => s.hits.filter(h => h.id === 'evoke');

describe('Split Evoke scheduled explosion processing', () => {
  it('does not hit or draw on installation; spends another action on the second circle', () => {
    const { sim, evoke, checks } = state();
    sim.cast(evoke, 10);
    expect([sim.now, sim.total, sim.cardsDrawn]).toEqual([1, 0, 0]); expect(checks).toHaveLength(0);
    expect(sim.readyAt.has('evoke')).toBe(false);
    sim.cast(evoke, 10);
    expect([sim.now, sim.total, sim.cardsDrawn]).toEqual([2, 0, 0]);
    expect(sim.readyAt.get('evoke')).toBe(11); expect(sim.breakdown.get('evoke')!.casts).toBe(1);
    expect(() => sim.cast(evoke, 10)).toThrow('cooldown');
    sim.advanceTo(3.25);
    expect(evokeHits(sim)).toEqual([{ id: 'evoke', at: 2.25, damage: 100 }, { id: 'evoke', at: 3.25, damage: 100 }]);
    expect(checks).toHaveLength(2); expect(sim.cardDraws.quickDraw).toBe(2);
  });

  it('explodes during another cast using buffs present on impact, and leaves cards until the next action', () => {
    const { sim, evoke, other } = state(); sim.cast(evoke, 10);
    other.onCast = [{ id: 'impact_buff', duration: 2, mod: { bucket: 'dmgToEnemy', value: 1, source: 'test' } }];
    sim.cast(other, 10);
    expect(sim.hits).toEqual([{ id: 'evoke', at: 2.25, damage: 200 }, { id: 'other', at: 4, damage: 0 }]);
    expect(sim.deck.hand).toHaveLength(1);
    sim.flushInstantCards(); expect(sim.deck.hand).toHaveLength(0);
  });

  it.each([[2.25, 100], [2.251, 200]])('expires installation-time buffs at %s before deciding damage', (expires, damage) => {
    const { sim, evoke } = state();
    sim.applyBuff({ id: 'early', duration: expires, mod: { bucket: 'dmgToEnemy', value: 1, source: 'test' } });
    sim.cast(evoke, 10); sim.advanceTo(2.25);
    expect(sim.total).toBe(damage);
  });

  it.each([1, 1.4])('scales only motion with attack speed multiplier %s', speed => {
    const { sim, evoke } = state();
    sim.build.passiveMods.push({ bucket: 'atkSpeed', value: speed - 1, source: 'test' }, { bucket: 'cooldown', value: 0.5, source: 'test' });
    sim.cast(evoke, 10); sim.cast(evoke, 10); sim.advanceTo(4);
    expect(evokeHits(sim).map(h => h.at)).toEqual([0.25 / speed + 2, 1.25 / speed + 2]);
    expect(sim.readyAt.get('evoke')).toBe(1 / speed + 5);
  });

  it('interleaves scheduled explosions with multi-hit attacks', () => {
    const { sim, evoke, other } = state(); sim.cast(evoke, 10);
    other.hitSequence = { duration: 3, hits: [0.5, 1.5, 2.5].map(at => ({ at, directCoef: 0, directFlat: 0 })) };
    sim.cast(other, 10);
    expect(sim.hits.map(h => [h.id, h.at])).toEqual([['other', 1.5], ['evoke', 2.25], ['other', 2.5], ['other', 3.5]]);
  });

  it('processes an explosion during the recovery after normal Serendipity first-hit usage', () => {
    const { sim, evoke, other } = state();
    other.id = 'serendipity'; other.hitSequence = { duration: 3, firstHitEnd: 2,
      hits: [0.5, 1.5, 2.5].map(at => ({ at, directCoef: 0, directFlat: 0 })) };
    sim.breakdown.set(other.id, { id: other.id, name: other.name, casts: 0, direct: 0, stackEffect: 0 });
    sim.cast(evoke, 10); sim.cast(other, 10);
    expect(sim.hits.map(h => [h.id, h.at])).toEqual([['serendipity', 1.5], ['evoke', 2.25]]);
    expect(sim.now).toBe(3);
  });

  it.each([[0.249, 0], [0.25, 0], [2.249, 0], [2.25, 1], [3.249, 1], [3.25, 2]])('counts only explosions reached by fight end %s', (end, count) => {
    const { sim, checks } = state(); sim.build.rotation.fillers = ['evoke'];
    sim.run(end);
    expect(evokeHits(sim)).toHaveLength(count); expect(checks).toHaveLength(count); expect(sim.total).toBe(count * 100);
    expect(sim.now).toBe(end);
  });

  it('does not schedule a circle if combat ends before its placement', () => {
    const { sim, evoke } = state(); sim.cast(evoke, 0.249); sim.advanceTo(10);
    expect(evokeHits(sim)).toHaveLength(0);
  });

  it('does not spend followup window while attack speed scales the motion', () => {
    const { sim, evoke } = state(); sim.build.passiveMods = [{ bucket: 'atkSpeed', value: 0.4, source: 'test' }];
    const expires = 0.25 / 1.4 + 3;
    sim.cast(evoke, 10); sim.advanceTo(expires - 0.001);
    expect(sim.isReady('evoke')).toBe(true);
    sim.advanceTo(expires); expect(sim.isReady('evoke')).toBe(false); expect(sim.readyAt.get('evoke')).toBeCloseTo(expires + 10);
  });

  it('expires an unused second placement while another skill is casting', () => {
    const { sim, evoke, other } = state(); sim.cast(evoke, 10); sim.cast(other, 10);
    expect(sim.readyAt.get('evoke')).toBe(13.25); expect(evokeHits(sim)).toHaveLength(1);
    expect(() => sim.cast(evoke, 10)).toThrow('cooldown');
    sim.advanceTo(13.25); expect(sim.isReady('evoke')).toBe(true);
  });

  it('accepts a second input just before expiry even if placement is after expiry', () => {
    const { sim, evoke } = state(); sim.cast(evoke, 10); sim.advanceTo(3.249); sim.cast(evoke, 10); sim.advanceTo(6);
    expect(sim.readyAt.get('evoke')).toBe(13.249);
    expect(evokeHits(sim)).toHaveLength(2); expect(evokeHits(sim)[1]!.at).toBeCloseTo(5.499);
  });

  it('keeps explosions from an older cooldown-reset cycle', () => {
    const { sim, evoke } = state(); sim.setNextSkillCooldownReset();
    sim.cast(evoke, 10); sim.cast(evoke, 10); sim.cast(evoke, 10); sim.cast(evoke, 10); sim.advanceTo(6);
    expect(evokeHits(sim).map(h => h.at)).toEqual([2.25, 3.25, 4.25, 5.25]);
    expect(sim.breakdown.get('evoke')!.casts).toBe(2); expect(sim.readyAt.get('evoke')).toBe(13);
  });

  it('consumes a new Wheel on the followup input when cooldown starts', () => {
    const { sim, evoke } = state(); sim.cast(evoke, 10); sim.setNextSkillCooldownReset(); sim.cast(evoke, 10);
    expect(sim.nextSkillCdReset).toBe(false); expect(sim.readyAt.get('evoke')).toBe(1);
  });

  it('does not reduce a cooldown that has not started yet or shorten the followup window', () => {
    const { sim, evoke } = state(); sim.cast(evoke, 10); sim.reduceAllCooldowns(0.5);
    sim.advanceTo(3.25); expect(sim.readyAt.get('evoke')).toBe(13.25);
    sim.reduceAllCooldowns(0.5); expect(sim.readyAt.get('evoke')).toBe(8.25);
  });

  it('uses the next action for the followup even when a higher priority skill becomes ready', () => {
    const { sim, evoke } = state(); sim.build.rotation.fillers = ['other', 'evoke']; sim.cast(evoke, 10);
    expect(sim.chooseAction()).toBe(evoke);
  });

  it('keeps first and second Quick Draw checks independent', () => {
    let expectation = 0;
    for (let mask = 0; mask < 4; mask++) {
      const outcomes = [0, 1].map(i => !!(mask & (1 << i)));
      const successes = outcomes.filter(Boolean).length;
      const { sim, evoke, checks } = state(outcomes); sim.cast(evoke, 10); sim.cast(evoke, 10); sim.advanceTo(4);
      expect(checks).toHaveLength(2); expect(sim.cardDraws.quickDraw).toBe(successes);
      expectation += successes * 0.2 ** successes * 0.8 ** (2 - successes);
    }
    expect(expectation).toBeCloseTo(0.4, 12);
  });

  it('respects hand capacity on delayed Quick Draw attempts', () => {
    const { sim, evoke, checks } = state(); sim.build.params.gaugePerHit.normal = 0.1;
    sim.drawCards(2, 'test'); sim.cast(evoke, 10); sim.cast(evoke, 10);
    expect(sim.deck.gauge).toBe(0); sim.advanceTo(4);
    expect(sim.deck.gauge).toBe(0); expect(checks).toHaveLength(2); expect(sim.cardDraws.quickDraw).toBe(0);
  });

  it('grants gauge once per reached circle, never per installation', () => {
    const { sim, evoke } = state([false, false]); sim.build.params.gaugePerHit.normal = 0.1;
    sim.cast(evoke, 10); sim.cast(evoke, 10); expect(sim.deck.gauge).toBe(0);
    sim.advanceTo(2.25); expect(sim.deck.gauge).toBeCloseTo(0.1);
    sim.advanceTo(3.25); expect(sim.deck.gauge).toBeCloseTo(0.2);
  });

  it('can free a hand slot between two delayed explosions', () => {
    const { sim, evoke } = state(); sim.drawCards(2, 'test'); sim.cast(evoke, 10); sim.cast(evoke, 10);
    sim.advanceTo(2.25); expect(sim.cardDraws.quickDraw).toBe(0);
    sim.useCardNow('test'); sim.advanceTo(3.25); expect(sim.cardDraws.quickDraw).toBe(1);
  });

  it('processes scheduled explosions before another skill hitting at the same time', () => {
    const { sim, evoke, other } = state(); sim.cast(evoke, 10); other.castTime = 1.25; sim.cast(other, 10);
    expect(sim.hits.map(h => [h.id, h.at])).toEqual([['evoke', 2.25], ['other', 2.25]]);
  });

  it('applies first-use buffs only once for the complete chain, not again on explosions', () => {
    const { sim, evoke } = state();
    evoke.onCast = [{ id: 'use', duration: 10, maxStacks: 5, mod: { bucket: 'addDmg', value: 0.1, source: 'test' } }];
    sim.cast(evoke, 10); sim.cast(evoke, 10); sim.advanceTo(4);
    expect(sim.buffs.modsAt(4)).toHaveLength(1); expect(sim.buffs.modsAt(4)[0]!.value).toBe(0.1);
    for (const h of evokeHits(sim)) expect(h.damage).toBeCloseTo(110);
  });
});
