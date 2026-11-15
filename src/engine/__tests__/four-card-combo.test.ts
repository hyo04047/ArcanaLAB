import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { captureSettingBaseline, rebuildSettings } from '../settings';
import { applyTripods, tripodChoices } from '../tripodSettings';
import { SimState } from '../sim';
import type { SkillDef } from '../types';
import { readSettingInput, regenerateSettingInput, saveSettingInput } from '../../settingFiles';
import modelId from 'virtual:arcanalab-model';

const oldText = readFileSync('tests/fixtures/audit/2026-10-30-four-card-gauge-candidate/inputs/empress-combo-unsupported.json', 'utf8');
const old = JSON.parse(oldText);
const choose = (name: string) => {
  const row = tripodChoices.find(c => c.skillId === 'four_of_a_kind' && c.source.kind === 'official-observed' && c.tripod.Name === name)!;
  return { skillId: row.skillId, tier: row.tripod.Tier, choiceId: row.id };
};
const four = (skills: SkillDef[]) => skills.find(s => s.id === 'four_of_a_kind')!;
function raw(name = '눈속임'): RawArmory {
  const input: RawArmory = structuredClone(old.setting.baseline.raw);
  applyTripods(input, [choose(name), choose('연속 공격')]);
  input.combatSkills.find(s => s.Name === '포 카드')!.Rune = null;
  return input;
}
function control(name = '눈속임', rolls = [false, false], reset = false) {
  const { build } = buildFromArmory(raw(name));
  const skill = four(build.skills);
  build.skills = [skill]; build.passiveMods = []; build.combatLevel = undefined;
  build.bluntThorn = undefined; build.onRuinAt4 = []; build.ruinFullset = undefined;
  build.chainDraw = undefined; build.onDestiny = []; build.params.gaugeGainBonus = 0;
  delete build.params.gaugeFactors; build.params.normalGaugePenalty = 0;
  build.params.atkBase = 1; build.params.raidCaptainRatio = 0;
  build.params.stackEffectCoefPerStack = 10; build.params.stackEffectScale = [0, 1, 2, 3, 4];
  skill.mods = []; skill.onCast = []; skill.onHit = []; skill.gaugeMultiplier = 1;
  skill.directCoef = 20; skill.directFlat = 0; skill.cooldown = 16;
  const checks: { purpose: string; p: number }[] = [];
  const rng = createRng(1, 'partitioned-v1'), stream = rng.stream!;
  rng.stream = key => ({ ...stream(key), chance(p) {
    const purpose = JSON.parse(key)[0]; checks.push({ purpose, p });
    return purpose === 'cooldownReset' ? reset : purpose === 'keepStacks' ? rolls.shift() ?? false : false;
  } });
  const state = new SimState(build, rng, cardsFor(build.variant));
  const breakdown = state.breakdown.get(skill.id)!;
  return { build, skill, state, breakdown, checks, cast: (end = 20) => state.cast(skill, end) };
}
const judgment = (state: SimState, duration: number) => state.applyBuff({ id: 'judgment', duration,
  mod: { bucket: 'critRate', value: 0, source: '통제' } });

describe('Four of a Kind combo input and provenance', () => {
  it.each(['카드 강화', '눈속임'])('imports, saves and regenerates %s without Full House bonuses', async name => {
    const input = raw(name), baseline = await captureSettingBaseline(input);
    const text = await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId);
    const saved = await readSettingInput(text, 'combo', modelId), skill = four(saved.build.skills);
    expect(skill.hits).toBe(2); expect(skill.castTime).toBe(2.666);
    expect(skill.fourCardCombo).toMatchObject({ duration: 1.333, hitAt: .5,
      gaugeBase: name === '눈속임' ? .14247721471070698 : .1716 });
    expect(skill.gaugeBase).toBeUndefined(); expect(skill.gaugeCandidate).toBeUndefined();
    expect(skill.mods!.some(m => m.source.includes('풀 하우스'))).toBe(false);
    expect(four((await regenerateSettingInput(text, 'combo', modelId)).input.build.skills)).toEqual(skill);
    applyTripods(input, [choose('풀 하우스')]);
    const single = four(buildFromArmory(input).build.skills);
    expect(skill.directCoef).toBe(single.directCoef * 2); expect(skill.directFlat).toBe(single.directFlat! * 2);
    expect(single.mods!.some(m => m.source.includes('풀 하우스'))).toBe(true);
    expect(saved.warnings!.some(w => w.includes('초기화 55% 1회') && w.includes('검증 전 가정'))).toBe(true);
    expect(saved.warnings!.some(w => w.includes(name === '눈속임' ? '외삽 가정' : '17.16%'))).toBe(true);
  });
  it('keeps old one-hit settings until explicit regeneration', async () => {
    const saved = await readSettingInput(oldText, 'old', modelId);
    expect(saved.status).toBe('model-changed'); expect(saved.build).toEqual(old.build); expect(saved.warnings).toEqual(old.warnings);
    expect(four(saved.build.skills).fourCardCombo).toBeUndefined();
    expect(four((await regenerateSettingInput(oldText, 'old', modelId)).input.build.skills).fourCardCombo).toBeDefined();
  });
  it('rebuilds both ways and removes stale profiles and Full House modifiers', async () => {
    const baseline = await captureSettingBaseline(raw('카드 강화'));
    for (const name of ['풀 하우스', '연속 공격', '스트레이트', '정신 강화']) {
      const { build } = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, tripods: [choose(name)] });
      const skill = four(build.skills);
      expect(!!skill.fourCardCombo).toBe(name === '연속 공격');
      expect(skill.hits).toBe(name === '연속 공격' ? 2 : 1);
      expect(skill.gaugeCandidate).toBe(name === '풀 하우스' ? 'four-card-enhanced' : undefined);
      expect(skill.mods!.some(m => m.source.includes('풀 하우스'))).toBe(name === '풀 하우스');
    }
  });
  it.each(['신속한 준비', '눈속임', '연속 공격'])('refuses an uninterpreted %s tooltip', name => {
    const input = raw(); input.combatSkills.find(s => s.Name === '포 카드')!.Tripods!.find(t => t.Name === name)!.Tooltip = '새로운 미확인 효과';
    const result = buildFromArmory(input);
    expect(four(result.build.skills).fourCardCombo).toBeUndefined();
    expect(result.warnings.some(w => w.includes('추가 입력·적중·수급 미반영'))).toBe(true);
  });
  it('does not mislabel combo-only gauge as aggregate or fallback', () => {
    const { build } = control(); const warnings = cardSupplyWarnings(build);
    expect(warnings.some(w => w.includes('각 실제 적중'))).toBe(true);
    expect(warnings.some(w => w.includes('시전 종료에 합산') || w.startsWith('카드 게이지는 스킬 분류'))).toBe(false);
  });
});

describe('Four of a Kind combo events', () => {
  it.each([false, true])('always attempts two inputs with one cooldown check, reset=%s', reset => {
    const c = control('카드 강화', [], reset); c.cast();
    expect(c.breakdown.direct).toBe(20); expect(c.breakdown.casts).toBe(1);
    expect(c.state.now).toBeCloseTo(2.666); expect(c.state.readyAt.get(c.skill.id)).toBe(reset ? 0 : 16);
    expect(c.checks.filter(r => r.purpose === 'cooldownReset')).toEqual([{ purpose: 'cooldownReset', p: .55 }]);
    expect(c.state.deck.gauge).toBeCloseTo(.3432, 14);
    if (reset) { c.cast(); expect(c.breakdown.casts).toBe(2); expect(c.breakdown.direct).toBe(40); }
    else expect(c.cast).toThrow('cooldown');
  });
  it.each([[false, false, 40, 0, 1], [true, false, 80, 0, 2], [true, true, 80, 4, 2]])
    ('uses first preservation before the second hit: %s/%s', (a, b, damage, stacks, count) => {
      const c = control('눈속임', [a as boolean, b as boolean]); c.state.stacks = 4; c.cast();
      expect(c.breakdown.stackEffect).toBe(damage); expect(c.state.stacks).toBe(stacks);
      expect(c.checks.filter(r => r.purpose === 'keepStacks')).toHaveLength(count as number);
      expect(c.state.deck.gauge).toBeCloseTo(.14247721471070698 * 2, 14);
      expect([c.state.ruinCasts, c.state.ruinAt4]).toEqual([1, 1]);
    });
  it.each([[.5, 0], [.501, 40], [1.833, 40], [1.834, 80]])('reads Judgment expiration %s at each hit', (expiry, damage) => {
    const c = control('눈속임', [true, true]); judgment(c.state, expiry!); c.cast();
    expect(c.breakdown.stackEffect).toBe(damage); expect(c.state.stacks).toBe(0);
    expect(c.checks.filter(r => r.purpose === 'keepStacks')).toHaveLength(0);
  });
  it.each([[0, 0], [.499, 0], [.5, 1], [.501, 1], [1.332, 1], [1.333, 1], [1.334, 1],
    [1.832, 1], [1.833, 2], [1.834, 2], [2.665, 2], [2.666, 2], [2.667, 2]])
    ('truncates actual hits at fight end %s', (end, hits) => {
      const c = control('카드 강화'); c.cast(end);
      expect(c.breakdown.direct).toBe(10 * hits!); expect(c.state.deck.gauge).toBeCloseTo(.1716 * hits!, 14);
      expect(c.state.now).toBeCloseTo(Math.min(end!, 2.666));
    });
  it('counts cast effects once, hit effects twice and fullset once per combo', () => {
    const c = control('카드 강화', [], true);
    c.skill.onCast = [{ id: 'cast', duration: 30, maxStacks: 10, mod: { bucket: 'critRate', value: .01, source: '통제' } }];
    c.skill.onHit = [{ id: 'hit', duration: 30, maxStacks: 10, mod: { bucket: 'critDmg', value: .01, source: '통제' } }];
    c.skill.hitRune = { kind: 'conviction', chance: .4, duration: 3 };
    c.skill.runeCdReduce = { chance: .2, fraction: .1 };
    c.build.ruinFullset = true; c.build.onDestiny = ['drawCard'];
    for (let i = 0; i < 3; i++) c.cast();
    expect(c.state.cardDraws.destiny).toBe(0); c.cast(); expect(c.state.cardDraws.destiny).toBe(1);
    expect(c.state.buffs.modsAt(c.state.now).find(m => m.bucket === 'critRate')?.value).toBeCloseTo(.04);
    expect(c.state.buffs.modsAt(c.state.now).find(m => m.bucket === 'critDmg')?.value).toBeCloseTo(.08);
    expect(c.checks.filter(r => r.purpose === 'quickRecharge')).toHaveLength(4);
    expect(c.checks.filter(r => r.purpose === 'hitRune')).toHaveLength(8);
    expect(c.checks.filter(r => r.purpose === 'directCrit')).toHaveLength(8);
  });
  it('resamples speed at the second input and keeps first motion speed fixed', () => {
    const c = control('카드 강화');
    c.state.applyBuff({ id: 'speed', duration: .8, mod: { bucket: 'atkSpeed', value: .4, source: '통제' } });
    c.cast(1.333 / 1.4 + .5); expect(c.breakdown.direct).toBe(20);
    const full = control('카드 강화');
    full.state.applyBuff({ id: 'speed', duration: .8, mod: { bucket: 'atkSpeed', value: .4, source: '통제' } });
    full.cast(); expect(full.state.now).toBeCloseTo(1.333 / 1.4 + 1.333);
  });
  it('scales both motions with imported Gale independently of attack speed', () => {
    const input = raw('카드 강화'); input.combatSkills.find(s => s.Name === '포 카드')!.Rune = { Name: '질풍', Grade: '전설', Tooltip: '스킬 시전 속도가 14% 증가합니다.' };
    const imported = four(buildFromArmory(input).build.skills);
    expect(imported.castTime).toBeCloseTo(2.666 / 1.14);
    const c = control('카드 강화'); c.skill.castTime = imported.castTime;
    c.build.passiveMods = [{ bucket: 'atkSpeed', value: .4, source: '통제' }];
    c.cast(); expect(c.state.now).toBeCloseTo(2.666 / 1.14 / 1.4);
  });
  it.each([0, 1, 2])('preserves gauge accounting with %s occupied slots', occupied => {
    const c = control('카드 강화');
    for (const id of ['cull', 'judgment'].slice(0, occupied)) c.state.drawCards(1, id);
    c.state.deck.gauge = occupied === 2 ? 0 : .95; c.cast();
    expect(c.state.cardDraws.gauge).toBe(occupied === 2 ? 0 : 1);
    expect(c.state.deck.gauge).toBeCloseTo(occupied === 0 ? .2932 : 0);
    expect(Object.values(c.state.cardDraws).reduce((a, b) => a + b, 0)).toBe(c.state.cardsDrawn);
    expect(c.state.cardsUsed + c.state.deck.hand.length).toBe(c.state.cardsDrawn);
  });
});

const invalid: [string, (s: SkillDef) => void][] = [
  ['null', s => Object.assign(s, { fourCardCombo: null })], ['unknown', s => Object.assign(s.fourCardCombo!, { candidate: 'other' })],
  ['base', s => { s.fourCardCombo!.gaugeBase = .5; }], ['time-zero', s => { s.fourCardCombo!.duration = 0; }],
  ['time-nan', s => { s.fourCardCombo!.hitAt = NaN; }], ['time-infinity', s => { s.fourCardCombo!.hitAt = Infinity; }],
  ['time-order', s => { s.fourCardCombo!.hitAt = 2; }], ['cast-zero', s => { s.castTime = 0; }],
  ['id', s => { s.id = 'secret_garden'; }], ['kind', s => { s.kind = 'normal'; }], ['hits', s => { s.hits = 1; }],
  ['reset', s => { s.cdResetChance = .8; }], ['preserve', s => { s.keepStacksChance = 1; }],
  ['aggregate-base', s => { s.gaugeBase = .1716; }], ['aggregate-marker', s => { s.gaugeCandidate = 'four-card-preserved'; }],
  ['hit-sequence', s => Object.assign(s, { hitSequence: {} })], ['charge', s => { s.maxCharges = 2; }],
];
it.each(invalid)('rejects inconsistent combo %s before any state changes', (_label, mutate) => {
  const c = control(); mutate(c.skill);
  expect(() => new SimState(c.build, createRng(1), cardsFor(c.build.variant))).toThrow(/연속 공격/);
  expect(c.cast).toThrow(/연속 공격/); expect(() => c.state.hit(c.skill, c.breakdown)).toThrow(/연속 공격/);
  expect([c.state.now, c.state.total, c.state.deck.gauge, c.breakdown.casts]).toEqual([0, 0, 0, 0]);
  expect(c.checks).toHaveLength(0); expect(c.state.readyAt.size).toBe(0);
});
it('rejects using the whole combo as a single aggregate hit', () => {
  const c = control(); expect(() => c.state.hit(c.skill, c.breakdown)).toThrow(/개별 적중/);
  expect(c.state.total).toBe(0);
});
