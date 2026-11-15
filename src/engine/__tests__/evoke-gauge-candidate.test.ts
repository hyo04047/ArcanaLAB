import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { captureSettingBaseline, rebuildSettings } from '../settings';
import { SimState } from '../sim';
import { applyTripods, tripodChoices } from '../tripodSettings';
import type { SkillDef } from '../types';
import { readSettingInput, regenerateSettingInput, saveSettingInput } from '../../settingFiles';
import modelId from 'virtual:arcanalab-model';

const oldText = readFileSync('tests/fixtures/audit/2026-10-30-serendipity-gauge-candidate/final/inputs/emperor-base.json', 'utf8');
const old = JSON.parse(oldText);
const firsts = ['빠른 준비', '정신 강화', '퀵 드로'], seconds = ['집속 마법진', '마나 중독', '치명적 공격'];
const thirds = ['분할 마법진', '중첩 마법진'];
const combinations = firsts.flatMap(first => seconds.flatMap(second => thirds.map(third => [first, second, third])));
const choose = (name: string) => {
  const row = tripodChoices.find(c => c.skillId === 'evoke' && c.source.kind === 'official-observed' && c.tripod.Name === name)!;
  return { skillId: row.skillId, tier: row.tripod.Tier, choiceId: row.id };
};
const evoke = (skills: SkillDef[]) => skills.find(s => s.id === 'evoke')!;
function raw(names = ['퀵 드로', '집속 마법진', '분할 마법진']): RawArmory {
  const input: RawArmory = structuredClone(old.setting.baseline.raw);
  applyTripods(input, names.map(choose)); input.combatSkills.find(s => s.Name === '이보크')!.Rune = null;
  return input;
}
function control(third = '분할 마법진', poison = false, rolls: boolean[] = []) {
  const { build } = buildFromArmory(raw(['퀵 드로', poison ? '마나 중독' : '집속 마법진', third]));
  const skill = evoke(build.skills); build.skills = [skill]; build.passiveMods = []; build.combatLevel = undefined;
  build.bluntThorn = undefined; build.onRuinAt4 = []; build.ruinFullset = undefined; build.chainDraw = undefined;
  build.onDestiny = []; build.onCardUse = []; build.emperorHeartChance = undefined; build.anotherEmperorChance = undefined;
  build.params.gaugeGainBonus = 0; delete build.params.gaugeFactors; build.params.normalGaugePenalty = 0;
  build.params.atkBase = 1; build.params.raidCaptainRatio = 0;
  skill.mods = []; skill.onCast = []; skill.onHit = []; skill.gaugeMultiplier = 1; skill.directCoef = 100; skill.directFlat = 0;
  const checks: { purpose: string; p: number }[] = [];
  const rng = createRng(1, 'partitioned-v1'), stream = rng.stream!;
  rng.stream = key => ({ ...stream(key), chance(p) {
    const purpose = JSON.parse(key)[0]; checks.push({ purpose, p });
    return purpose === 'quickDraw' ? rolls.shift() ?? false : false;
  } });
  const state = new SimState(build, rng, cardsFor(build.variant).filter(c => ['cull', 'judgment'].includes(c.id))), breakdown = state.breakdown.get(skill.id)!;
  const cast = (end = 20) => state.cast(skill, end);
  const both = () => { cast(); if (third === '중첩 마법진') state.advanceTo(.338 + 1); cast(); state.advanceTo(5); };
  return { build, skill, state, breakdown, checks, cast, both };
}

describe('Evoke gauge input and save compatibility', () => {
  it.each(combinations)('round-trips and regenerates %s / %s / %s', async (first, second, third) => {
    const baseline = await captureSettingBaseline(raw([first!, second!, third!]));
    const text = await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId);
    const saved = await readSettingInput(text, 'evoke', modelId), skill = evoke(saved.build.skills);
    expect(skill.evokeGauge).toEqual(third === '분할 마법진'
      ? { candidate: 'evoke-split', perHit: [.1196], warningVersion: 2 } : { candidate: 'evoke-overlap', perHit: [.1196, .0624, .0312], warningVersion: 2 });
    expect(skill.gaugeBase).toBeUndefined(); expect(evoke((await regenerateSettingInput(text, 'evoke', modelId)).input.build.skills)).toEqual(skill);
    expect(saved.warnings!.some(w => w.includes('약 2배 차이') && w.includes('실제 0이라는 뜻이 아닙니다'))).toBe(true);
    if (first === '정신 강화') expect(saved.warnings!.some(w => w.includes('정신 강화') && w.includes('미모델'))).toBe(true);
  });
  it('keeps old saved values and warnings until regeneration', async () => {
    const saved = await readSettingInput(oldText, 'old', modelId);
    expect(saved.status).toBe('model-changed'); expect(saved.build).toEqual(old.build); expect(saved.warnings).toEqual(old.warnings);
    expect(evoke(saved.build.skills).evokeGauge).toBeUndefined();
    expect(evoke((await regenerateSettingInput(oldText, 'old', modelId)).input.build.skills).evokeGauge).toBeDefined();
    for (const third of thirds) { const c = control(third); delete c.skill.evokeGauge; c.both(); expect(c.state.deck.gauge).toBeCloseTo(third === '분할 마법진' ? .08 : .12); }
  });
  it('rebuilds between forms and leaves the basic manual form unmarked', async () => {
    const baseline = await captureSettingBaseline(raw());
    for (const third of [...thirds, ...[...thirds].reverse()]) {
      const r = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, tripods: ['정신 강화', '마나 중독', third].map(choose) });
      expect(evoke(r.build.skills).evokeGauge?.candidate).toBe(third === '분할 마법진' ? 'evoke-split' : 'evoke-overlap');
    }
    const input = raw(); input.combatSkills.find(s => s.Name === '이보크')!.Tripods!.forEach(t => { if (t.Tier === 2) t.IsSelected = false; });
    expect(evoke(buildFromArmory(input).build.skills).evokeGauge).toBeUndefined();
  });
  it.each([...firsts, ...seconds, ...thirds])('does not adopt an uninterpreted %s tooltip', name => {
    const names = [firsts.includes(name) ? name : '퀵 드로', seconds.includes(name) ? name : '집속 마법진', thirds.includes(name) ? name : '분할 마법진'];
    const input = raw(names); input.combatSkills.find(s => s.Name === '이보크')!.Tripods!.find(t => t.Name === name)!.Tooltip = '새로운 미확인 효과';
    expect(evoke(buildFromArmory(input).build.skills).evokeGauge).toBeUndefined();
  });
  it('refuses changed timing and Quick Draw values even when parsed', () => {
    for (const [name, from, to] of [['분할 마법진', '3.0', '4.0'], ['퀵 드로', '20.0', '40.0']]) {
      const input = raw(), t = input.combatSkills.find(s => s.Name === '이보크')!.Tripods!.find(t => t.Name === name)!;
      t.Tooltip = t.Tooltip!.replace(from!, to!); expect(evoke(buildFromArmory(input).build.skills).evokeGauge).toBeUndefined();
    }
  });
  it('labels candidate, fallback and a same-valued manual aggregate separately', () => {
    const c = control(); expect(cardSupplyWarnings(c.build).some(w => w.includes('폭발별 게이지'))).toBe(true);
    expect(cardSupplyWarnings(c.build).some(w => w.includes('임시값') || w.includes('수동 기본량'))).toBe(false);
    delete c.skill.evokeGauge; expect(cardSupplyWarnings(c.build).some(w => w.includes('임시값'))).toBe(true);
    delete c.skill.splitEvoke; c.skill.gaugeBase = .2392;
    expect(cardSupplyWarnings(c.build).some(w => w.includes('수동 기본량'))).toBe(true);
    expect(cardSupplyWarnings(c.build).some(w => w.includes('폭발별 게이지'))).toBe(false);
  });
});

describe('actual explosions, timing and card supply', () => {
  it.each(thirds)('pays no installation or unused-expiry bonus for %s', third => {
    const c = control(third); c.cast(); expect(c.state.deck.gauge).toBe(0); expect(c.checks.filter(r => r.purpose === 'quickDraw')).toHaveLength(0);
    c.state.advanceTo(15); expect(c.state.deck.gauge).toBeCloseTo(third === '분할 마법진' ? .1196 : 0);
    expect(c.checks.filter(r => r.purpose === 'quickDraw')).toHaveLength(third === '분할 마법진' ? 1 : 0);
  });
  it.each(thirds)('keeps damage weights separate and Quick Draw per real explosion: %s', third => {
    const c = control(third); c.both(); expect(c.breakdown.direct).toBe(third === '분할 마법진' ? 200 : 175);
    expect(c.state.deck.gauge).toBeCloseTo(third === '분할 마법진' ? .2392 : .2132);
    expect(c.checks.filter(r => r.purpose === 'quickDraw')).toEqual(Array(third === '분할 마법진' ? 2 : 3).fill({ purpose: 'quickDraw', p: .2 }));
    expect(c.breakdown.casts).toBe(1); expect(c.state.cardDraws.quickDraw).toBe(0);
  });
  it.each([0, .325, .326, .327, 1.3, 2.325, 2.326, 2.327, 3.625, 3.626, 3.627])('honors split placement/explosion end=%s', end => {
    const c = control(); c.cast(end); if (end > 1.3) c.cast(end); c.state.advanceTo(end);
    const count = [2.326, 1.3 + .326 + 2].filter(at => at <= end).length;
    expect(c.state.deck.gauge).toBeCloseTo(count * .1196); expect(c.breakdown.direct).toBe(count * 100);
  });
  it.each([0, .337, .338, .339, 1.3, .338 + 1 - .001, .338 + 1, .338 + 1 + .001, .338 + 1.5 - .001, .338 + 1.5, .338 + 2 - .001, .338 + 2, .338 + 2 + .001])
    ('honors overlap placement/reinput/explosion end=%s', end => {
      const c = control('중첩 마법진'); c.cast(end);
      if (end >= .338 + 1) { c.state.advanceTo(.338 + 1); c.cast(end); }
      c.state.advanceTo(end);
      const offsets = [0, .5, 1], count = offsets.filter(at => .338 + 1 + at <= end).length;
      expect(c.state.deck.gauge).toBeCloseTo([.1196, .0624, .0312].slice(0, count).reduce((a, b) => a + b, 0));
    });
  it.each(thirds)('keeps several cycles of pending %s explosions', third => {
    const c = control(third); c.cast(); if (third === '중첩 마법진') c.state.advanceTo(.338 + 1); c.cast();
    c.state.readyAt.delete('evoke'); const start = c.state.now; c.cast(); if (third === '중첩 마법진') c.state.advanceTo(start + .338 + 1); c.cast();
    c.state.advanceTo(10); expect(c.state.deck.gauge).toBeCloseTo(2 * (third === '분할 마법진' ? .2392 : .2132));
    expect(c.breakdown.casts).toBe(2);
  });
  it('reads buffs at each explosion and does not multiply the gauge by damage', () => {
    const c = control('중첩 마법진'); c.cast(); c.state.advanceTo(.338 + 1); c.cast();
    c.state.applyBuff({ id: 'damage', duration: .75, mod: { bucket: 'skillDmg', value: 1, source: '통제' } });
    c.state.advanceTo(3); expect(c.breakdown.direct).toBe(100 + 100 + 25); expect(c.state.deck.gauge).toBeCloseTo(.2132);
  });
  it('applies attack speed and Gale to placement, while preserving explosion delay', () => {
    const c = control(); c.skill.castTime /= 1.14;
    c.state.applyBuff({ id: 'speed', duration: 10, mod: { bucket: 'atkSpeed', value: .4, source: '통제' } });
    c.cast(); const hitAt = .326 / 1.14 / 1.4 + 2;
    c.state.advanceTo(hitAt - .001); expect(c.state.deck.gauge).toBe(0); c.state.advanceTo(hitAt); expect(c.state.deck.gauge).toBeCloseTo(.1196);
  });
  it.each(thirds)('does not give poison ticks more gauge or Quick Draw: %s', third => {
    const c = control(third, true); c.cast(); if (third === '중첩 마법진') c.state.advanceTo(.338 + 1); c.cast();
    c.state.advanceTo(4); const dot = c.breakdown.dot ?? 0, checks = c.checks.filter(r => r.purpose === 'quickDraw').length;
    c.state.advanceTo(9); expect(c.breakdown.dot).toBeGreaterThan(dot);
    expect(c.state.deck.gauge).toBeCloseTo(third === '분할 마법진' ? .2392 : .2132);
    expect(c.checks.filter(r => r.purpose === 'quickDraw')).toHaveLength(checks);
  });
  it.each(thirds)('applies specialization, normal Greed penalty, Chain and Wealth once: %s', third => {
    const c = control(third); c.build.params.gaugeFactors = { specialization: .6, greed: .1 };
    c.build.params.gaugeGainBonus = .7; c.build.params.normalGaugePenalty = -.5;
    c.build.chainDraw = { chance: 0, gaugeBonus: .2 }; c.skill.gaugeMultiplier = 1.4; c.both();
    expect(c.state.deck.gauge).toBeCloseTo((third === '분할 마법진' ? .2392 : .2132) * 1.6 * .5 * 1.2 * 1.4);
  });
  it.each([0, 1, 2])('accounts for gauge and independent Quick Draw with %s occupied slots', occupied => {
    const c = control('중첩 마법진', false, [true, true, true]);
    for (const id of ['cull', 'judgment'].slice(0, occupied)) c.state.drawCards(1, id);
    c.state.deck.gauge = occupied === 2 ? 0 : .95; c.cast(); c.state.advanceTo(.338 + 1); c.cast();
    expect(c.state.deck.isFull).toBe(true); c.state.useCardNow(c.state.deck.hand[0]!); c.state.advanceTo(3);
    expect(c.state.cardDraws.gauge).toBe(occupied === 2 ? 0 : 1); expect(c.state.cardDraws.quickDraw).toBe(occupied === 0 ? 2 : 1);
    expect(c.checks.filter(r => r.purpose === 'quickDraw')).toHaveLength(3);
    expect(Object.values(c.state.cardDraws).reduce((a, b) => a + b, 0)).toBe(c.state.cardsDrawn);
    expect(c.state.cardsUsed + c.state.deck.hand.length).toBe(c.state.cardsDrawn);
  });
});

const invalid: [string, (s: SkillDef) => void][] = [
  ['null', s => Object.assign(s, { evokeGauge: null })], ['unknown', s => Object.assign(s.evokeGauge!, { candidate: 'other' })],
  ['extra-field', s => Object.assign(s.evokeGauge!, { bonus: 1 })], ['length', s => { s.evokeGauge!.perHit.pop(); }],
  ['value', s => { s.evokeGauge!.perHit[0] = .04; }], ['nan', s => { s.evokeGauge!.perHit[0] = NaN; }],
  ['infinity', s => { s.evokeGauge!.perHit[0] = Infinity; }], ['negative', s => { s.evokeGauge!.perHit[0] = -.1; }],
  ['array-null', s => Object.assign(s.evokeGauge!, { perHit: null })], ['hole', s => { delete s.evokeGauge!.perHit[0]; }],
  ['id', s => { s.id = 'other'; }], ['kind', s => { s.kind = 'ruin'; }], ['hits', s => { s.hits = 3; }],
  ['duration', s => { s.manualEvoke!.duration = 2; }], ['time', s => { s.manualEvoke!.hits[1]!.after = 0; }],
  ['weight', s => { s.manualEvoke!.hits[1]!.weight = 1; }], ['hit-hole', s => { delete s.manualEvoke!.hits[0]; }],
  ['placement', s => { s.manualEvoke!.placementAt = 0; }], ['wait', s => { s.manualEvoke!.minRecastDelay = 0; }],
  ['expiry', s => { s.manualEvoke!.lifetime = 1; }], ['recovery', s => { s.manualEvoke!.recastRecovery = 1; }],
  ['profile', s => { delete s.manualEvoke; }], ['cast-zero', s => { s.castTime = 0; }],
  ['aggregate', s => { s.gaugeBase = .2132; }], ['marker', s => { s.gaugeCandidate = 'four-card-preserved'; }],
  ['delayed', s => Object.assign(s, { delayedHits: {} })], ['sequence', s => Object.assign(s, { hitSequence: {} })],
  ['both-profiles', s => Object.assign(s, { splitEvoke: {} })], ['charge', s => { s.maxCharges = 2; }],
  ['qd-chance', s => { s.quickDraw!.chance = .4; }], ['qd-attempts', s => { s.quickDraw!.attempts = 1; }],
  ['qd-trigger', s => { s.quickDraw!.trigger = 'first'; }],
];
it.each(invalid)('rejects inconsistent Evoke %s before state changes', (_label, mutate) => {
  const c = control('중첩 마법진'); mutate(c.skill);
  expect(() => new SimState(c.build, createRng(1), cardsFor(c.build.variant))).toThrow(/이보크/);
  expect(c.cast).toThrow(/이보크/); expect(() => c.state.hit(c.skill, c.breakdown)).toThrow(/이보크/);
  expect([c.state.now, c.state.total, c.state.deck.gauge, c.breakdown.casts]).toEqual([0, 0, 0, 0]);
  expect(c.checks).toHaveLength(0); expect(c.state.readyAt.size).toBe(0);
});
it.each(['duration', 'placementAt', 'delay', 'window'] as const)('rejects changed split %s', key => {
  const c = control(); c.skill.splitEvoke![key] = 0; expect(c.cast).toThrow(/이보크/); expect(c.state.now).toBe(0);
});
it.each(thirds)('rejects a whole %s candidate as one aggregate hit', third => {
  const c = control(third); expect(() => c.state.hit(c.skill, c.breakdown)).toThrow(/개별 폭발/); expect(c.state.total).toBe(0);
});
