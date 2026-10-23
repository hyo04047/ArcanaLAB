import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { CARD_DRAW_LABELS } from '../cards';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState, simulate } from '../sim';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const sources = load('tests/fixtures/audit/2026-10-13-emperor-damage-sources.json');
const hidden = load('tests/fixtures/audit/2026-10-13-sun-nodes-sources.json').official.data.Effects.find((e: { Description: string }) => e.Description.includes('숨겨진 패'));
const falseDeal = load('tests/fixtures/audit/2026-10-13-sun-nodes-details.json').official.data.Effects.find((e: { Description: string }) => e.Description.includes('폴스 딜'));
function input(node = hidden): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'),
    combatSkills: [structuredClone(sources.official.data.find((s: { Name: string }) => s.Name === '더 썬'))],
    arkpassive: { Effects: [{ Name: '깨달음', Description: '깨달음 1티어 황제의 칙령 Lv.3' }, ...(node ? [structuredClone(node)] : [])] },
    arkgrid: null, engravings: null, gems: null };
}
function state(node = hidden, speed = 1, chanceResult = true) {
  const { build } = buildFromArmory(input(node));
  build.passiveMods = build.passiveMods.filter(m => m.source.includes('숨겨진 패') || m.source.includes('폴스 딜'));
  build.passiveMods.push({ bucket: 'atkSpeed', value: speed - 1, source: 'control' });
  build.bluntThorn = undefined; build.params.atkBase = 100; build.params.gaugePerHit.hyper_awakening = 0;
  const checks: number[] = [];
  const sim = new SimState(build, { ...createRng(1), chance(p) { if (p > 0) checks.push(p); return p > 0 && chanceResult; } }, cardsFor('emperor'));
  return { sim, skill: build.skills[0]!, checks };
}
describe('Sun leap-node conversion', () => {
  it('reads the live Hidden Hand level 3 damage and card probability', () => {
    const { build, warnings } = buildFromArmory(input()); const s = build.skills[0]!;
    expect(s.hiddenHandChance).toBe(1);
    expect(computeMultipliers({ atkBase: 100 }, build.passiveMods.filter(m => m.source.includes('숨겨진 패')), { skill: s, component: 'direct', stacks: 0 }).skillDmg).toBeCloseTo(1.39, 12);
    expect(warnings.some(w => w.includes('숨겨진 패') && w.includes('해석 못함'))).toBe(false);
    expect(CARD_DRAW_LABELS.hiddenHand).toBe('숨겨진 패');
  });
  it('scopes both False Deal bonuses to Sun direct damage', () => {
    const { build } = buildFromArmory(input(falseDeal)); const s = build.skills[0]!;
    const mods = build.passiveMods.filter(m => m.source.includes('폴스 딜'));
    const target = computeMultipliers({ atkBase: 100 }, mods, { skill: s, component: 'direct', stacks: 0 });
    expect(target.skillDmg).toBe(1.4); expect(target.critDmg).toBe(2.3); expect(s.hiddenHandChance).toBeUndefined();
    for (const id of ['the_devil', 'card_emperor', 'evoke']) {
      const m = computeMultipliers({ atkBase: 100 }, mods, { skill: { ...s, id }, component: 'direct', stacks: 4 });
      expect(m.skillDmg).toBe(1); expect(m.critDmg).toBe(2);
    }
    for (const component of ['dot', 'stack'] as const) {
      const m = computeMultipliers({ atkBase: 100 }, mods, { skill: s, component, stacks: 4 });
      expect(m.skillDmg).toBe(1); expect(m.critDmg).toBe(2);
    }
  });
  it.each([[13, 30], [26, 60], [39, 100], [17, 23]])('reads supplied damage %s and probability %s without forcing level 3', (damage, chance) => {
    const n = structuredClone(hidden);
    n.ToolTip = JSON.stringify({ value: `더 썬이 적에게 주는 피해가 ${damage}.0% 증가하고, 마지막 타격 적중 시 ${chance}.0% 확률로 아이덴티티 카드를 1장 획득한다.` });
    const { build } = buildFromArmory(input(n));
    expect(build.skills[0]!.hiddenHandChance).toBe(chance / 100);
    expect(build.passiveMods.find(m => m.source.includes('숨겨진 패'))!.value).toBe(damage / 100);
  });
  it.each(['숨겨진 패', '폴스 딜'])('rejects unknown %s text without falling through to global bonuses', name => {
    const n = structuredClone(name === '숨겨진 패' ? hidden : falseDeal);
    n.ToolTip = JSON.stringify({ value: '더 썬이 특정 조건에서 적에게 주는 피해가 40.0% 증가하고, 치명타 피해가 30.0% 증가한다.' });
    const r = buildFromArmory(input(n));
    expect(r.build.passiveMods.some(m => m.source.includes(name))).toBe(false);
    expect(r.build.skills[0]!.hiddenHandChance).toBeUndefined();
    expect(r.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
  });
  it('rejects out-of-range card chance and reports a missing Sun', () => {
    const n = structuredClone(hidden); n.ToolTip = n.ToolTip.replace('100.0%', '101.0%');
    expect(buildFromArmory(input(n)).build.skills[0]!.hiddenHandChance).toBeUndefined();
    const raw = input(); raw.combatSkills = [];
    expect(buildFromArmory(raw).warnings.some(w => w.includes('숨겨진 패: 더 썬 미장착'))).toBe(true);
  });
});
describe('Hidden Hand last projectile', () => {
  it.each([1, 1.2, 1.4])('waits until final impact at speed %s and rolls once', speed => {
    const { sim, skill, checks } = state(hidden, speed); const last = 0.947 / speed + 1.5;
    sim.cast(skill, 10); expect(sim.cardsDrawn).toBe(0); expect(checks).toEqual([]);
    sim.advanceTo(last - 0.00001); expect(sim.cardsDrawn).toBe(0);
    sim.advanceTo(last); expect(sim.cardDraws.hiddenHand).toBe(1); expect(checks).toEqual([1]);
    sim.advanceTo(10); expect(sim.cardsDrawn).toBe(1); expect(sim.cardDraws.quickDraw).toBe(0);
    expect(Object.values(sim.cardDraws).reduce((a, b) => a + b, 0)).toBe(sim.cardsDrawn);
  });
  it.each([1, 2.446])('does not award a card before final impact at combat end %s', end => {
    const { sim } = state(); sim.run(end); expect(sim.cardDraws.hiddenHand).toBe(0);
  });
  it('draws while a subsequent skill is being cast', () => {
    const { sim, skill } = state();
    const other: SkillDef = { id: 'other', name: 'control', kind: 'normal', cooldown: 100, castTime: 2, directCoef: 0, hits: 0 };
    sim.build.skills.push(other); sim.breakdown.set(other.id, { id: other.id, name: other.name, casts: 0, direct: 0, stackEffect: 0 });
    sim.cast(skill, 10); sim.cast(other, 10); expect(sim.cardDraws.hiddenHand).toBe(1);
  });
  it('cannot receive a card with a full hand and does not bank it', () => {
    const { sim, skill } = state(); sim.drawCards(2); sim.cast(skill, 10); sim.advanceTo(3);
    expect(sim.cardDraws.hiddenHand).toBe(0); expect(sim.cardsDrawn).toBe(2);
    sim.deck.use(sim.deck.hand[0]!); sim.advanceTo(5); expect(sim.cardDraws.hiddenHand).toBe(0);
  });
  it('uses a slot opened before final impact', () => {
    const { sim, skill } = state(); sim.drawCards(2); sim.cast(skill, 10); sim.deck.use(sim.deck.hand[0]!);
    sim.advanceTo(3); expect(sim.cardDraws.hiddenHand).toBe(1); expect(sim.cardsDrawn).toBe(3);
  });
  it('does not draw when its single probability check fails', () => {
    const { sim, skill, checks } = state(hidden, 1, false); skill.hiddenHandChance = 0.3; sim.cast(skill, 10); sim.advanceTo(3);
    expect(checks).toEqual([0.3]); expect(sim.cardDraws.hiddenHand).toBe(0);
  });
  it.each([falseDeal, null])('does not draw with another or absent node', node => {
    const { sim, skill, checks } = state(node); sim.cast(skill, 10); sim.advanceTo(3);
    expect(checks).toEqual([]); expect(sim.cardsDrawn).toBe(0);
  });
  it('aggregates the new source and still multiplies all five direct hits', () => {
    const { sim, skill } = state(); sim.cast(skill, 10); sim.advanceTo(3);
    expect(sim.total).toBeCloseTo((8985.5 + 149.714 * 100) * 1.39, 8);
    const result = simulate(sim.build, cardsFor('emperor'), { durationSec: 4, iterations: 3, seed: 1 });
    expect(result.cardsPerMinBySource.hiddenHand).toBe(15);
    expect(Object.values(result.cardsPerMinBySource).reduce((a, b) => a + b, 0)).toBe(result.cardsPerMin);
  });
});
