import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { damageWarnings } from '../skilldata';
import { SKILL_BY_NAME } from '../skilldata';
import { strip, tooltipLines } from '../tooltip';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
type Effect = NonNullable<RawArmory['arkpassive']>['Effects'][number];
const nodes = load('tests/fixtures/audit/2026-10-14-conditional-evolution-sources.json').records.flatMap((r: { effects: Effect[] }) => r.effects) as Effect[];
const node = nodes.find(e => strip(e.Description) === '진화 3티어 일격 Lv.2')!;
const text = tooltipLines(node.ToolTip).find(l => l.startsWith('치명타 적중률이'))!.replace(/\|\|/g, ' ').trim();
function input(): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: load('tests/fixtures/armory/FixtureCharacter26/combat-skills.json'),
    arkpassive: { Effects: [structuredClone(node)] }, arkgrid: null, engravings: null, gems: null };
}
const mods = (raw = input()) => buildFromArmory(raw).build.passiveMods.filter(m => m.source.startsWith('일격 Lv'));
const skill: SkillDef = { id: 'control', name: 'control', kind: 'normal', cooldown: 1, castTime: 1, directCoef: 1, hits: 1 };

describe('Strike directional direct-damage scope', () => {
  it.each(['스크래치 딜러', '스파이럴 엣지', '포 카드', '세렌디피티', '시크릿 가든'])('keeps %s direct critical damage and excludes its explosion and DoT', name => {
    for (const component of ['direct', 'stack', 'dot'] as const) {
      const result = computeMultipliers({ atkBase: 1 }, mods(), { skill: { ...skill, id: SKILL_BY_NAME.get(name)!.id }, stacks: 4, component });
      expect(result.critRate).toBeCloseTo(0.2);
      expect(result.critDmg).toBeCloseTo(component === 'direct' ? 2.32 : 2);
    }
  });
  it.each(['셀레스티얼 레인', '운명의 부름', '스트림 오브 엣지', '더 데빌', '더 썬'])('does not give directional critical damage to %s', name => {
    for (const component of ['direct', 'stack', 'dot'] as const) {
      const result = computeMultipliers({ atkBase: 1 }, mods(), { skill: { ...skill, id: SKILL_BY_NAME.get(name)!.id }, stacks: 4, component });
      expect(result.critDmg).toBe(2); expect(result.critRate).toBeCloseTo(0.2);
    }
  });
  it('does not turn an empty directional selection into a global bonus', () => {
    const raw = input(); raw.combatSkills = [];
    for (const kind of ['normal', 'identity_card', 'awakening'] as const)
      expect(computeMultipliers({ atkBase: 1 }, mods(raw), { skill: { ...skill, kind }, stacks: 0, component: 'direct' }).critDmg).toBe(2);
    expect(mods(raw).find(m => m.bucket === 'critDmg')!.filter).toEqual({ ids: [], component: 'direct' });
  });
  it('does not infer direction from an unselected tripod or unknown skill', () => {
    const raw = input(), call = raw.combatSkills.find(s => s.Name === '운명의 부름')!;
    call.Tripods = [{ Name: 'control', Tier: 1, Slot: 1, IsSelected: false, Tooltip: '공격 타입 : 백 어택' }];
    raw.combatSkills = [call, { ...call, Name: 'unknown', Tooltip: '공격 타입 : 헤드 어택' }];
    expect(mods(raw).find(m => m.bucket === 'critDmg')!.filter!.ids).toEqual([]);
  });
  it('reads synthetic level-one values without hardcoding level two', () => {
    const raw = input(); raw.arkpassive!.Effects = [{ Name: '진화', Description: '진화 3티어 일격 Lv.1',
      ToolTip: JSON.stringify({ value: text.replace('20.0%', '10.0%').replace('32.0%', '16.0%') }) }];
    expect(mods(raw).map(m => m.value)).toEqual([0.1, 0.16]);
  });
  it.each(['condition', 'missing scope', 'category', 'tier', 'level zero', 'level three'])('rejects unsupported %s instead of retaining a partial global match', change => {
    const raw = input(), effect = raw.arkpassive!.Effects[0]!;
    if (change === 'condition') effect.ToolTip = JSON.stringify({ value: text + ' 마나가 50% 이상일 때만 적용합니다.' });
    if (change === 'missing scope') effect.ToolTip = JSON.stringify({ value: text.replace('방향성 공격 스킬의 ', '') });
    if (change === 'category') effect.Description = strip(effect.Description).replace('진화', '도약');
    if (change === 'tier') effect.Description = strip(effect.Description).replace('3티어', '4티어');
    if (change === 'level zero') effect.Description = strip(effect.Description).replace('Lv.2', 'Lv.0');
    if (change === 'level three') effect.Description = strip(effect.Description).replace('Lv.2', 'Lv.3');
    expect(mods(raw)).toEqual([]);
    expect(buildFromArmory(raw).warnings.some(w => w.includes('일격') && w.includes('해석 못함'))).toBe(true);
  });
  it('preserves the scope limitation in import and result warnings', () => {
    const result = buildFromArmory(input());
    for (const warnings of [result.warnings, damageWarnings(result.build)])
      expect(warnings.some(w => w.includes('일격') && w.includes('루인 폭발') && w.includes('후보') && w.includes('미검증'))).toBe(true);
  });
  it('warns about old stored global modifiers without silently rewriting them', () => {
    const build = buildFromArmory(input()).build;
    build.passiveMods = [{ bucket: 'critDmg', value: 0.32, source: '일격 Lv2' }];
    expect(damageWarnings(build).some(w => w.includes('일격') && w.includes('재검색'))).toBe(true);
    expect(build.passiveMods[0]!.filter).toBeUndefined();
  });
});
