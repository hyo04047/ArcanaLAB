import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { captureSettingBaseline, rebuildSettings } from '../settings';
import { damageWarnings } from '../skilldata';
import { SimState } from '../sim';
import { applyTripods, tripodChoices } from '../tripodSettings';
import type { SkillDef } from '../types';
import { readSettingInput, regenerateSettingInput, saveSettingInput } from '../../settingFiles';
import modelId from 'virtual:arcanalab-model';

const oldText = readFileSync('tests/fixtures/audit/2026-10-30-four-card-combo-candidate/inputs/empress-base.json', 'utf8');
const old = JSON.parse(oldText);
const choose = (name: string) => {
  const row = tripodChoices.find(c => c.skillId === 'serendipity' && c.source.kind === 'official-observed' && c.tripod.Name === name)!;
  return { skillId: row.skillId, tier: row.tripod.Tier, choiceId: row.id };
};
const seren = (skills: SkillDef[]) => skills.find(s => s.id === 'serendipity')!;
function raw(first = '눈속임', third = '의도된 우연'): RawArmory {
  const input: RawArmory = structuredClone(old.setting.baseline.raw);
  applyTripods(input, [first, '우연한 일격', third].map(choose));
  input.combatSkills.find(s => s.Name === '세렌디피티')!.Rune = null;
  return input;
}
function control(first = '눈속임', third = '의도된 우연', rolls = [false, false]) {
  const { build } = buildFromArmory(raw(first, third));
  const skill = seren(build.skills);
  build.skills = [skill]; build.passiveMods = []; build.combatLevel = undefined;
  build.bluntThorn = undefined; build.onRuinAt4 = []; build.ruinFullset = undefined;
  build.chainDraw = undefined; build.onDestiny = []; build.params.gaugeGainBonus = 0;
  delete build.params.gaugeFactors; build.params.normalGaugePenalty = 0;
  build.params.atkBase = 1; build.params.raidCaptainRatio = 0;
  build.params.stackEffectCoefPerStack = 10; build.params.stackEffectScale = [0, 1, 2, 3, 4];
  skill.mods = []; skill.onCast = []; skill.onHit = []; skill.gaugeMultiplier = 1;
  for (const hit of skill.hitSequence!.hits) { hit.directCoef = 10; hit.directFlat = 0; }
  const checks: { purpose: string; p: number }[] = [];
  const rng = createRng(1, 'partitioned-v1'), stream = rng.stream!;
  rng.stream = key => ({ ...stream(key), chance(p) {
    const purpose = JSON.parse(key)[0]; checks.push({ purpose, p });
    return purpose === 'keepStacks' ? rolls.shift() ?? false : false;
  } });
  const state = new SimState(build, rng, cardsFor(build.variant)), breakdown = state.breakdown.get(skill.id)!;
  return { build, skill, state, breakdown, checks, cast: (end = 20, mode: 'auto' | 'full' = 'auto') => state.cast(skill, end, mode) };
}
const judgment = (state: SimState, duration: number) => state.applyBuff({ id: 'judgment', duration,
  mod: { bucket: 'critRate', value: 0, source: '통제' } });

describe('Serendipity gauge candidate import and preservation', () => {
  it.each([['꿰뚫는 일격', '연속된 어둠', 3], ['꿰뚫는 일격', '의도된 우연', 2], ['눈속임', '의도된 우연', 2]])
    ('imports and round-trips %s / %s', async (first, third, hits) => {
      const baseline = await captureSettingBaseline(raw(first as string, third as string));
      const text = await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId);
      const saved = await readSettingInput(text, 'seren', modelId), skill = seren(saved.build.skills);
      expect(skill.serendipityGauge?.perHit).toEqual(hits === 3 ? [.0728, .0728, .1144] : [.0728, .1144]);
      expect(skill.gaugeBase).toBeUndefined(); expect(skill.gaugeCandidate).toBeUndefined();
      expect(seren((await regenerateSettingInput(text, 'seren', modelId)).input.build.skills)).toEqual(skill);
      expect(saved.warnings!.some(w => w.includes('대체한 가정') && w.includes('실제 0이라는 뜻이 아닙니다'))).toBe(true);
    });
  it('keeps old saved builds and warnings until explicit regeneration', async () => {
    const saved = await readSettingInput(oldText, 'old', modelId);
    expect(saved.status).toBe('model-changed'); expect(saved.build).toEqual(old.build); expect(saved.warnings).toEqual(old.warnings);
    expect(seren(saved.build.skills).serendipityGauge).toBeUndefined();
    expect(seren((await regenerateSettingInput(oldText, 'old', modelId)).input.build.skills).serendipityGauge).toBeDefined();
    const c = control(); delete c.skill.serendipityGauge; c.state.stacks = 4; c.cast();
    expect(c.breakdown.direct).toBe(10); expect(c.state.deck.gauge).toBeCloseTo(.03);
    expect(damageWarnings(c.build).some(w => w.includes('평시 1타'))).toBe(true);
  });
  it('rebuilds all three candidates and removes stale profiles for unsupported combinations', async () => {
    const baseline = await captureSettingBaseline(raw());
    for (const [first, second, third, supported] of [
      ['꿰뚫는 일격', '우연한 일격', '연속된 어둠', true], ['꿰뚫는 일격', '우연한 일격', '의도된 우연', true],
      ['눈속임', '우연한 일격', '연속된 어둠', false], ['눈속임', '강화된 일격', '의도된 우연', false],
      ['눈속임', '우연한 일격', '의도된 우연', true],
    ] as const) {
      const result = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, tripods: [first, second, third].map(choose) });
      expect(!!seren(result.build.skills).serendipityGauge).toBe(supported);
      expect(seren(result.build.skills).hits).toBe(third === '연속된 어둠' ? 3 : 2);
    }
  });
  it.each(['눈속임', '우연한 일격', '의도된 우연'])('refuses an uninterpreted %s tooltip', name => {
    const input = raw(); input.combatSkills.find(s => s.Name === '세렌디피티')!.Tripods!.find(t => t.Name === name)!.Tooltip = '새로운 미확인 효과';
    const result = buildFromArmory(input);
    expect(seren(result.build.skills).serendipityGauge).toBeUndefined();
    expect(result.warnings.some(w => w.includes('해석 못함'))).toBe(true);
  });
  it('explains the new policy without calling the candidate an aggregate or fallback', () => {
    const c = control(), warnings = cardSupplyWarnings(c.build);
    expect(warnings.some(w => w.includes('각 실제 적중'))).toBe(true);
    expect(warnings.some(w => w.startsWith('카드 게이지는 스킬 분류') || w.includes('수동 기본량'))).toBe(false);
    expect(damageWarnings(c.build).some(w => w.includes('평시·심판 모두 두 타'))).toBe(true);
  });
});

describe('Serendipity gauge actual-hit accounting', () => {
  it.each(['연속된 어둠', '의도된 우연'])('keeps piercing first-only policy for %s', third => {
    const c = control('꿰뚫는 일격', third); c.cast();
    expect(c.breakdown.direct).toBe(10); expect(c.state.deck.gauge).toBeCloseTo(.0728); expect(c.state.now).toBe(1.8);
    const full = control('꿰뚫는 일격', third); judgment(full.state, 10); full.cast();
    expect(full.breakdown.direct).toBe(third === '연속된 어둠' ? 30 : 20);
    expect(full.state.deck.gauge).toBeCloseTo(third === '연속된 어둠' ? .26 : .1872);
  });
  it.each([[false, false, 40, 0, 1], [true, false, 80, 0, 2], [true, true, 80, 4, 2]])
    ('preserves per hit without adding a preservation reward: %s/%s', (a, b, damage, stacks, count) => {
      const c = control('눈속임', '의도된 우연', [a as boolean, b as boolean]); c.state.stacks = 4; c.cast();
      expect(c.breakdown.stackEffect).toBe(damage); expect(c.state.stacks).toBe(stacks);
      expect(c.checks.filter(r => r.purpose === 'keepStacks')).toEqual(Array(count).fill({ purpose: 'keepStacks', p: .48000000000000004 }));
      expect(c.breakdown.direct).toBe(20); expect(c.state.deck.gauge).toBeCloseTo(.1872);
      expect([c.state.ruinCasts, c.state.ruinAt4]).toEqual([1, 1]);
    });
  it.each([1, 2, 3])('preserves actual %s stacks, without the Four Card four-stack restriction', stacks => {
    const c = control('눈속임', '의도된 우연', [true, true]); c.state.stacks = stacks; c.cast();
    expect(c.state.stacks).toBe(stacks); expect(c.breakdown.stackEffect).toBe(stacks * 20);
    expect(c.state.deck.gauge).toBeCloseTo(.1872);
  });
  it.each([[.293, 0], [.294, 40], [1.093, 40], [1.094, 80]])('rechecks Judgment at each hit, expiry=%s', (expiry, damage) => {
    const c = control('눈속임', '의도된 우연', [true, true]); judgment(c.state, expiry!); c.cast();
    expect(c.breakdown.stackEffect).toBe(damage); expect(c.state.stacks).toBe(0);
    expect(c.checks.filter(r => r.purpose === 'keepStacks')).toHaveLength(0); expect(c.state.deck.gauge).toBeCloseTo(.1872);
  });
  it.each([0, .292, .293, .294, 1.092, 1.093, 1.094, 2.198, 2.199, 2.2, 2.867])('pays only reached hits at end=%s', end => {
    for (const [first, third] of [['눈속임', '의도된 우연'], ['꿰뚫는 일격', '연속된 어둠']]) {
      const c = control(first, third); const reached = c.skill.hitSequence!.hits.filter(h => h.at <= end).length;
      c.cast(end, 'full'); expect(c.breakdown.direct).toBe(reached * 10);
      expect(c.state.deck.gauge).toBeCloseTo(c.skill.serendipityGauge!.perHit.slice(0, reached).reduce((a, b) => a + b, 0));
    }
  });
  it('applies imported Gale and attack speed to existing hit times', () => {
    const input = raw(); input.combatSkills.find(s => s.Name === '세렌디피티')!.Rune = { Name: '질풍', Grade: '전설', Tooltip: '스킬 시전 속도가 14% 증가' };
    const build = buildFromArmory(input).build, skill = seren(build.skills); expect(skill.castTime).toBeCloseTo(1.8 / 1.14);
    const c = control(); c.skill.castTime = skill.castTime;
    c.state.applyBuff({ id: 'speed', duration: 10, mod: { bucket: 'atkSpeed', value: .4, source: '통제' } });
    c.cast(1.093 / 1.14 / 1.4); expect(c.breakdown.direct).toBe(20); expect(c.state.deck.gauge).toBeCloseTo(.1872);
  });
  it('multiplies each actual hit by specialization, Greed, Chain and Wealth once', () => {
    const c = control(); c.build.params.gaugeFactors = { specialization: .6, greed: .1 };
    c.build.params.gaugeGainBonus = .7; c.build.params.normalGaugePenalty = -.5;
    c.build.chainDraw = { chance: 0, gaugeBonus: .2 }; c.skill.gaugeMultiplier = 1.4; c.cast();
    expect(c.state.deck.gauge).toBeCloseTo(.1872 * 1.6 * 1.1 * 1.2 * 1.4);
  });
  it.each([0, 1, 2])('keeps hand and source accounting with %s occupied slots', occupied => {
    const c = control(); for (const id of ['cull', 'judgment'].slice(0, occupied)) c.state.drawCards(1, id);
    c.state.deck.gauge = occupied === 2 ? 0 : .95; c.cast();
    expect(c.state.cardDraws.gauge).toBe(occupied === 2 ? 0 : 1);
    expect(c.state.deck.gauge).toBeCloseTo(occupied === 0 ? .1372 : 0);
    expect(Object.values(c.state.cardDraws).reduce((a, b) => a + b, 0)).toBe(c.state.cardsDrawn);
    expect(c.state.cardsUsed + c.state.deck.hand.length).toBe(c.state.cardsDrawn);
  });
});

const invalid: [string, (s: SkillDef) => void][] = [
  ['null', s => Object.assign(s, { serendipityGauge: null })], ['unknown', s => Object.assign(s.serendipityGauge!, { candidate: 'other' })],
  ['extra-field', s => Object.assign(s.serendipityGauge!, { bonus: 1 })], ['length', s => { s.serendipityGauge!.perHit.pop(); }],
  ['value', s => { s.serendipityGauge!.perHit[1] = .0728; }], ['nan', s => { s.serendipityGauge!.perHit[0] = NaN; }],
  ['infinity', s => { s.serendipityGauge!.perHit[0] = Infinity; }], ['negative', s => { s.serendipityGauge!.perHit[0] = -.1; }],
  ['array-null', s => Object.assign(s.serendipityGauge!, { perHit: null })], ['id', s => { s.id = 'four_of_a_kind'; }],
  ['per-hit-hole', s => { delete s.serendipityGauge!.perHit[0]; }], ['sequence-hole', s => { delete s.hitSequence!.hits[0]; }],
  ['kind', s => { s.kind = 'normal'; }], ['hits', s => { s.hits = 3; }], ['duration', s => { s.hitSequence!.duration = 2; }],
  ['time', s => { s.hitSequence!.hits[1]!.at = 0; }], ['first-end', s => { s.hitSequence!.firstHitEnd = .293; }],
  ['profile', s => { delete s.hitSequence; }], ['cast-zero', s => { s.castTime = 0; }],
  ['preserve', s => { s.keepStacksChance = 1; }], ['minimum', s => { s.keepStacksMin = 4; }],
  ['intended', s => { delete s.tripodChanceBonus; }], ['proc', s => { delete s.procCritDmg; }],
  ['aggregate-base', s => { s.gaugeBase = .1872; }], ['aggregate-marker', s => { s.gaugeCandidate = 'four-card-preserved'; }],
  ['delayed', s => Object.assign(s, { delayedHits: {} })], ['charge', s => { s.maxCharges = 2; }],
];
it.each(invalid)('rejects inconsistent Serendipity %s before state changes', (_label, mutate) => {
  const c = control(); mutate(c.skill);
  expect(() => new SimState(c.build, createRng(1), cardsFor(c.build.variant))).toThrow(/세렌디피티/);
  expect(c.cast).toThrow(/세렌디피티/); expect(() => c.state.hit(c.skill, c.breakdown)).toThrow(/세렌디피티/);
  expect([c.state.now, c.state.total, c.state.deck.gauge, c.breakdown.casts]).toEqual([0, 0, 0, 0]);
  expect(c.checks).toHaveLength(0); expect(c.state.readyAt.size).toBe(0);
});
it('rejects a whole candidate as one aggregate hit', () => {
  const c = control(); expect(() => c.state.hit(c.skill, c.breakdown)).toThrow(/개별 적중/); expect(c.state.total).toBe(0);
});
