import { coreTestPassives } from './core-fixture';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-stack-hold-sources.json', 'utf8'));
function input(point = 17): RawArmory {
  const slots: NonNullable<RawArmory['arkgrid']>['Slots'] = structuredClone(source.slots);
  for (const slot of slots) { slot.Point = point; slot.Gems = []; }
  return { profiles: source.profiles, combatSkills: [], arkpassive: coreTestPassives(true), engravings: null, gems: null, arkgrid: { Slots: slots } };
}
function state(point = 17) {
  const { build } = buildFromArmory(input(point));
  build.passiveMods = build.passiveMods.filter(m => m.source === '스택 홀드 17P');
  build.bluntThorn = undefined; build.stats.swift = 0;
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  build.skills = (['normal', 'stack', 'ruin', 'awakening', 'the_sun', 'the_devil', 'identity_card'] as const).map(id => ({
    id, name: id, kind: id === 'the_sun' || id === 'the_devil' ? 'hyper_awakening' : id,
    tags: id === 'the_sun' ? ['normal'] : id === 'the_devil' ? ['ruin'] : [],
    cooldown: 20, castTime: 0, directCoef: 1, hits: 1,
  }));
  return new SimState(build, createRng(1), cardsFor('emperor'));
}
const play = (s: SimState, id: string) => { s.drawCards(1, id); s.useCardNow(id); };
const multiplier = (s: SimState, id = 'normal', component: 'direct' | 'dot' = 'direct') =>
  computeMultipliers({ atkBase: 1 }, s.activeMods(), { skill: s.skill(id), stacks: s.stacks, component }).skillDmg;

describe('Stack Hold and Normal Enhance', () => {
  it.each([13, 14, 16, 17])('honors %sP boundaries without passive destiny damage', point => {
    const { build } = buildFromArmory(input(point));
    expect(!!build.stackHold).toBe(point >= 14);
    expect(build.normalEnhanceCooldown).toBe(point >= 14 ? 0.1 : undefined);
    expect(build.onDestiny?.length).toBe(point >= 17 ? 1 : 0);
    expect(build.passiveMods.filter(m => m.source === '노말 인핸스 17P')).toEqual([]);
    expect(build.passiveMods.some(m => m.source === '스택 홀드 17P')).toBe(point >= 17);
  });
  it.each(['스택 홀드', '노말 인핸스'])('rejects unknown core names: %s', name => {
    const raw = input(); raw.arkgrid!.Slots.find(s => s.Name.endsWith(name))!.Name = '알 수 없는 코어';
    const { build, warnings } = buildFromArmory(raw);
    if (name === '스택 홀드') expect(build.stackHold).toBeUndefined();
    else { expect(build.normalEnhanceCooldown).toBeUndefined(); expect(build.onDestiny).toEqual([]); }
    expect(warnings.some(w => w.includes('미모델'))).toBe(true);
  });
  it('rejects extra conditions in the compound buff instead of granting passive damage', () => {
    const raw = input(), slot = raw.arkgrid!.Slots.find(s => s.Name.endsWith('노말 인핸스'))!;
    slot.Tooltip = slot.Tooltip!.replace('효과를 획득한다.', '효과를 획득한다. 생명력이 낮을 때');
    const { build, warnings } = buildFromArmory(raw);
    expect(build.onDestiny).toEqual([]); expect(build.passiveMods.some(m => m.source === '노말 인핸스 17P')).toBe(false);
    expect(warnings.some(w => w.includes('노말 인핸스 17P') && w.includes('미모델'))).toBe(true);
  });
  it('does not reinterpret card acquisition or time-limited conditions as uses', () => {
    const raw = input(), slot = raw.arkgrid!.Slots.find(s => s.Name.endsWith('스택 홀드'))!;
    slot.Tooltip = slot.Tooltip!.replace('회 사용 시', '회 획득 시');
    expect(buildFromArmory(raw).build.stackHold).toBeUndefined();
    slot.Tooltip = slot.Tooltip!.replace('회 획득 시', '회 사용 시 1초 이내에');
    expect(buildFromArmory(raw).build.stackHold).toBeUndefined();
  });
  it('preserves alternate tooltip values in a synthetic relic fixture', () => {
    const raw = input();
    for (const slot of raw.arkgrid!.Slots) slot.Tooltip = slot.Tooltip!.replace('5.0%', '3.8%').replace('4.0%', '3.0%');
    const { build } = buildFromArmory(raw);
    expect(build.onDestiny?.some(e => typeof e !== 'string' && e.mod.value === 0.038)).toBe(true);
    expect(build.passiveMods.find(m => m.source === '스택 홀드 17P')?.value).toBe(0.03);
  });
  it('only counts successful card uses and repeats every two uses', () => {
    const s = state(), proc = vi.spyOn(s, 'triggerDestiny'); s.useCardNow('star'); s.drawCards(1, 'star');
    expect(proc).not.toHaveBeenCalled(); s.useCardNow('star'); expect(proc).not.toHaveBeenCalled();
    s.advanceTo(100); play(s, 'star'); expect(proc).toHaveBeenCalledTimes(1);
    play(s, 'star'); expect(proc).toHaveBeenCalledTimes(1); play(s, 'star'); expect(proc).toHaveBeenCalledTimes(2);
  });
  it('does not count Clown copying, then counts using the copied card', () => {
    const s = state(), proc = vi.spyOn(s, 'triggerDestiny'); play(s, 'star'); play(s, 'clown');
    expect(proc).toHaveBeenCalledTimes(1); expect(s.deck.hand).toContain('star');
    s.useCardNow('star'); expect(proc).toHaveBeenCalledTimes(1); play(s, 'star'); expect(proc).toHaveBeenCalledTimes(2);
  });
  it('still processes destiny effects when Royal fills the hand', () => {
    const s = state(); play(s, 'star'); s.readyAt.set('normal', 20); play(s, 'royal');
    expect(s.deck.hand).toHaveLength(2); expect(s.cardDraws.destiny).toBe(0);
    expect(s.readyAt.get('normal')).toBe(18); expect(multiplier(s)).toBeCloseTo(1.05);
    s.deck.hand.length = 0; play(s, 'star'); expect(s.readyAt.get('normal')).toBe(18);
  });
  it('does not roll a chance or grant a card for the two-use trigger', () => {
    const s = state(), chance = vi.spyOn(s.rng, 'chance'); play(s, 'star'); play(s, 'star');
    expect(chance).not.toHaveBeenCalled(); expect(s.cardDraws.destiny).toBe(0); expect(multiplier(s)).toBeCloseTo(1.05);
  });
  it('reduces only remaining normal/stack cooldowns, including the tagged Sun candidate', () => {
    const s = state(); for (const skill of s.build.skills) s.readyAt.set(skill.id, 30);
    s.advanceTo(10); s.triggerDestiny();
    for (const id of ['normal', 'stack', 'the_sun']) expect(s.readyAt.get(id)).toBe(28);
    for (const id of ['ruin', 'the_devil', 'awakening', 'identity_card']) expect(s.readyAt.get(id)).toBe(30);
    s.triggerDestiny(); expect(s.readyAt.get('normal')).toBeCloseTo(26.2);
  });
  it('does not change already-ready or future cooldowns', () => {
    const s = state(); s.readyAt.set('normal', 5); s.advanceTo(10); s.triggerDestiny();
    expect(s.readyAt.get('normal')).toBe(5); s.cast(s.skill('normal'), 100); expect(s.readyAt.get('normal')).toBe(30);
  });
  it('does not retroactively reduce a cooldown that starts at the next Evoke input', () => {
    const build = state().build; const evoke: SkillDef = { id: 'evoke', name: '이보크', kind: 'normal', directCoef: 0, hits: 1, castTime: 1, cooldown: 10,
      splitEvoke: { duration: 1, placementAt: 0.25, delay: 2, window: 3 } };
    build.skills.push(evoke); const s = new SimState(build, createRng(1), cardsFor('emperor'));
    s.cast(evoke, 100); s.triggerDestiny(); s.advanceTo(2); s.cast(evoke, 100);
    expect(s.readyAt.get('evoke')).toBe(12);
  });
  it('starts the normal-only buff on destiny, refreshes and expires exactly at 16 seconds', () => {
    const s = state(); expect(multiplier(s)).toBe(1); s.triggerDestiny();
    for (const id of ['normal', 'the_sun']) expect(multiplier(s, id)).toBeCloseTo(1.05);
    for (const id of ['stack', 'ruin', 'the_devil', 'awakening', 'identity_card']) expect(multiplier(s, id)).toBe(1);
    s.advanceTo(10); s.triggerDestiny(); s.advanceTo(16); expect(multiplier(s)).toBeCloseTo(1.05);
    s.advanceTo(26); expect(multiplier(s)).toBe(1);
  });
  it('gates Stack Hold damage on actual stacks and does not turn Judgment into normal-skill stacks', () => {
    const s = state(); play(s, 'judgment'); expect(multiplier(s)).toBe(1);
    s.stacks = 1; expect(multiplier(s)).toBeCloseTo(1.04); expect(multiplier(s, 'the_sun')).toBeCloseTo(1.04);
    for (const id of ['stack', 'ruin', 'the_devil', 'awakening', 'identity_card']) expect(multiplier(s, id)).toBe(1);
    s.stacks = 4; expect(multiplier(s)).toBeCloseTo(1.04); s.stacks = 0; expect(multiplier(s)).toBe(1);
  });
  it('keeps unverified dot scope excluded and records the timing assumptions', () => {
    const s = state(); s.stacks = 1; s.triggerDestiny(); expect(multiplier(s)).toBeCloseTo(1.04 * 1.05);
    expect(multiplier(s, 'normal', 'dot')).toBe(1);
    expect(cardSupplyWarnings(s.build).some(w => w.includes('스택 홀드') && w.includes('미검증'))).toBe(true);
  });
});
