import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const evidence = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-12-quick-draw-sources.json', 'utf8'));
const profiles = JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8'));
function input(name: string, selected: string[] = ['퀵 드로']): RawArmory {
  const source = evidence.officialApi.skills.find((s: { name: string }) => s.name === name);
  return { profiles, combatSkills: [{ Name: name, Level: 10, Type: '일반', SkillType: 0, Tooltip: source.tooltip,
    Tripods: source.tripods.map((t: { Name: string }) => ({ ...t, IsSelected: selected.includes(t.Name) })) }],
    arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
const converted = (name: string, selected?: string[]) => buildFromArmory(input(name, selected));

describe('Quick Draw armory tooltip conversion', () => {
  it.each([
    ['운명의 부름', 0.2, 'each', 2], ['이보크', 0.2, 'each', 1],
    ['언리미티드 셔플', 0.3, 'last', 1], ['신비한 쇄도', 0.3, 'first', 1], ['다크 리저렉션', 0.4, 'last', 1],
  ] as const)('reads %s chance and trigger from the saved live official API', (name, chance, trigger, attempts) => {
    const result = converted(name);
    expect(result.build.skills[0]!.quickDraw).toEqual({ chance, trigger, attempts });
    expect(result.warnings.some(w => w.includes('해석 못함') && w.includes('퀵 드로'))).toBe(false);
  });

  it.each([0, 12, 14, 18, 20, 30, 40, 100])('uses the supplied %s percent, never a skill-level or global default', percent => {
    const raw = input('이보크');
    raw.combatSkills[0]!.Tripods!.find(t => t.Name === '퀵 드로')!.Tooltip = `<FONT>적중 시 ${percent}.0% 확률로 아이덴티티 카드를 1장을 획득한다.</FONT>`;
    expect(buildFromArmory(raw).build.skills[0]!.quickDraw!.chance).toBe(percent / 100);
  });

  it.each([
    ['운명의 부름', '연속 공격', 3], ['운명의 부름', '페이크 플립', 1],
    ['이보크', '중첩 마법진', 3], ['이보크', '분할 마법진', 1],
    ['신비한 쇄도', '연속 공격', 1], ['언리미티드 셔플', '얼티밋 셔플', 1],
    ['언리미티드 셔플', '파멸의 폭풍', 1], ['다크 리저렉션', '죽음의 공포', 1],
  ] as const)('keeps %s / %s to %s eligible checks', (name, tripod, attempts) => {
    const result = converted(name, ['퀵 드로', tripod]);
    expect(result.build.skills[0]!.quickDraw!.attempts).toBe(attempts);
    if (tripod === '분할 마법진') expect(result.build.skills[0]!.splitEvoke).toBeDefined();
  });

  it('does not add poison ticks to Overlapping Evoke checks', () => {
    const skill = converted('이보크', ['퀵 드로', '마나 중독', '중첩 마법진']).build.skills[0]!;
    expect(skill.quickDraw!.attempts).toBe(3);
  });

  it('does not activate an unselected Quick Draw tooltip', () => {
    const result = converted('운명의 부름', ['어두운 운명', '페이크 플립']);
    expect(result.build.skills[0]!.quickDraw).toBeUndefined();
    expect(result.build.skills[0]!.tags ?? []).not.toContain('quickdraw');
  });

  it.each([undefined, '', '적중 시 일정 확률로 카드를 획득한다.',
    '적중 시 101.0% 확률로 아이덴티티 카드를 1장을 획득한다.',
    '적중 시 20.0% 확률로 아이덴티티 카드를 1장을 획득한다. 재사용 대기시간 5초.'])('does not guess malformed or conditional tooltip %s', text => {
    const raw = input('이보크'); raw.combatSkills[0]!.Tripods!.find(t => t.Name === '퀵 드로')!.Tooltip = text;
    const result = buildFromArmory(raw);
    expect(result.build.skills[0]!.quickDraw).toBeUndefined();
    expect(result.warnings.some(w => w.includes('퀵 드로 해석 못함'))).toBe(true);
  });
});

// 시각은 합성 입력입니다. 실제 스킬 모션 측정값이 아닙니다.
function state(trigger: 'each' | 'first' | 'last', sequence: boolean, outcomes: boolean[] = [true, true, true]) {
  const skill: SkillDef = { id: 'test', name: 'test', kind: 'normal', cooldown: 0, castTime: 3,
    directCoef: 0, hits: 99, quickDraw: { chance: 0.2, trigger, attempts: trigger === 'each' ? 3 : 1 },
    ...(sequence ? { hitSequence: { duration: 3, hits: [1, 2, 3].map(at => ({ at, directCoef: 0, directFlat: 0 })) } } : {}) };
  const build = empressInkomsu440();
  build.skills = [skill]; build.passiveMods = []; build.onDestiny = []; build.onRuinAt4 = [];
  build.params.gaugePerHit.normal = 0;
  const checks: number[] = [];
  const rng = { ...createRng(1), chance(p: number) {
    if (p !== 0.2) return false;
    checks.push(p); return outcomes[checks.length - 1] ?? false;
  } };
  return { sim: new SimState(build, rng, cardsFor('empress')), checks, skill };
}

describe('Quick Draw eligible hit processing', () => {
  it.each(['first', 'last', 'each'] as const)('uses %s eligibility, not all 99 damage/gauge hits', trigger => {
    const { sim, checks, skill } = state(trigger, false);
    sim.cast(skill, 10);
    expect(checks).toHaveLength(trigger === 'each' ? 3 : 1);
    expect(sim.cardDraws.quickDraw).toBe(trigger === 'each' ? 2 : 1);
    expect(sim.cardDraws.gauge).toBe(0);
  });

  it.each([
    ['first', 0.9, 0], ['first', 1, 1], ['first', 3, 1],
    ['last', 2.999, 0], ['last', 3, 1],
    ['each', 1.5, 1], ['each', 2, 2], ['each', 3, 3],
  ] as const)('checks %s only on eligible reached hits through %ss', (trigger, end, count) => {
    const { sim, checks, skill } = state(trigger, true);
    sim.cast(skill, end);
    expect(checks).toHaveLength(count);
    expect(sim.cardDraws.quickDraw).toBe(Math.min(count, 2));
  });

  it('does not grant a card before a lumped hit occurs', () => {
    const { sim, checks, skill } = state('each', false); sim.cast(skill, 2.9);
    expect(checks).toHaveLength(0); expect(sim.cardsDrawn).toBe(0);
  });

  it('enumerates three independent trials and applies the two-slot cap', () => {
    let mean = 0;
    for (let mask = 0; mask < 8; mask++) {
      const outcomes = [0, 1, 2].map(i => !!(mask & (1 << i)));
      const successes = outcomes.filter(Boolean).length;
      const { sim, checks, skill } = state('each', false, outcomes);
      sim.cast(skill, 10);
      expect(checks).toHaveLength(3);
      expect(sim.cardDraws.quickDraw).toBe(Math.min(successes, 2));
      mean += sim.cardDraws.quickDraw * 0.2 ** successes * 0.8 ** (3 - successes);
    }
    expect(mean).toBeCloseTo(0.592, 12); // E[min(Binomial(3, .2), 2)], no card use between hits
  });

  it('counts no successful acquisition with an initially full hand', () => {
    const { sim, checks, skill } = state('each', false);
    sim.drawCards(1, 'cull'); sim.drawCards(1, 'judgment'); sim.cast(skill, 10);
    expect(checks).toHaveLength(3); expect(sim.cardDraws.quickDraw).toBe(0);
  });

  it('does not revive the removed 25% fallback from a legacy tag', () => {
    const { sim, checks, skill } = state('each', false);
    delete skill.quickDraw; skill.tags = ['quickdraw']; sim.cast(skill, 10);
    expect(checks).toHaveLength(0); expect(sim.cardsDrawn).toBe(0);
    expect(cardSupplyWarnings(sim.build).some(w => w.includes('누락'))).toBe(true);
  });
});
