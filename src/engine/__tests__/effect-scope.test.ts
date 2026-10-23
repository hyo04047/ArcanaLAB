import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers, filterMatches } from '../damage';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier, SkillDef } from '../types';

const dir = resolve(__dirname, '../../../tests/fixtures/armory/FixtureCharacter26');
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'), arkpassive: load('arkpassive'), arkgrid: load('arkgrid'), engravings: load('engravings'), gems: load('gems') };
const imported = buildFromArmory(raw).build;
const emperorRaw = structuredClone(raw);
emperorRaw.arkpassive = { Effects: [{ Name: '깨달음', Description: '깨달음 1티어 황제의 칙령 Lv.3' }] };
const sun = buildFromArmory(emperorRaw).build.skills.find(s => s.id === 'the_sun')!;
const devil = imported.skills.find(s => s.id === 'the_devil')!;
const rain = imported.skills.find(s => s.id === 'celestial_rain')!;
const stack = imported.skills.find(s => s.id === 'scratch_dealer')!;
const normal: SkillDef = { ...rain, id: 'normal', kind: 'normal', usesMana: true };
const awakening: SkillDef = { ...rain, id: 'awakening', kind: 'awakening', usesMana: false };
const card: SkillDef = { ...normal, id: 'card_emperor', kind: 'identity_card', usesMana: false };
const targets = [devil, sun, rain, normal, stack, awakening, card];
const mult = (mods: Modifier[], skill: SkillDef, component: 'direct' | 'stack' = 'direct', stacks = 4) =>
  computeMultipliers({ atkBase: 1 }, mods, { skill, component, stacks });
const state = (mods: Modifier[], skills = targets) => new SimState({ ...imported, passiveMods: mods, skills }, createRng(1), cardsFor('empress'));
function node(name: string, text: string): RawArmory {
  return { ...raw, arkpassive: { Effects: [{ Name: '도약', Description: `도약 1티어 ${name} Lv.5`, ToolTip: JSON.stringify({ value: text }) }] } };
}

describe('T skill target scope', () => {
  it('retains both the T slot and the class category from the official skill response', () => {
    expect(devil.kind).toBe('hyper_awakening');
    expect(devil.tags).toContain('ruin');
    expect(sun.kind).toBe('hyper_awakening');
    expect(sun.tags).toContain('normal');
    expect(devil.usesMana).toBe(true);
    expect(sun.usesMana).toBe(true);
  });

  it.each([
    ['황후의 탐욕', 1.009], ['황후의 연회', 1.26], ['황후의 속삭임', 1.2], ['인피니티 덱 10P', 1.016],
  ])('applies %s to Devil and ordinary ruins in both build paths', (source, expected) => {
    for (const b of [imported, empressInkomsu440()]) {
      const mods = b.passiveMods.filter(m => m.source.startsWith(source) && m.bucket === 'skillDmg');
      expect(mods).toHaveLength(1);
      expect(mult(mods, b.skills.find(s => s.id === 'the_devil')!).skillDmg).toBeCloseTo(expected);
      expect(mult(mods, rain).skillDmg).toBeCloseTo(expected);
      expect(mult(mods, sun).skillDmg).toBe(1);
    }
  });

  it('preserves IDs, four-stack and damage-component conditions for a T ruin', () => {
    const mod: Modifier = { bucket: 'skillDmg', value: 0.2, source: 'test', filter: { kinds: ['ruin'], ids: ['the_devil'], minStacks: 4, component: 'stack' } };
    expect(mult([mod], devil, 'stack').skillDmg).toBeCloseTo(1.2);
    expect(mult([mod], devil, 'direct').skillDmg).toBe(1);
    expect(mult([mod], devil, 'stack', 3).skillDmg).toBe(1);
    expect(mult([mod], rain, 'stack').skillDmg).toBe(1);
  });

  it('applies an OR category filter once, with an explicit T exclusion taking precedence', () => {
    const mod: Modifier = { bucket: 'skillDmg', value: 0.2, source: 'test', filter: { kinds: ['ruin', 'hyper_awakening'] } };
    expect(mult([mod], devil).skillDmg).toBeCloseTo(1.2);
    expect(mult([{ ...mod, filter: { ...mod.filter, excludeKinds: ['hyper_awakening'] } }], devil).skillDmg).toBe(1);
  });

  it('makes cooldown and damage agree on the same category and exclusion', () => {
    const mod: Modifier = { bucket: 'cooldown', value: 0.2, source: 'test', filter: { kinds: ['ruin'] } };
    const s = state([mod]);
    expect(s.cooldownMultiplier(devil)).toBeCloseTo(0.8);
    expect(s.cooldownMultiplier(sun)).toBe(1);
    mod.filter!.excludeKinds = ['hyper_awakening'];
    expect(s.cooldownMultiplier(devil)).toBe(1);
    expect(s.cooldownMultiplier(rain)).toBeCloseTo(0.8);
  });

  it('does not invent a class category or mana use when a T tooltip is absent', () => {
    const input = structuredClone(raw);
    input.combatSkills.find(s => s.Name === '더 데빌')!.Tooltip = '';
    const result = buildFromArmory(input);
    const unknown = result.build.skills.find(s => s.id === 'the_devil')!;
    expect(filterMatches({ kinds: ['ruin'] }, { skill: unknown, stacks: 4, component: 'direct' })).toBe(false);
    expect(filterMatches({ usesMana: true }, { skill: unknown, stacks: 4, component: 'direct' })).toBe(false);
    expect(result.warnings.some(w => w.includes('더 데빌') && w.includes('분류'))).toBe(true);
    expect(result.warnings.some(w => w.includes('더 데빌') && w.includes('마나'))).toBe(true);
  });
});

describe('effect-specific conversion', () => {
  it.each(['초각성기 피해량이 50.0% 증가한다.', '초각성기 피해가 50.0% 증가한다.'])('does not turn an ultimate-only node into T damage: %s', text => {
    const result = buildFromArmory(node('초월적인 힘', text));
    expect(result.build.passiveMods.filter(m => m.source.startsWith('초월적인 힘'))).toEqual([]);
    expect(result.warnings.some(w => w.includes('초월적인 힘') && w.includes('초각성기') && w.includes('미모델'))).toBe(true);
  });

  it('keeps damage and cooldown leap nodes exclusive to the T slot', () => {
    const mods = imported.passiveMods.filter(m => /^(풀려난 힘|잠재력 해방)/.test(m.source));
    const s = state(mods);
    for (const target of targets) {
      const t = target.kind === 'hyper_awakening';
      expect(mult(mods, target).dmgToEnemy).toBeCloseTo(t ? 1.15 : 1);
      expect(s.cooldownMultiplier(target)).toBeCloseTo(t ? 0.94 : 1);
    }
  });

  it.each(['끝없는 마나', '무한한 마력'])('limits %s cooldown to known mana skills in both build paths', source => {
    for (const b of [imported, empressInkomsu440()]) {
      const mods = b.passiveMods.filter(m => m.source.startsWith(source));
      const s = state(mods);
      for (const target of targets) expect(s.cooldownMultiplier(target)).toBeCloseTo(target.usesMana ? 0.86 : 1);
      expect(s.cooldownMultiplier(b.skills.find(s => s.id === 'the_devil')!)).toBeCloseTo(0.86);
    }
  });

  it('keeps the awakening exclusion on optimized training while allowing both T skills', () => {
    for (const b of [imported, empressInkomsu440()]) {
      const s = state(b.passiveMods.filter(m => m.source.startsWith('최적화 훈련')));
      expect(s.cooldownMultiplier(awakening)).toBe(1);
      expect(s.cooldownMultiplier(devil)).toBeCloseTo(0.96);
      expect(s.cooldownMultiplier(sun)).toBeCloseTo(0.96);
    }
  });

  it('uses the normal category for Sun damage and class cooldown effects', () => {
    const input = node('황제의 만찬', '일반 스킬 사용 시 마나를 2.1% 회복하며, 일반 스킬의 피해량이 47.0% 증가한다.');
    input.arkpassive!.Effects[0]!.Description = '깨달음 3티어 황제의 만찬 Lv.3';
    const b = buildFromArmory(input).build;
    const mods = b.passiveMods.filter(m => m.source.startsWith('황제의 만찬'));
    expect(mult(mods, sun).skillDmg).toBeCloseTo(1.47);
    expect(mult(mods, devil).skillDmg).toBe(1);
    const s = state(imported.passiveMods.filter(m => m.source.startsWith('황후의 속삭임')));
    expect(s.cooldownMultiplier(sun)).toBeCloseTo(0.94);
    expect(s.cooldownMultiplier(devil)).toBe(1);
  });

  it.each([
    ['초각성 스킬을 제외한 루인 스킬의 피해량이 2.8% 증가한다.', [1, 1, 1.028, 1, 1, 1, 1]],
    ['초각성 스킬을 제외한 일반 스킬의 피해량이 2.8% 증가한다.', [1, 1, 1, 1.028, 1, 1, 1]],
    ['마나를 사용하는 스킬의 피해량이 4.5% 증가한다.', [1.045, 1.045, 1.045, 1.045, 1.045, 1, 1]],
  ] as const)('preserves core targeting: %s', (text, expected) => {
    const result = buildFromArmory({ ...raw, arkgrid: { Slots: [{ Index: 0, Name: '적용 범위 테스트', Point: 10, Tooltip: JSON.stringify({ value: `[10P] ${text}` }) }] } });
    const mods = result.build.passiveMods.filter(m => m.source.startsWith('적용 범위 테스트'));
    expect(mods).toHaveLength(1);
    targets.forEach((target, i) => expect(mult(mods, target).skillDmg, target.id).toBeCloseTo(expected[i]!));
    expect(result.warnings.some(w => w.includes('적용 범위 테스트'))).toBe(false);
  });

  it('does not discard a new condition in front of a recognized core target', () => {
    const text = '카드 사용 시 5초 동안 초각성 스킬을 제외한 루인 스킬의 피해량이 2.8% 증가한다.';
    const result = buildFromArmory({ ...raw, arkgrid: { Slots: [{ Index: 0, Name: '조건 테스트', Point: 10, Tooltip: JSON.stringify({ value: `[10P] ${text}` }) }] } });
    expect(result.build.passiveMods.some(m => m.source.startsWith('조건 테스트'))).toBe(false);
    expect(result.warnings.some(w => w.includes(text))).toBe(true);
  });

  it('reports unmodeled mana and candidate T cast-speed after partial support', () => {
    expect(buildFromArmory(raw).warnings.some(w => w.includes('즉각적인 주문') && w.includes('마나') && w.includes('미모델') && w.includes('후보'))).toBe(true);
  });
});

describe('timed effects on T skills', () => {
  it('applies chancellor and sovereign only to the normal Sun, then expires them', () => {
    const s = state([]);
    // 카드 실행 경로까지 검사하기 위해 황제 덱으로 생성합니다.
    const emperor = new SimState({ ...s.build, variant: 'emperor' }, createRng(1), cardsFor('emperor', { add: ['sovereign'] }));
    emperor.drawCards(1, 'chancellor'); emperor.useCardNow('chancellor');
    emperor.drawCards(1, 'sovereign'); emperor.useCardNow('sovereign');
    expect(mult(emperor.activeMods(), sun).critRate).toBeCloseTo(0.2);
    expect(mult(emperor.activeMods(), sun).skillDmg).toBeCloseTo(1.5);
    expect(mult(emperor.activeMods(), devil).critRate).toBe(0);
    expect(mult(emperor.activeMods(), devil).skillDmg).toBe(1);
    emperor.now = 4;
    expect(mult(emperor.activeMods(), sun).skillDmg).toBe(1);
    emperor.now = 10;
    expect(mult(emperor.activeMods(), sun).critRate).toBeCloseTo(0.2);
    emperor.now = 12;
    expect(mult(emperor.activeMods(), sun).critRate).toBe(0);
  });

  it('applies the timed edge combo to Devil in both build paths without making it permanent', () => {
    for (const b of [imported, empressInkomsu440()]) {
      const s = state([]);
      const effect = b.skills.find(s => s.id === 'stream_of_edge')!.onCast!.find(e => e.id === 'edge_combo')!;
      s.applyBuff(effect);
      expect(mult(s.activeMods(), devil).skillDmg).toBeCloseTo(1.06);
      expect(mult(s.activeMods(), sun).skillDmg).toBe(1);
      s.now = 8;
      expect(mult(s.activeMods(), devil).skillDmg).toBe(1);
    }
  });
});
