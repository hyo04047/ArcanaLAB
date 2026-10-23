import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { damageWarnings, SKILL_BY_NAME } from '../skilldata';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
type Engraving = NonNullable<NonNullable<RawArmory['engravings']>['ArkPassiveEffects']>[number];
const nodes = load('tests/fixtures/audit/2026-10-14-hit-master-sources.json').records.flatMap((r: { effects: Engraving[] }) => r.effects) as Engraving[];
function input(node = nodes[0]!): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: load('tests/fixtures/armory/FixtureCharacter26/combat-skills.json'),
    arkpassive: null, arkgrid: null, engravings: { ArkPassiveEffects: [structuredClone(node)] }, gems: null };
}
const mods = (raw = input()) => buildFromArmory(raw).build.passiveMods.filter(m => m.source.startsWith('타격의 대가('));
const skill: SkillDef = { id: 'control', name: 'control', kind: 'normal', cooldown: 1, castTime: 1, directCoef: 1, hits: 1 };
const mult = (s: SkillDef, component: 'direct' | 'stack' | 'dot' = 'direct', raw = input()) =>
  computeMultipliers({ atkBase: 1 }, mods(raw), { skill: s, stacks: 4, component }).skillDmg;

describe('Hit Master non-directional attack scope', () => {
  it.each(['포 카드', '세렌디피티', '시크릿 가든'])('excludes %s direct hits but keeps its ruin explosion', name => {
    const s = { ...skill, id: SKILL_BY_NAME.get(name)!.id, kind: 'ruin' as const };
    expect(mult(s)).toBe(1); expect(mult(s, 'stack')).toBeCloseTo(1.2075); expect(mult(s, 'dot')).toBe(1);
  });
  it.each(['스크래치 딜러', '스파이럴 엣지', '쿼드라 엑셀레이트'])('excludes %s directional stack-skill damage', name => {
    expect(mult({ ...skill, id: SKILL_BY_NAME.get(name)!.id, kind: 'stack' })).toBe(1);
  });
  it.each(['셀레스티얼 레인', '더 데빌'])('keeps both components of non-directional %s', name => {
    const s: SkillDef = { ...skill, id: SKILL_BY_NAME.get(name)!.id, kind: name === '더 데빌' ? 'hyper_awakening' : 'ruin', tags: ['ruin'] };
    expect(mult(s)).toBeCloseTo(1.2075); expect(mult(s, 'stack')).toBeCloseTo(1.2075);
  });
  it.each(['더 썬', '이보크', '스트림 오브 엣지'])('keeps non-directional %s direct damage', name => {
    expect(mult({ ...skill, id: SKILL_BY_NAME.get(name)!.id, kind: name === '더 썬' ? 'hyper_awakening' : 'normal' })).toBeCloseTo(1.2075);
  });
  it.each(['card_emperor', 'card_empress_knight'])('preserves existing %s damage without admitting arbitrary unknown cards', id => {
    expect(mult({ ...skill, id, kind: 'identity_card' })).toBeCloseTo(1.2075);
    expect(mult({ ...skill, id: 'card_unknown', kind: 'identity_card' })).toBe(1);
  });
  it('excludes awakening even if a known non-directional skill ID is reused', () => {
    const s: SkillDef = { ...skill, id: 'celestial_rain', kind: 'awakening', tags: ['ruin'] };
    expect(mult(s)).toBe(1); expect(mult(s, 'stack')).toBe(1);
  });
  it('uses each official combined stone value once', () => {
    expect(nodes).toHaveLength(2);
    expect(mult({ ...skill, id: 'celestial_rain' }, 'direct', input(nodes[0]!))).toBeCloseTo(1.2075);
    expect(mult({ ...skill, id: 'celestial_rain' }, 'direct', input(nodes[1]!))).toBeCloseTo(1.2225);
  });
  it.each(['empty', 'unknown category', 'unknown attack type'])('does not infer a non-directional attack from %s data', change => {
    const raw = input(), rain = raw.combatSkills.find(s => s.Name === '셀레스티얼 레인')!;
    rain.Tooltip = change === 'empty' ? '' : JSON.stringify({ category: change === 'unknown category' ? '[미확인 스킬]' : '[루인 스킬]',
      attack: change === 'unknown attack type' ? '공격 타입 : 미확인' : '' });
    expect(mult({ ...skill, id: 'celestial_rain', kind: 'ruin' }, 'direct', raw)).toBe(1);
  });
  it.each(['missing scope', 'missing awakening exclusion', 'conditional suffix'])('rejects %s rather than accepting a percentage substring', change => {
    const raw = input(), e = raw.engravings!.ArkPassiveEffects![0]!;
    if (change === 'missing scope') e.Description = e.Description.replace('공격 타입이 백 어택 및 헤드 어택에 해당되지 않는 공격의 ', '');
    if (change === 'missing awakening exclusion') e.Description = e.Description.replace(' 각성기는 해당 효과가 적용되지 않는다.', '');
    if (change === 'conditional suffix') e.Description += ' 마나가 50% 이상일 때만 적용한다.';
    expect(mods(raw)).toEqual([]);
    expect(buildFromArmory(raw).warnings.some(w => w.includes('타격의 대가') && w.includes('해석 못함'))).toBe(true);
  });
  it('retains explicit DoT and historical ruin scope warnings', () => {
    const result = buildFromArmory(input());
    for (const warnings of [result.warnings, damageWarnings(result.build)])
      expect(warnings.some(w => w.includes('타격의 대가') && w.includes('도트') && w.includes('미확인') && w.includes('루인 폭발'))).toBe(true);
  });
  it('warns on old global stored inputs without rewriting them', () => {
    const build = buildFromArmory(input()).build;
    build.passiveMods = [{ bucket: 'skillDmg', value: 0.2075, source: '타격의 대가(유물4)' }];
    expect(damageWarnings(build).some(w => w.includes('타격의 대가') && w.includes('재검색'))).toBe(true);
    expect(build.passiveMods[0]!.filter).toBeUndefined();
  });
});
