import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { damageWarnings } from '../skilldata';
import type { Modifier, SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const sources = load('tests/fixtures/audit/2026-10-14-forbidden-spell-sources.json').records as {
  effect: NonNullable<RawArmory['arkpassive']>['Effects'][number];
}[];
function input(level = 1, emperor = false): RawArmory {
  const path = 'tests/fixtures/armory/FixtureCharacter26/';
  return { profiles: load(path + 'profiles.json'), combatSkills: load(path + 'combat-skills.json'),
    arkpassive: { Effects: [structuredClone(sources[level - 1]!.effect), ...(emperor
      ? [{ Name: '깨달음', Description: '깨달음 1티어 황제의 칙령 Lv.3' }] : [])] },
    arkgrid: null, engravings: null, gems: null };
}
const nodeMods = (raw: RawArmory) => buildFromArmory(raw).build.passiveMods.filter(m => m.source.startsWith('금단의 주문'));
const build = buildFromArmory(input()).build;
const rain = build.skills.find(s => s.id === 'celestial_rain')!;
const devil = build.skills.find(s => s.id === 'the_devil')!;
const sun = buildFromArmory(input(1, true)).build.skills.find(s => s.id === 'the_sun')!;
const stack = build.skills.find(s => s.id === 'scratch_dealer')!;
const normal: SkillDef = { ...rain, id: 'normal', kind: 'normal', usesMana: true };
const evo = (mods: Modifier[], skill: SkillDef, component: 'direct' | 'stack' | 'dot' = 'direct') =>
  computeMultipliers({ atkBase: 1 }, mods, { skill, component, stacks: 4 }).evoDmg;

describe('Forbidden Spell official mana-specific evolution damage', () => {
  it.each([1, 2])('applies both level %s clauses to confirmed mana skills', level => {
    const mods = nodeMods(input(level));
    for (const skill of [normal, stack, rain, devil, sun]) expect(evo(mods, skill), skill.id).toBeCloseTo(1 + level * 0.1);
    for (const skill of [rain, devil]) expect(evo(mods, skill, 'stack'), skill.id).toBeCloseTo(1 + level * 0.1);
  });
  it.each([false, undefined])('keeps only global damage when mana use is %s', usesMana => {
    const mods = nodeMods(input());
    for (const kind of ['normal', 'awakening', 'identity_card'] as const)
      expect(evo(mods, { ...normal, usesMana, kind })).toBeCloseTo(1.05);
  });
  it('adds the mana term to the existing evolution bucket', () => {
    expect(evo([...nodeMods(input()), { bucket: 'evoDmg', value: 0.6, source: 'control' }], rain)).toBeCloseTo(1.7);
  });
  it('reads the supplied values instead of a level lookup', () => {
    const raw = input();
    raw.arkpassive!.Effects[0]!.ToolTip = JSON.stringify({ value:
      '진화형 피해가 4.5% 증가, 마나 스킬의 진화형 피해는 6.5% 더 증가하고, 마나 소모량이 7.0% 감소합니다.' });
    expect(evo(nodeMods(raw), rain)).toBeCloseTo(1.11);
    expect(evo(nodeMods(raw), { ...rain, usesMana: false })).toBeCloseTo(1.045);
  });
  it('leaves unverified mana-specific poison application unmodeled', () => {
    expect(evo(nodeMods(input()), normal, 'dot')).toBeCloseTo(1.05);
    expect(damageWarnings(build).some(w => w.includes('금단의 주문') && w.includes('중독') && w.includes('미확인'))).toBe(true);
  });
  it('reports the unmodeled mana cost after successful partial conversion', () => {
    for (const warnings of [buildFromArmory(input()).warnings, damageWarnings(build)])
      expect(warnings.some(w => w.includes('금단의 주문') && w.includes('마나 소모') && w.includes('미모델'))).toBe(true);
  });
  it.each(['condition', 'suffix', 'missing mana', 'wrong target', 'category', 'tier', 'level zero', 'level three'])('rejects unsupported %s without partial global conversion', kind => {
    const raw = input(), effect = raw.arkpassive!.Effects[0]!;
    if (kind === 'condition') effect.ToolTip = effect.ToolTip!.replace('진화형 피해가', '마나가 50% 이상일 때 진화형 피해가');
    if (kind === 'suffix') effect.ToolTip = effect.ToolTip!.replace('감소합니다.', '감소합니다. 카드 사용 후 3초 동안만 적용됩니다.');
    if (kind === 'missing mana') effect.ToolTip = JSON.stringify({ value: '진화형 피해가 5.0% 증가합니다.' });
    if (kind === 'wrong target') effect.ToolTip = effect.ToolTip!.replace('마나 스킬의', '각성 스킬의');
    if (kind === 'category') effect.Description = effect.Description.replace('진화', '도약');
    if (kind === 'tier') effect.Description = effect.Description.replace('2티어', '3티어');
    if (kind === 'level zero') effect.Description = effect.Description.replace('Lv.1', 'Lv.0');
    if (kind === 'level three') effect.Description = effect.Description.replace('Lv.1', 'Lv.3');
    const result = buildFromArmory(raw);
    expect(nodeMods(raw)).toEqual([]);
    expect(result.warnings.some(w => w.includes('금단의 주문') && w.includes('아크패시브 해석 못함'))).toBe(true);
  });
});
