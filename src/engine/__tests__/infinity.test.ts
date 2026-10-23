import { coreTestPassives } from './core-fixture';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor, empressInkomsu440 } from '../presets';
import { SimState } from '../sim';
import { createRng } from '../rng';
import { computeMultipliers } from '../damage';
import { cardSupplyWarnings } from '../cards';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function input(point = 17): RawArmory {
  const slot = structuredClone(load('tests/fixtures/audit/2026-10-13-infinity-sources.json').slot);
  slot.Point = point; slot.Gems = [];
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [],
    arkpassive: coreTestPassives(), arkgrid: { Slots: [slot] }, engravings: null, gems: null };
}
function state(raw = input()) {
  const { build } = buildFromArmory(raw);
  build.passiveMods = []; build.bluntThorn = undefined; build.cardDurationBonus = {};
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  build.skills = (['ruin', 'normal', 'stack', 'awakening', 'the_devil', 'the_sun'] as const).map(id => ({
    id, name: id, kind: id === 'the_devil' || id === 'the_sun' ? 'hyper_awakening' : id,
    tags: id === 'the_devil' ? ['ruin'] : id === 'the_sun' ? ['normal'] : [],
    cooldown: 20, castTime: 0, directCoef: 1, hits: 1,
  }));
  return new SimState(build, createRng(1), cardsFor('empress'));
}
function play(sim: SimState, card: string) { sim.drawCards(1, card); sim.useCardNow(card); }
function multiplier(sim: SimState, id = 'ruin', component: 'direct' | 'stack' = 'direct') {
  return computeMultipliers({ atkBase: 1 }, sim.activeMods(), { skill: sim.skill(id), stacks: 4, component }).skillDmg;
}

describe('Infinity Deck card conditions', () => {
  it.each([16, 17])('honors the equipped point threshold %s without passive 17P damage', points => {
    const { build } = buildFromArmory(input(points));
    expect(!!build.infinityDeck).toBe(points === 17);
    expect(build.passiveMods.some(m => m.source === '인피니티 덱 17P')).toBe(false);
  });
  it('uses each exact API sentence, leaving changed conditions unsupported', () => {
    const raw = input(); raw.arkgrid!.Slots[0]!.Tooltip = raw.arkgrid!.Slots[0]!.Tooltip!.replace('심판 카드 사용 시', '심판 카드 획득 시');
    const { build, warnings } = buildFromArmory(raw);
    expect(build.infinityDeck?.judgment).toBeUndefined(); expect(build.infinityDeck?.balance?.mod.value).toBe(0.02);
    expect(warnings.some(w => w.includes('인피니티 덱 17P') && w.includes('미모델'))).toBe(true);
  });
  it('preserves different tooltip values rather than hard-coding the relic damage', () => {
    const raw = input(); raw.arkgrid!.Slots[0]!.Tooltip = raw.arkgrid!.Slots[0]!.Tooltip!.replace('2.0%', '3.0%');
    const sim = state(raw); play(sim, 'balance'); expect(multiplier(sim)).toBeCloseTo(1.03);
  });
  it('starts damage only on Balance use, including Devil and both ruin components', () => {
    const sim = state(); sim.drawCards(1, 'balance'); expect(multiplier(sim)).toBe(1);
    sim.useCardNow('balance');
    for (const id of ['ruin', 'the_devil']) for (const component of ['direct', 'stack'] as const) expect(multiplier(sim, id, component)).toBeCloseTo(1.02);
    for (const id of ['normal', 'stack', 'awakening', 'the_sun']) expect(multiplier(sim, id)).toBe(1);
  });
  it('refreshes Balance damage for 30 seconds without stacking or changing cooldowns', () => {
    const sim = state(); sim.readyAt.set('ruin', 50); play(sim, 'balance');
    sim.advanceTo(20); play(sim, 'balance'); sim.advanceTo(30); expect(multiplier(sim)).toBeCloseTo(1.02);
    expect(sim.readyAt.get('ruin')).toBe(50); sim.advanceTo(50); expect(multiplier(sim)).toBe(1);
  });
  it('does not shorten cooldowns before six seconds, then scales remaining ruin cooldowns only', () => {
    const sim = state(); for (const s of sim.build.skills) sim.readyAt.set(s.id, 26);
    play(sim, 'judgment'); expect(multiplier(sim)).toBe(1);
    sim.advanceTo(5.999); expect(sim.readyAt.get('ruin')).toBe(26);
    sim.advanceTo(6);
    for (const id of ['ruin', 'the_devil']) expect(sim.readyAt.get(id)).toBeCloseTo(23);
    for (const id of ['normal', 'stack', 'awakening', 'the_sun']) expect(sim.readyAt.get(id)).toBe(26);
    sim.advanceTo(7); expect(sim.readyAt.get('ruin')).toBeCloseTo(23);
  });
  it('keeps the fixed six-second delay independent from the Judgment card duration', () => {
    const sim = state(); sim.readyAt.set('ruin', 26); play(sim, 'judgment');
    sim.advanceTo(4); expect(sim.judgmentActive()).toBe(false); sim.advanceTo(6); expect(sim.readyAt.get('ruin')).toBe(23);
    const extended = state(); extended.build.cardDurationBonus = { judgment: 10 }; extended.readyAt.set('ruin', 26);
    play(extended, 'judgment'); extended.advanceTo(6); expect(extended.judgmentActive()).toBe(true); expect(extended.readyAt.get('ruin')).toBe(23);
  });
  it('reads cooldowns at execution rather than at card use and does not alter future cooldowns', () => {
    const sim = state(); play(sim, 'judgment'); sim.advanceTo(5); sim.cast(sim.skill('ruin'), 100);
    sim.advanceTo(6); expect(sim.readyAt.get('ruin')).toBeCloseTo(22.15);
    sim.advanceTo(22.15); sim.cast(sim.skill('ruin'), 100); expect(sim.readyAt.get('ruin')).toBeCloseTo(42.15);
  });
  it('leaves already-ready skills alone and does not schedule an absent card or a rune buff', () => {
    const sim = state(); sim.readyAt.set('ruin', 26); sim.useCardNow('judgment');
    sim.applyBuff({ id: 'judgment_rune', duration: 6, mod: { bucket: 'cooldown', value: 0.15, source: '심판 룬' } });
    sim.advanceTo(6); expect(sim.readyAt.get('ruin')).toBe(26);
    sim.readyAt.set('ruin', 4); play(sim, 'judgment'); sim.advanceTo(12); expect(sim.readyAt.get('ruin')).toBe(4);
  });
  it('processes the delayed reduction while another skill is casting', () => {
    const sim = state(); sim.readyAt.set('ruin', 26); play(sim, 'judgment');
    sim.skill('normal').castTime = 8; sim.cast(sim.skill('normal'), 100);
    expect(sim.now).toBe(8); expect(sim.readyAt.get('ruin')).toBe(23);
  });
  it('retains independent reservations when a copied Judgment is used again (candidate)', () => {
    const sim = state(); sim.readyAt.set('ruin', 26); play(sim, 'judgment'); sim.advanceTo(2);
    play(sim, 'clown'); expect(sim.deck.hand).toContain('judgment'); sim.useCardNow('judgment');
    sim.advanceTo(6); expect(sim.readyAt.get('ruin')).toBe(23);
    sim.advanceTo(8); expect(sim.readyAt.get('ruin')).toBeCloseTo(20.75);
  });
  it('executes the event during idle and wakes for the reduced ready time', () => {
    const sim = state(); sim.build.skills = [sim.skill('ruin')]; sim.build.rotation = { ruinPriority: ['ruin'], stackPriority: [] };
    sim.readyAt.set('ruin', 6.1); sim.stacks = 4; play(sim, 'judgment');
    const result = sim.run(6.15); expect(result.breakdown.find(b => b.id === 'ruin')?.casts).toBe(1);
  });
  it('connects the reference preset and exposes the unverified overlapping reservation rule', () => {
    const build = empressInkomsu440(); expect(build.infinityDeck?.judgment).toEqual({ delay: 6, fraction: 0.15 });
    expect(build.infinityDeck?.balance?.duration).toBe(30);
    expect(cardSupplyWarnings(build).some(w => w.includes('인피니티') && w.includes('미검증'))).toBe(true);
  });
});
