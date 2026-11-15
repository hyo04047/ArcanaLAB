import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { applyTripods, tripodChoices } from '../tripodSettings';
import type { SkillDef } from '../types';
import { readSettingInput, regenerateSettingInput } from '../../settingFiles';
import modelId from 'virtual:arcanalab-model';

const dir = 'tests/fixtures/audit/2026-10-31-evoke-manual-candidate/before';
const firsts = [null, '빠른 준비', '정신 강화', '퀵 드로'];
const load = (i: number, j = 0) => readFileSync(`${dir}/inputs/manual-${i}-${j}.json`, 'utf8');
const evoke = (skills: SkillDef[]) => skills.find(s => s.id === 'evoke')!;
function raw(first: string | null = '퀵 드로', second: string | null = null, third: string | null = null): RawArmory {
  const input: RawArmory = structuredClone(JSON.parse(load(0)).setting.baseline.raw);
  applyTripods(input, [first, second, third].map((name, tier) => ({ skillId: 'evoke', tier,
    choiceId: name === null ? null : tripodChoices.find(x => x.skillId === 'evoke' && x.source.kind === 'official-observed' && x.tripod.Name === name)!.id,
  })));
  input.combatSkills.find(s => s.Name === '이보크')!.Rune = null;
  return input;
}
function control(roll = false) {
  const { build } = buildFromArmory(raw()); const skill = evoke(build.skills);
  build.skills = [skill]; build.passiveMods = []; build.combatLevel = undefined; build.bluntThorn = undefined;
  build.onRuinAt4 = []; build.ruinFullset = undefined; build.chainDraw = undefined;
  build.onDestiny = []; build.onCardUse = []; build.emperorHeartChance = undefined; build.anotherEmperorChance = undefined;
  build.params.gaugeGainBonus = 0; delete build.params.gaugeFactors; build.params.normalGaugePenalty = 0;
  build.params.atkBase = 1; build.params.raidCaptainRatio = 0;
  skill.mods = []; skill.onCast = []; skill.onHit = []; skill.gaugeMultiplier = 1; skill.directCoef = 100; skill.directFlat = 0;
  const checks: number[] = [], rng = createRng(1, 'partitioned-v1'), stream = rng.stream!;
  rng.stream = key => ({ ...stream(key), chance(p) {
    if (JSON.parse(key)[0] !== 'quickDraw') return false;
    checks.push(p); return roll;
  } });
  const state = new SimState(build, rng, cardsFor(build.variant).filter(c => ['cull', 'judgment'].includes(c.id)));
  const breakdown = state.breakdown.get('evoke')!, cast = (end = 20) => state.cast(skill, end);
  const detonate = () => { cast(); state.advanceTo(1.321); cast(); };
  return { build, skill, state, breakdown, checks, cast, detonate };
}

describe('basic manual candidate selection and saved input boundaries', () => {
  it.each(firsts)('connects only the same-effect %s state on regeneration', async first => {
    const text = load(firsts.indexOf(first)), old = JSON.parse(text);
    const saved = await readSettingInput(text, 'before', modelId);
    expect(saved.status).toBe('model-changed'); expect(saved.build).toEqual(old.build); expect(saved.warnings).toEqual(old.warnings);
    const regenerated = (await regenerateSettingInput(text, 'basic', modelId)).input;
    const skill = evoke(regenerated.build.skills);
    expect(skill.evokeGauge).toEqual({ candidate: 'evoke-manual-basic', perHit: [.1196], warningVersion: 2 });
    expect(skill.manualEvoke?.hits).toEqual([{ after: 0, weight: 1 }]); expect(skill.gaugeBase).toBeUndefined();
    expect((await readSettingInput(regenerated.text, 'roundtrip', modelId)).build).toEqual(regenerated.build);
    expect(regenerated.warnings!.some(w => w.includes('동일 경로') && w.includes('실게임 지급량 검증이 아닙니다'))).toBe(true);
    if (first === '정신 강화') expect(regenerated.warnings!.some(w => w.includes('정신 강화') && w.includes('미모델'))).toBe(true);
    const tampered = JSON.parse(regenerated.text); evoke(tampered.build.skills).evokeGauge!.perHit[0] = .04;
    await expect(readSettingInput(JSON.stringify(tampered), 'tampered', modelId)).rejects.toThrow();
  });
  it.each(firsts.flatMap(first => ['집속 마법진', '마나 중독', '치명적 공격'].map(second => [first, second])))
   ('keeps %s / %s unmarked and explicitly unresolved', (first, second) => {
      const r = buildFromArmory(raw(first!, second!)), skill = evoke(r.build.skills);
      expect(skill.evokeGauge).toBeUndefined(); expect(skill.gaugeBase).toBeUndefined();
      expect(r.build.params.gaugePerHit.normal).toBe(.04);
      expect(r.warnings.some(w => w.includes('변형 원점수') && w.includes('근삿값') && w.includes('실제 0이라는 뜻이 아니며'))).toBe(true);
    });
  it.each(['name', 'tier', 'slot', 'tooltip', 'parsed-value', 'duplicate', 'missing-list'])('does not mistake invalid %s for no choice', change => {
    const input = raw('빠른 준비'), skill = input.combatSkills.find(s => s.Name === '이보크')!;
    const selected = skill.Tripods!.find(x => x.IsSelected)!;
    if (change === 'name') selected.Name = '새로운 선택';
    if (change === 'tier') selected.Tier = 1;
    if (change === 'slot') selected.Slot = 2;
    if (change === 'tooltip') selected.Tooltip = '알 수 없는 설명';
    if (change === 'parsed-value') selected.Tooltip = selected.Tooltip!.replace('8.0', '7.0');
    if (change === 'duplicate') skill.Tripods!.push({ ...selected });
    if (change === 'missing-list') delete skill.Tripods;
    expect(evoke(buildFromArmory(input).build.skills).evokeGauge).toBeUndefined();
  });
  it('does not upgrade old/manual amounts merely because they match the candidate', () => {
    const c = control(); delete c.skill.evokeGauge; c.detonate();
    expect(c.state.deck.gauge).toBeCloseTo(.04);
    expect(cardSupplyWarnings(c.build).some(w => w.includes('동일 경로'))).toBe(false);
    delete c.skill.manualEvoke; c.skill.gaugeBase = .1196;
    expect(cardSupplyWarnings(c.build).some(w => w.includes('수동 기본량'))).toBe(true);
    expect(c.skill.evokeGauge).toBeUndefined();
  });
});

describe('one real manual explosion and no extra payments', () => {
  it.each([0, .320, .321, .322, 1.3, 1.320, 1.321, 1.322, 10.321])('respects placement/recast/end=%s', end => {
    const c = control(); c.cast(end);
    if (end >= 1.321) { c.state.advanceTo(1.321); c.cast(end); }
    c.state.advanceTo(end);
    expect(c.state.deck.gauge).toBeCloseTo(end >= 1.321 ? .1196 : 0);
    expect(c.checks).toEqual(end >= 1.321 ? [.2] : []);
  });
  it('does not pay on placement, early recast or unused expiry', () => {
    const c = control(); c.cast(); expect(c.cast).toThrow('cooldown'); expect(c.state.deck.gauge).toBe(0);
    c.state.advanceTo(10.321); expect(c.state.deck.gauge).toBe(0); expect(c.checks).toEqual([]);
    expect(c.state.isReady('evoke')).toBe(false);
  });
  it('keeps one payment per cycle and excludes damage buffs from gauge', () => {
    const c = control(); c.detonate(); expect(c.state.deck.gauge).toBeCloseTo(.1196);
    c.state.readyAt.delete('evoke'); const start = c.state.now; c.cast();
    c.state.applyBuff({ id: 'damage', duration: 5, mod: { bucket: 'skillDmg', value: 1, source: '통제' } });
    c.state.advanceTo(start + 1.321); c.cast(); c.state.advanceTo(8);
    expect(c.state.deck.gauge).toBeCloseTo(.2392); expect(c.breakdown.direct).toBe(300);
    expect(c.breakdown.casts).toBe(2); expect(c.checks).toEqual([.2, .2]);
  });
  it('keeps the wait relative to speed-scaled placement and applies gauge modifiers once', () => {
    const c = control(); c.skill.castTime /= 1.14;
    c.state.applyBuff({ id: 'speed', duration: 10, mod: { bucket: 'atkSpeed', value: .4, source: '통제' } });
    c.build.params.gaugeFactors = { specialization: .6, greed: .1 }; c.build.params.gaugeGainBonus = .7;
    c.build.params.normalGaugePenalty = -.5; c.build.chainDraw = { chance: 0, gaugeBonus: .2 }; c.skill.gaugeMultiplier = 1.4;
    c.cast(); const at = .321 / 1.14 / 1.4 + 1;
    c.state.advanceTo(at - .001); expect(c.cast).toThrow('cooldown'); expect(c.state.deck.gauge).toBe(0);
    c.state.advanceTo(at); c.cast(); expect(c.state.deck.gauge).toBeCloseTo(.1196 * 1.6 * .5 * 1.2 * 1.4);
  });
  it.each([0, 1, 2])('separates gauge and Quick Draw with %s occupied slots', occupied => {
    const c = control(true);
    for (const id of ['cull', 'judgment'].slice(0, occupied)) c.state.drawCards(1, id);
    c.state.deck.gauge = occupied === 2 ? 0 : .95; c.detonate();
    expect(c.checks).toEqual([.2]); expect(c.state.cardDraws.gauge).toBe(occupied === 2 ? 0 : 1);
    expect(c.state.cardDraws.quickDraw).toBe(occupied === 0 ? 1 : 0);
    expect(c.state.cardsUsed + c.state.deck.hand.length).toBe(c.state.cardsDrawn);
    expect(Object.values(c.state.cardDraws).reduce((a, b) => a + b, 0)).toBe(c.state.cardsDrawn);
  });
});

const invalid: [string, (s: SkillDef) => void][] = [
  ['unknown', s => Object.assign(s.evokeGauge!, { candidate: 'other' })], ['null', s => Object.assign(s, { evokeGauge: null })],
  ['array', s => Object.assign(s, { evokeGauge: [] })], ['extra', s => Object.assign(s.evokeGauge!, { bonus: 1 })],
  ['value', s => { s.evokeGauge!.perHit[0] = .04; }], ['nan', s => { s.evokeGauge!.perHit[0] = NaN; }],
  ['infinity', s => { s.evokeGauge!.perHit[0] = Infinity; }], ['hole', s => { delete s.evokeGauge!.perHit[0]; }],
  ['length', s => { s.evokeGauge!.perHit.push(.1196); }], ['profile', s => { delete s.manualEvoke; }],
  ['placement', s => { s.manualEvoke!.placementAt = .338; }], ['count', s => { s.manualEvoke!.hits.push({ after: .5, weight: .5 }); }],
  ['weight', s => { s.manualEvoke!.hits[0]!.weight = 2; }], ['time', s => { s.manualEvoke!.hits[0]!.after = .5; }],
  ['hit-hole', s => { delete s.manualEvoke!.hits[0]; }], ['wait', s => { s.manualEvoke!.minRecastDelay = 0; }],
  ['expiry', s => { s.manualEvoke!.lifetime = 1; }], ['recovery', s => { s.manualEvoke!.recastRecovery = 1; }],
  ['aggregate', s => { s.gaugeBase = .1196; }], ['split', s => Object.assign(s, { splitEvoke: {} })],
  ['poison', s => Object.assign(s, { manaPoison: {} })], ['delayed', s => Object.assign(s, { delayedHits: {} })],
  ['sequence', s => Object.assign(s, { hitSequence: {} })], ['charges', s => { s.maxCharges = 2; }],
  ['qd-count', s => { s.quickDraw!.attempts = 3; }], ['qd-chance', s => { s.quickDraw!.chance = .4; }],
  ['qd-trigger', s => { s.quickDraw!.trigger = 'first'; }], ['wrong-candidate', s => { s.evokeGauge!.candidate = 'evoke-overlap'; }],
];
it.each(invalid)('rejects manual %s before state changes', (_name, mutate) => {
  const c = control(); mutate(c.skill);
  expect(() => new SimState(c.build, createRng(1), cardsFor(c.build.variant))).toThrow(/이보크/);
  expect(c.cast).toThrow(/이보크/); expect(() => c.state.hit(c.skill, c.breakdown)).toThrow(/이보크/);
  expect([c.state.now, c.state.total, c.state.deck.gauge, c.breakdown.casts]).toEqual([0, 0, 0, 0]);
  expect(c.checks).toEqual([]); expect(c.state.readyAt.size).toBe(0);
});
