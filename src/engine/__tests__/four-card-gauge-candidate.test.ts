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

const savedText = readFileSync('tests/fixtures/audit/2026-10-30-gauge-modifier-candidate/inputs/empress-base.json', 'utf8');
const saved = JSON.parse(savedText);
const cases = [
  { name: '카드 강화', key: 'four-card-enhanced', base: .1716 },
  { name: '눈속임', key: 'four-card-preserved', base: .14247721471070698 },
] as const;
const choose = (name: string) => {
  const choice = tripodChoices.find(row => row.skillId === 'four_of_a_kind' && row.source.kind === 'official-observed' && row.tripod.Name === name)!;
  return { skillId: choice.skillId, tier: choice.tripod.Tier, choiceId: choice.id };
};
function raw(name = '카드 강화'): RawArmory {
  const input = structuredClone(saved.setting.baseline.raw);
  applyTripods(input, [choose(name)]);
  return input;
}
const four = (skills: SkillDef[]) => skills.find(s => s.id === 'four_of_a_kind')!;
function control(name = '눈속임', preserve = false) {
  const { build } = buildFromArmory(raw(name));
  const skill = four(build.skills);
  build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined; build.onRuinAt4 = [];
  build.ruinFullset = undefined; build.chainDraw = undefined; build.params.gaugeGainBonus = 0;
  delete build.params.gaugeFactors; build.params.normalGaugePenalty = 0;
  skill.mods = []; skill.onHit = []; skill.onCast = []; skill.gaugeMultiplier = 1;
  const checks: string[] = [], rng = createRng(1, 'partitioned-v1'), stream = rng.stream!;
  rng.stream = key => {
    const purpose = JSON.parse(key)[0];
    if (purpose !== 'keepStacks' && purpose !== 'cooldownReset') return stream(key);
    return { ...stream(key), chance() { checks.push(purpose); return purpose === 'keepStacks' ? preserve : true; } };
  };
  const state = new SimState(build, rng, cardsFor(build.variant));
  return { build, skill, state, checks, hit: () => state.hit(skill, state.breakdown.get(skill.id)!) };
}

describe('Four of a Kind candidate import and saved provenance', () => {
  it.each(cases)('connects only the $name combination and preserves it through save/reload', async row => {
    const baseline = await captureSettingBaseline(raw(row.name));
    const text = await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId);
    const read = await readSettingInput(text, 'candidate', modelId);
    expect(read.status).toBe('editable');
    expect(four(read.build.skills)).toMatchObject({ gaugeBase: row.base, gaugeCandidate: row.key });
    expect(read.warnings!.some(w => w.includes(row.name) && w.includes('게이지'))).toBe(true);
    const regenerated = await regenerateSettingInput(text, 'candidate', modelId);
    expect(four(regenerated.input.build.skills)).toEqual(four(read.build.skills));
  });
  it('switches both ways without retaining a stale base or provenance', async () => {
    const baseline = await captureSettingBaseline(raw());
    for (const name of ['눈속임', '카드 강화', '연속 공격', '스트레이트']) {
      const result = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, tripods: [choose(name)] });
      const skill = four(result.build.skills), expected = cases.find(row => row.name === name);
      expect(skill.gaugeBase).toBe(expected?.base);
      expect(skill.gaugeCandidate).toBe(expected?.key);
    }
    expect(baseline.raw).toEqual(raw());
  });
  it.each(['정신 강화', '부위파괴 강화', '연속 공격', '스트레이트'])('does not extend candidates to %s', name => {
    const input = raw(); applyTripods(input, [choose(name)]);
    expect(four(buildFromArmory(input).build.skills).gaugeBase).toBeUndefined();
  });
  it.each(['신속한 준비', '눈속임', '풀 하우스'])('does not trust an uninterpreted selected %s tooltip', name => {
    const input = raw('눈속임');
    input.combatSkills.find(s => s.Name === '포 카드')!.Tripods!.find(t => t.Name === name)!.Tooltip = '알 수 없는 새 효과';
    const skill = four(buildFromArmory(input).build.skills);
    expect(skill.gaugeBase).toBeUndefined(); expect(skill.gaugeCandidate).toBeUndefined();
  });
  it('leaves old settings untouched until an explicit rebuild', async () => {
    const read = await readSettingInput(savedText, 'old', modelId);
    expect(read.status).toBe('model-changed'); expect(read.build).toEqual(saved.build);
    expect(read.warnings).toEqual(saved.warnings);
    expect(four(read.build.skills).gaugeBase).toBeUndefined();
    const fresh = await regenerateSettingInput(savedText, 'old', modelId);
    expect(four(fresh.input.build.skills).gaugeBase).toBe(.1716);
  });
  it.each(cases)('does not relabel an old manual $name value as automatic', row => {
    const build = structuredClone(saved.build); four(build.skills).gaugeBase = row.base;
    const warnings = cardSupplyWarnings(build);
    expect(warnings.some(w => w.includes('수동 기본량') && w.includes('포 카드'))).toBe(true);
    expect(warnings.some(w => w.startsWith('포 카드 /'))).toBe(false);
  });
  it('distinguishes inverse evidence and does not claim a verified zero bonus', () => {
    const warnings = cardSupplyWarnings(buildFromArmory(raw('눈속임')).build);
    expect(warnings.some(w => w.includes('게시판 역산') && w.includes('풍요 없음') && w.includes('조건 미확인'))).toBe(true);
    expect(warnings.some(w => w.includes('보존 추가 수급') && w.includes('검증 전 가정'))).toBe(true);
  });
});

describe.each(cases)('$name event accounting', row => {
  it.each([0, 1, 2, 3, 4].flatMap(stacks => [false, true].flatMap(judgment => [false, true].map(preserve => ({ stacks, judgment, preserve })))))
    ('pays once at actual $stacks stacks, Judgment=$judgment, preserve=$preserve', ({ stacks, judgment, preserve }) => {
      const { state, checks, hit } = control(row.name, preserve);
      state.stacks = stacks;
      if (judgment) state.applyBuff({ id: 'judgment', duration: 5, mod: { bucket: 'critRate', value: 0, source: '통제' } });
      hit(); expect(state.deck.gauge).toBeCloseTo(row.base, 14);
      const attempts = row.name === '눈속임' && stacks === 4 ? 1 : 0;
      expect(checks).toEqual(Array(attempts).fill('keepStacks'));
      expect(state.stacks).toBe(attempts && preserve ? 4 : 0);
    });
  it('pays only on actual hits after reset, and nothing when the fight ends before the hit', () => {
    const a = control(row.name, true);
    a.state.stacks = 4;
    a.state.cast(a.skill, 100); a.state.cast(a.skill, 100);
    expect(a.state.deck.gauge).toBeCloseTo(row.base * 2, 14);
    expect(a.checks.filter(x => x === 'cooldownReset')).toHaveLength(2);
    expect(a.checks.filter(x => x === 'keepStacks')).toHaveLength(row.name === '눈속임' ? 2 : 0);
    const b = control(row.name, true); b.state.cast(b.skill, .01);
    expect(b.state.deck.gauge).toBe(0); expect(b.checks).toEqual(['cooldownReset']);
  });
  it.each([0, 1, 2])('preserves draw/held-card accounting with %s occupied slots', occupied => {
    const { state, hit } = control(row.name, true);
    for (const id of ['cull', 'judgment'].slice(0, occupied)) state.drawCards(1, id);
    state.deck.gauge = occupied === 2 ? 0 : .95; state.stacks = 4;
    hit();
    expect(state.cardDraws.gauge).toBe(occupied === 2 ? 0 : 1);
    expect(state.deck.gauge).toBeCloseTo(occupied === 0 ? row.base - .05 : 0, 14);
    expect(Object.values(state.cardDraws).reduce((a, b) => a + b, 0)).toBe(state.cardsDrawn);
    expect(state.cardsUsed + state.deck.hand.length).toBe(state.cardsDrawn);
  });
});

it.each(['unknown', 'null', 'base', 'missing-base', 'kind', 'hits', 'id', 'profile'])('rejects inconsistent candidate %s before effects and at construction', field => {
  const { build, state, skill, hit } = control();
  if (field === 'unknown') Object.assign(skill, { gaugeCandidate: 'other' });
  if (field === 'null') Object.assign(skill, { gaugeCandidate: null });
  if (field === 'base') skill.gaugeBase = .1716;
  if (field === 'missing-base') delete skill.gaugeBase;
  if (field === 'kind') skill.kind = 'normal';
  if (field === 'hits') skill.hits = 2;
  if (field === 'id') skill.id = 'secret_garden';
  if (field === 'profile') Object.assign(skill, { hitSequence: {} });
  expect(() => new SimState(build, createRng(1), cardsFor(build.variant))).toThrow(/게이지|합산 적중/);
  expect(hit).toThrow(/게이지|합산 적중/);
  expect(state.total).toBe(0); expect(state.cardsDrawn).toBe(0); expect(state.deck.gauge).toBe(0);
});
