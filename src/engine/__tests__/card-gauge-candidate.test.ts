import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBuildInput } from '../../compare';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { captureSettingBaseline, rebuildSettings } from '../settings';
import { SimState } from '../sim';

const savedText = readFileSync('tests/fixtures/audit/2026-10-30-card-damage-candidate/inputs/empress-base.json', 'utf8');
const saved = JSON.parse(savedText);
const raw = (): RawArmory => structuredClone(saved.setting.baseline.raw);
const cases = [
  ['call_of_destiny', 0.026], ['scratch_dealer', 0.0676], ['spiral_edge', 0.0936],
  ['celestial_rain', 0.1092], ['secret_garden', 0.0884], ['the_devil', 0.6396],
] as const;
const imported = () => buildFromArmory(raw()).build;
function control(id = 'the_devil') {
  const build = imported();
  const skill = build.skills.find(s => s.id === id)!;
  build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onRuinAt4 = []; build.chainDraw = undefined; build.ruinFullset = undefined;
  build.params.gaugeGainBonus = 0; build.params.normalGaugePenalty = 0;
  delete build.params.gaugeFactors; // 기본량만 통제하고 기존 합산 배율 검사를 유지합니다.
  skill.mods = []; skill.onHit = []; skill.quickDraw = undefined; skill.gaugeMultiplier = 1;
  const state = new SimState(build, createRng(1), cardsFor(build.variant));
  return { build, skill, state, hit: () => state.hit(skill, state.breakdown.get(skill.id)!) };
}

describe('selected public gauge candidates', () => {
  it.each(cases)('connects %s to %s per aggregate hit without multiplying damage hits', (id, amount) => {
    const { skill, state, hit } = control(id);
    expect(skill.gaugeBase).toBe(amount);
    hit(); expect(state.deck.gauge).toBeCloseTo(amount, 14);
    state.stacks = 4; state.deck.gauge = 0;
    hit(); expect(state.deck.gauge).toBeCloseTo(amount, 14);
  });
  it('keeps unsupported skills and stored inputs on the exact legacy branch', () => {
    const build = imported();
    expect(build.skills.filter(s => s.gaugeBase !== undefined && !s.gaugeCandidate).map(s => s.id)).toEqual(cases.map(c => c[0]));
    const old = parseBuildInput(savedText, 'legacy')!;
    expect(old.build).toEqual(saved.build);
    expect(old.build.skills.every(s => s.gaugeBase === undefined)).toBe(true);
    const { build: b, skill, state, hit } = control();
    delete skill.gaugeBase;
    b.params.gaugePerHit.hyper_awakening = 0.05;
    hit(); expect(state.deck.gauge).toBe(0.05);
  });
  it.each(cases.filter(([id]) => id !== 'the_devil'))('removes the %s candidate for a different selected combination', (id) => {
    const input = raw(); const skill = imported().skills.find(s => s.id === id)!;
    const source = input.combatSkills.find(s => s.Name === skill.name)!;
    source.Tripods!.find(t => t.IsSelected)!.IsSelected = false;
    expect(buildFromArmory(input).build.skills.find(s => s.id === id)!.gaugeBase).toBeUndefined();
  });
  it('requires the transformed Call profile, not only selected tripod names', () => {
    const input = raw();
    const skill = input.combatSkills.find(s => s.Name === '운명의 부름')!;
    skill.Tripods!.find(t => t.Name === '페이크 플립')!.Tooltip = '알 수 없는 새 효과';
    expect(buildFromArmory(input).build.skills.find(s => s.id === 'call_of_destiny')!.gaugeBase).toBeUndefined();
  });
  it('rebuilds candidates from the selected input and does not carry a manual value', async () => {
    const baseline = await captureSettingBaseline(raw());
    const first = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint });
    first.build.skills.find(s => s.id === 'the_devil')!.gaugeBase = 0.2;
    const rebuilt = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint });
    expect(rebuilt.build.skills.find(s => s.id === 'the_devil')!.gaugeBase).toBe(0.6396);
  });
  it('distinguishes matching public values, manual values and remaining placeholders', () => {
    const build = imported();
    expect(cardSupplyWarnings(build).some(w => w.includes('공개 수급 후보') && w.includes('더 데빌'))).toBe(true);
    expect(cardSupplyWarnings(saved.build).some(w => w.includes('분류·타수별 임시값'))).toBe(true);
    expect(cardSupplyWarnings(build).some(w => w.includes('임시값') && w.includes('포 카드'))).toBe(false);
    build.skills.find(s => s.id === 'the_devil')!.gaugeBase = 0.2;
    expect(cardSupplyWarnings(build).some(w => w.includes('수동 기본량') && w.includes('더 데빌'))).toBe(true);
    expect(cardSupplyWarnings(saved.build)).toEqual(saved.warnings.filter((w: string) => cardSupplyWarnings(saved.build).includes(w)));
  });
});

describe('aggregate gauge input and card accounting', () => {
  it('preserves existing additive bonuses and multiplicative Wealth and normal penalty', () => {
    const { build, skill, state, hit } = control('call_of_destiny');
    skill.kind = 'normal'; skill.gaugeMultiplier = 1.4;
    build.params.gaugeGainBonus = 0.5; build.chainDraw = { gaugeBonus: 0.15 }; build.params.normalGaugePenalty = -0.5;
    hit(); expect(state.deck.gauge).toBeCloseTo(0.026 * 1.65 * 1.4 * 0.5, 14);
  });
  it('honors explicit zero, skips unused legacy base, and gives nothing for zero hits or identity cards', () => {
    const { build, skill, state, hit } = control();
    build.params.gaugePerHit.hyper_awakening = NaN;
    skill.gaugeBase = 0; hit(); expect(state.deck.gauge).toBe(0);
    skill.gaugeBase = 0.6396; skill.hits = 0; hit(); expect(state.deck.gauge).toBe(0);
    skill.hits = 1; skill.kind = 'identity_card'; hit(); expect(state.deck.gauge).toBe(0);
  });
  it.each([null, '0.5', true, {}, [], NaN, Infinity, -Infinity, -0.1])('rejects invalid explicit base %s before any hit effects', value => {
    const { skill, state, hit } = control();
    skill.gaugeBase = value as number;
    expect(hit).toThrow('기본 게이지');
    expect(state.total).toBe(0); expect(state.cardsDrawn).toBe(0); expect(state.deck.gauge).toBe(0);
  });
  it.each(['hitSequence', 'delayedHits', 'splitEvoke', 'manualEvoke'] as const)('rejects aggregate base with %s instead of repeating the whole sum', profile => {
    const { skill, state, hit } = control();
    Object.assign(skill, { [profile]: {} });
    expect(hit).toThrow('합산 적중'); expect(state.cardsDrawn).toBe(0);
  });
  it('rejects an invalid saved value at construction too', () => {
    const build = imported(); build.skills[0]!.gaugeBase = -1;
    expect(() => new SimState(build, createRng(1), cardsFor(build.variant))).toThrow('기본 게이지');
  });
  it.each([0, 1, 2])('reconciles actual gauge draws and residual with %s occupied slots', occupied => {
    const { state, hit } = control();
    for (const id of ['cull', 'judgment'].slice(0, occupied)) state.drawCards(1, id);
    state.deck.gauge = occupied === 2 ? 0 : 0.8;
    hit();
    expect(state.cardDraws.gauge).toBe(occupied === 2 ? 0 : 1);
    expect(state.cardDraws.manual).toBe(occupied);
    expect(state.deck.gauge).toBeCloseTo(occupied === 0 ? 0.4396 : 0, 14);
    expect(Object.values(state.cardDraws).reduce((a, b) => a + b, 0)).toBe(state.cardsDrawn);
    expect(state.cardsUsed + state.deck.hand.length).toBe(state.cardsDrawn);
    expect(state.deck.drawn).toBe(state.cardsDrawn);
  });
  it('separates a gauge draw from Quick Draw and counts no full-hand retry', () => {
    const { skill, state, hit } = control();
    state.deck.gauge = 0.8; skill.quickDraw = { chance: 1, attempts: 1, trigger: 'each' };
    hit(); hit();
    expect(state.cardDraws.gauge).toBe(1); expect(state.cardDraws.quickDraw).toBe(1);
    expect(state.cardsDrawn).toBe(2); expect(state.deck.gauge).toBe(0);
  });
  it('does not pay when the fight ends before the aggregate hit', () => {
    const { state, skill } = control();
    state.cast(skill, 0.01);
    expect(state.deck.gauge).toBe(0); expect(state.cardsDrawn).toBe(0);
  });
});
