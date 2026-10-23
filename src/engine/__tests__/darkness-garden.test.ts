import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { character: string; responses: { endpoint: string; body: string }[] }[];
function convert(index = 1, description?: string) {
  const raw = Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === '시크릿 가든')!;
  const t = skill.Tripods!.find(t => t.Name === '다크니스 가든')!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = [{ ...t, IsSelected: true, Tooltip: description ?? t.Tooltip }];
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
describe('Darkness Garden direct and stack crit damage', () => {
  it.each([0, 1])('reads official source %s without treating attribute conversion as modeled', index => {
    const result = convert(index), skill = result.build.skills[0]!;
    expect(skill.mods!.filter(m => m.source === '다크니스 가든')).toEqual([
      { bucket: 'critDmg', value: 1.9, filter: { ids: ['secret_garden'], component: 'direct' }, source: '다크니스 가든' },
      { bucket: 'critDmg', value: 1.9, filter: { ids: ['secret_garden'], component: 'stack' }, source: '다크니스 가든' },
    ]);
    expect(result.warnings.some(w => w.includes('다크니스 가든') && w.includes('암속성') && w.includes('미모델'))).toBe(true);
  });
  it.each([['direct', 3.9], ['stack', 3.9], ['dot', 2]] as const)('limits %s crit damage to %s', (component, expected) => {
    const skill = convert().build.skills[0]!;
    const multipliers = computeMultipliers({ atkBase: 100 }, skill.mods!, { skill, component, stacks: 4 });
    expect(multipliers.critDmg).toBe(expected);
    expect(multipliers.nonCrit).toBe(1);
  });
  it('does not give the crit bonus to a different skill', () => {
    const skill = convert().build.skills[0]!;
    expect(computeMultipliers({ atkBase: 100 }, skill.mods!, { skill: { ...skill, id: 'other' }, component: 'stack', stacks: 4 }).critDmg).toBe(2);
  });
  it.each([
    '',
    '[암] 속성으로 변경되고, 적에게 주는 스킬 및 스택트 효과의 치명타 피해가 190.0% 증가한다. 마나가 50% 이상일 때만 적용된다.',
    '[암] 속성으로 변경되고, 아군의 치명타 피해가 190.0% 증가한다.',
    '[암] 속성으로 변경되고, 적에게 주는 스킬 및 스택트 효과의 치명타 피해가 1.2.3% 증가한다.',
    '[암] 속성으로 변경되고, 적에게 주는 스킬 및 스택트 효과의 치명타 피해가 ' + '9'.repeat(400) + '% 증가한다.',
    '[암] 속성으로 변경되고, 적에게 주는 스킬 및 스택트 효과의 치명타 피해가 -10% 증가한다.',
  ])('rejects incomplete or changed text: %s', description => {
    const result = convert(1, description);
    expect(result.build.skills[0]!.mods!.some(m => m.source === '다크니스 가든')).toBe(false);
    expect(result.warnings.some(w => w.includes('다크니스 가든') && w.includes('해석 못함'))).toBe(true);
  });
});
