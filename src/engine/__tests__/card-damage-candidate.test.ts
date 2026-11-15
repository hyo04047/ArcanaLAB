import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBuildInput } from '../../compare';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { captureSettingBaseline, rebuildSettings } from '../settings';
import { SimState } from '../sim';
import type { Build } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function input(level: number | undefined = 70, knight = true): RawArmory {
  const effects = load('tests/fixtures/audit/2026-10-30-card-damage-adoption/official-emperor.json').effects;
  const profiles = load('tests/fixtures/armory/FixtureCharacter26/profiles.json');
  profiles.CharacterLevel = level;
  return { profiles, combatSkills: [], arkpassive: { Effects: effects.filter((e: { Description: string }) => knight || !e.Description.includes('황후의 기사')) },
    arkgrid: null, engravings: null, gems: null };
}
const coefficients = { emperor: 72.395, empress_knight: 120.65 };
const flats = { emperor: 7791, empress_knight: 12984.5 };
function state(build: Build, proc = false) {
  build.passiveMods = []; build.bluntThorn = undefined; build.skills = []; build.onCardUse = []; build.onDestiny = [];
  build.anotherEmperorChance = proc ? 1 : undefined;
  return new SimState(build, createRng(1), cardsFor(build.variant, build.deckOverrides));
}

describe('public card damage candidate in new Lv70 inputs', () => {
  it('connects both damage terms and reports the unverified candidate in input and result warnings', () => {
    const result = buildFromArmory(input());
    expect(result.build.params.cardDamageCoef).toEqual(coefficients);
    expect(result.build.params.cardDamageFlat).toEqual(flats);
    for (const warnings of [result.warnings, cardSupplyWarnings(result.build)]) {
      expect(warnings.some(w => w.includes('공개 계수 후보') && w.includes('실측 미검증'))).toBe(true);
      expect(warnings.some(w => w.includes('자동 입력이 0') || w.includes('자동 입력 0'))).toBe(false);
    }
  });
  it.each([69, 71, null])('keeps unsupported or unknown combat level %s without invented scaling', level => {
    const raw = input(); raw.profiles.CharacterLevel = level === null ? undefined : level;
    const { build } = buildFromArmory(raw);
    expect(build.params.cardDamageCoef).toEqual({}); expect(build.params.cardDamageFlat).toBeUndefined();
    expect(cardSupplyWarnings(build).some(w => w.includes('자동 입력이 0'))).toBe(true);
  });
  it('does not populate or use a card absent from the deck', () => {
    const build = buildFromArmory(input(70, false)).build;
    expect(build.params.cardDamageCoef).toEqual({ emperor: 72.395 });
    expect(build.params.cardDamageFlat).toEqual({ emperor: 7791 });
    const sim = state(build); sim.drawCards(1, 'empress_knight'); sim.useCardNow('empress_knight');
    expect(sim.total).toBe(0);
  });
  it.each(['emperor', 'empress_knight'] as const)('uses the published fixed and attack terms once for %s', card => {
    for (const attack of [0, 100, 1000]) {
      const build = buildFromArmory(input()).build; build.params.atkBase = attack;
      const sim = state(build);
      sim.build.passiveMods.push({ bucket: 'atkFlat', value: 20, source: 'control' }, { bucket: 'atk', value: 0.5, source: 'control' });
      sim.drawCards(1, card); sim.useCardNow(card);
      expect(sim.total).toBeCloseTo(flats[card] + coefficients[card] * (attack + 20) * 1.5, 7);
    }
  });
  it('uses the same Emperor base for direct use and Another Emperor while keeping separate counts', () => {
    const build = buildFromArmory(input()).build; build.params.atkBase = 100;
    const sim = state(build, true);
    sim.drawCards(1, 'emperor'); sim.useCardNow('emperor');
    sim.drawCards(1, 'star'); sim.useCardNow('star');
    for (const id of ['card_emperor', 'card_emperor_proc']) expect(sim.breakdown.get(id)).toMatchObject({ casts: 1, direct: 15030.5 });
  });
  it('regenerates candidate values through setting changes without accumulating or changing the baseline', async () => {
    const raw = input(), before = structuredClone(raw), baseline = await captureSettingBaseline(raw);
    const selection = { baselineFingerprint: baseline.fingerprint, enlightenment: [{ nodeId: 'empress_knight', level: 5 }] };
    const first = await rebuildSettings(baseline, selection);
    expect(first.build.params.cardDamageCoef).toEqual(coefficients);
    expect(first.build.params.cardDamageFlat).toEqual(flats);
    expect(await rebuildSettings(baseline, selection)).toEqual(first);
    expect(baseline.raw).toEqual(before);
  });
  it.each(['empty', 'manual'] as const)('reads old %s values without filling or replacing them', kind => {
    const build = buildFromArmory(input()).build;
    build.params.cardDamageCoef = kind === 'empty' ? {} : { emperor: 2 };
    delete build.params.cardDamageFlat;
    if (kind === 'manual') build.params.cardDamageFlat = { emperor: 30 };
    const parsed = parseBuildInput(JSON.stringify(build), 'old').build;
    expect(parsed).toEqual(JSON.parse(JSON.stringify(build)));
    parsed.params.atkBase = 100; const sim = state(parsed);
    sim.drawCards(1, 'emperor'); sim.useCardNow('emperor');
    expect(sim.total).toBe(kind === 'empty' ? 0 : 230);
    expect(cardSupplyWarnings(parsed).some(w => w.includes('공개 계수 후보를 사용'))).toBe(false);
  });
});
