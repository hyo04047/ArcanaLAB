import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { damageWarnings } from '../skilldata';
import { strip, tooltipLines } from '../tooltip';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
type Effect = NonNullable<RawArmory['arkpassive']>['Effects'][number];
const sources = load('tests/fixtures/audit/2026-10-14-conditional-evolution-sources.json').records as { effects: Effect[] }[];
const nodes = sources.flatMap(r => r.effects).filter(e => strip(e.Description) === '진화 5티어 입식 타격가 Lv.2');
const text = tooltipLines(nodes[0]!.ToolTip).find(t => t.startsWith('진화형 피해가'))!.replace(/\|\|/g, ' ').trim();
function input(description = '진화 5티어 입식 타격가 Lv.2', value = text): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [],
    arkpassive: { Effects: [{ Name: '진화', Description: description, ToolTip: JSON.stringify({ value }) }] },
    arkgrid: null, engravings: null, gems: null };
}
const mods = (raw = input()) => buildFromArmory(raw).build.passiveMods.filter(m => m.source.startsWith('입식 타격가'));
const skill: SkillDef = { id: 'control', name: 'control', kind: 'normal', cooldown: 1, castTime: 1, directCoef: 1, hits: 1 };

describe('Standing Striker official full-stack no-knockdown model', () => {
  it('reads the same current level-two value from all three official responses', () => {
    expect(nodes).toHaveLength(3);
    for (const node of nodes) {
      const raw = input(); raw.arkpassive!.Effects = [node];
      expect(mods(raw)).toHaveLength(1);
      expect(mods(raw)[0]!.value).toBeCloseTo(0.12 + 6 * 0.015);
    }
  });
  it.each(['normal', 'stack', 'ruin', 'hyper_awakening', 'awakening', 'identity_card'] as const)('adds evolution damage for %s without changing other buckets', kind => {
    for (const component of ['direct', 'stack', 'dot'] as const) {
      const result = computeMultipliers({ atkBase: 1 }, [...mods(), { bucket: 'evoDmg', value: 0.5, source: 'control' }],
        { skill: { ...skill, kind }, stacks: 4, component });
      expect(result.evoDmg).toBeCloseTo(1.71);
      expect(result.critRate).toBe(0); expect(result.critDmg).toBe(2); expect(result.skillDmg).toBe(1);
    }
  });
  it('reads synthetic level-one and changed stack numbers without assuming six', () => {
    const value = text.replaceAll('타격 II', '타격 I').replace('12.0%', '6.0%').replace('+1.5%', '+0.75%').replace('6중첩', '4중첩');
    expect(mods(input('진화 5티어 입식 타격가 Lv.1', value))[0]!.value).toBeCloseTo(0.09);
  });
  it('reports full-stack and unmodeled incoming attacks in both import and result warnings', () => {
    const result = buildFromArmory(input());
    for (const warnings of [result.warnings, damageWarnings(result.build)])
      expect(warnings.some(w => w.includes('입식 타격가') && w.includes('최대 중첩') && w.includes('피격') && w.includes('미모델'))).toBe(true);
  });
  it.each(['activation', 'suffix', 'label', 'missing stacks', 'category', 'tier', 'level zero', 'level three'])('rejects unsupported %s instead of applying a partial value', change => {
    const raw = input(), node = raw.arkpassive!.Effects[0]!;
    if (change === 'activation') node.ToolTip = node.ToolTip!.replace('전투 시작 후', '카드를 사용한 후');
    if (change === 'suffix') node.ToolTip = JSON.stringify({ value: text + ' 마나가 50% 이상일 때만 적용합니다.' });
    if (change === 'label') node.ToolTip = node.ToolTip!.replace('입식 타격 II :', '입식 타격 I :');
    if (change === 'missing stacks') node.ToolTip = JSON.stringify({ value: '진화형 피해가 12.0% 증가합니다.' });
    if (change === 'category') node.Description = node.Description.replace('진화', '도약');
    if (change === 'tier') node.Description = node.Description.replace('5티어', '4티어');
    if (change === 'level zero') node.Description = node.Description.replace('Lv.2', 'Lv.0');
    if (change === 'level three') node.Description = node.Description.replace('Lv.2', 'Lv.3');
    expect(mods(raw)).toEqual([]);
    expect(buildFromArmory(raw).warnings.some(w => w.includes('입식 타격가') && w.includes('해석 못함'))).toBe(true);
  });
});
