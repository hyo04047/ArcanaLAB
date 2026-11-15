import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { captureSettingBaseline, rebuildSettings } from '../settings';
import type { Build, SkillDef } from '../types';
import { coreTestTooltip } from './core-fixture';

const saved = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-30-card-gauge-candidate/inputs/empress-base.json', 'utf8'));
const raw = (): RawArmory => structuredClone(saved.setting.baseline.raw);
const create = (build: Build) => new SimState(build, createRng(1), cardsFor(build.variant));
function control(kind: SkillDef['kind'] = 'ruin', specialization = .6205, greed = .04, chain = .15) {
  const build: Build = structuredClone(saved.build);
  build.passiveMods = []; build.bluntThorn = undefined; build.onRuinAt4 = []; build.ruinFullset = undefined;
  build.chainDraw = { gaugeBonus: chain };
  build.params.gaugeFactors = { specialization, greed };
  build.params.gaugeGainBonus = specialization + greed;
  build.params.normalGaugePenalty = greed > 0 ? -.5 : 0;
  const skill: SkillDef = { id: 'probe', name: '수급 통제', kind, hits: 3, gaugeBase: .01,
    directCoef: 0, cooldown: 1, castTime: .5, gaugeMultiplier: 1 };
  build.skills = [skill];
  const state = create(build);
  return { build, skill, state, hit: () => state.hit(skill, state.breakdown.get(skill.id)!) };
}

describe('public gauge modifier candidate import and preservation', () => {
  it('separates displayed specialization and Greed without losing the legacy sum', () => {
    const { build, warnings } = buildFromArmory(raw());
    expect(build.params.gaugeFactors?.specialization).toBeCloseTo(.6205, 14);
    expect(build.params.gaugeFactors?.greed).toBe(.04);
    expect(build.params.gaugeGainBonus).toBe(.6605);
    expect(warnings.some(w => w.includes('곱연산') && w.includes('루인') && w.includes('미검증'))).toBe(true);
    expect(warnings.some(w => w.includes('게이지 증가는 합산'))).toBe(false);
    expect(saved.build.params.gaugeFactors).toBeUndefined();
    expect(cardSupplyWarnings(saved.build)).toEqual(saved.warnings.filter((w: string) => cardSupplyWarnings(saved.build).includes(w)));
  });
  it('regenerates components from selected stats without carrying a manual factor', async () => {
    const baseline = await captureSettingBaseline(raw());
    const selections = { baselineFingerprint: baseline.fingerprint, stats: { spec: 1800 } };
    const changed = await rebuildSettings(baseline, selections);
    expect(changed.build.params.gaugeFactors?.specialization).toBeCloseTo(1800 * 25 / 69900, 14);
    expect(changed.build.params.gaugeFactors?.greed).toBe(.04);
    changed.build.params.gaugeFactors!.greed = .8;
    expect((await rebuildSettings(baseline, selections)).build.params.gaugeFactors?.greed).toBe(.04);
    expect(baseline.raw).toEqual(saved.setting.baseline.raw);
  });
  it('retains the legacy sum and an explicit notice for an additional gauge effect', () => {
    const input = raw();
    input.arkgrid = { Slots: [{ Index: 1, Name: '질서의 달 코어 : 체인 드로우', Point: 17,
      Tooltip: coreTestTooltip('[10P] 덱 게이지 획득량이 7.0% 증가한다. [17P] 스킬 적중으로 획득하는 덱 게이지가 15.0% 증가한다.') }] };
    const { build, warnings } = buildFromArmory(input);
    expect(build.params.gaugeGainBonus).toBeCloseTo(.7305, 14);
    expect(build.params.gaugeFactors).toBeUndefined();
    expect(build.chainDraw?.gaugeBonus).toBe(.15);
    expect(warnings.some(w => w.includes('기타 게이지 증가') && w.includes('기존 합산'))).toBe(true);
    expect(cardSupplyWarnings(build).some(w => w.includes('17P 적중 게이지는 특화·탐욕과 합산'))).toBe(true);
  });
  it('keeps Chain use probability separate from the candidate hit multiplier warning', () => {
    const { build } = control(); build.chainDraw!.chance = .25;
    const warning = cardSupplyWarnings(build).find(w => w.startsWith('체인 드로우'))!;
    expect(warning).toContain('실제 카드 사용 뒤'); expect(warning).toContain('별도로 곱');
    expect(warning).not.toContain('특화·탐욕과 합산');
  });
});

describe('candidate gauge arithmetic and event scope', () => {
  const matrix = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-30-gauge-modifier-adoption/analysis.json', 'utf8')).matrix;
  it('matches all 108 independently saved scope and modifier cases', () => {
    for (const row of matrix) {
      const { state, hit } = control(row.category, row.specialization, row.greedLevel * .04, row.chain);
      hit(); expect(state.deck.gauge).toBeCloseTo(.01 * row.proposed, 14);
    }
  });
  it.each([['normal', .9317875], ['ruin', 1.938118], ['stack', 1.863575]] as const)('respects transformed %s and Wealth', (tag, expected) => {
    const { state, skill, hit } = control(tag === 'stack' ? 'stack' : 'hyper_awakening');
    if (tag !== 'stack') skill.tags = [tag];
    skill.gaugeMultiplier = 1.4;
    hit(); expect(state.deck.gauge).toBeCloseTo(.01 * expected * 1.4, 14);
  });
  it('uses the existing per-hit fallback once and pays nothing for zero hits or identity', () => {
    const { build, state, skill, hit } = control();
    delete skill.gaugeBase; build.params.gaugePerHit.ruin = .01;
    hit(); expect(state.deck.gauge).toBeCloseTo(.03 * 1.938118, 14);
    state.deck.gauge = 0; skill.hits = 0; hit(); expect(state.deck.gauge).toBe(0);
    skill.hits = 1; skill.kind = 'identity_card'; hit(); expect(state.deck.gauge).toBe(0);
  });
  it('retains exact additive behavior when the new field is absent', () => {
    const { build, state, skill, hit } = control('normal');
    delete build.params.gaugeFactors; skill.gaugeMultiplier = 1.4;
    hit(); expect(state.deck.gauge).toBeCloseTo(.01 * 1.8105 * 1.4 * .5, 14);
  });
  it.each([0, 1, 2])('reconciles gauge and forced draws with %s occupied slots', occupied => {
    const { state, hit, skill } = control(); skill.gaugeBase = .2;
    for (const id of ['cull', 'judgment'].slice(0, occupied)) state.drawCards(1, id);
    state.deck.gauge = occupied === 2 ? 0 : .9;
    hit();
    expect(state.cardDraws.gauge).toBe(occupied === 2 ? 0 : 1);
    expect(state.deck.gauge).toBeCloseTo(occupied === 0 ? .2876236 : 0, 14);
    expect(Object.values(state.cardDraws).reduce((a, b) => a + b, 0)).toBe(state.cardsDrawn);
    expect(state.cardsUsed + state.deck.hand.length).toBe(state.cardsDrawn);
  });
  it('does not multiply Quick Draw or Royal and does not pay before the hit', () => {
    const { state, skill, hit } = control();
    state.cast(skill, .01); expect(state.deck.gauge).toBe(0);
    skill.quickDraw = { chance: 1, attempts: 1, trigger: 'each' };
    hit(); expect(state.cardDraws.quickDraw).toBe(1);
    state.useCardNow(state.deck.hand[0]!);
    state.drawCards(1, 'royal'); state.useCardNow('royal');
    expect(state.cardDraws.royal).toBe(2);
  });
});

describe('candidate input boundaries', () => {
  const invalid = [null, true, [], {}, { specialization: .6205 }, { specialization: .6205, greed: .04, other: .1 },
    ...['0.6205', -1, NaN, Infinity].map(specialization => ({ specialization, greed: .04 })),
    ...[null, '0.04', -.01, 1.1, NaN, Infinity].map(greed => ({ specialization: .6205, greed }))];
  it.each(invalid.map(value => ({ value })))('rejects malformed components $value at construction and before hit effects', ({ value }) => {
    const { build, state, skill, hit } = control(); skill.directCoef = 10;
    build.params.gaugeFactors = value as Build['params']['gaugeFactors'];
    expect(() => create(build)).toThrow('게이지 조합'); expect(hit).toThrow('게이지 조합');
    expect(state.total).toBe(0); expect(state.cardsDrawn).toBe(0); expect(state.deck.gauge).toBe(0);
  });
  it.each(['sum', 'penalty', 'chain', 'wealth'] as const)('rejects inconsistent or invalid %s before the hit', field => {
    const { build, state, skill, hit } = control(); skill.directCoef = 10;
    if (field === 'sum') build.params.gaugeGainBonus = .7;
    if (field === 'penalty') build.params.normalGaugePenalty = 0;
    if (field === 'chain') build.chainDraw!.gaugeBonus = -1;
    if (field === 'wealth') skill.gaugeMultiplier = -1;
    expect(hit).toThrow('게이지 조합'); expect(state.total).toBe(0); expect(state.cardsDrawn).toBe(0);
  });
  it('does not guess components from the same legacy sum', () => {
    const a = control('stack', .6205, .04, 0), b = control('stack', .5805, .08, 0);
    expect(a.build.params.gaugeGainBonus).toBeCloseTo(b.build.params.gaugeGainBonus, 14);
    a.hit(); b.hit(); expect(a.state.deck.gauge).not.toBe(b.state.deck.gauge);
  });
});
