import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { strip } from '../tooltip';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { responses: { endpoint: string; body: string }[] }[];
function convert(index = 1, description?: string) {
  const raw = Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === '시크릿 가든')!;
  const tripod = skill.Tripods!.find(t => t.Name === '스톰 가든')!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = [{ ...tripod, IsSelected: true, Tooltip: description ?? tripod.Tooltip }];
  return { result: buildFromArmory({ ...raw, combatSkills: [skill] }), text: strip(tripod.Tooltip) };
}
const text = convert().text;
describe('Storm Garden stack damage reduction', () => {
  it.each([0, 1])('reads official source %s with explicit unmodeled effects', index => {
    const { result } = convert(index);
    expect(result.build.skills[0]!.mods).toContainEqual({ bucket: 'stackEffectDmg', value: -0.15,
      filter: { ids: ['secret_garden'], component: 'stack' }, source: '스톰 가든' });
    expect(result.warnings.some(w => w.includes('스톰 가든') && w.includes('뇌속성') && w.includes('넘어뜨리기') && w.includes('미모델'))).toBe(true);
  });
  it.each([['direct', 1], ['stack', 0.85], ['dot', 1]] as const)('applies only to %s damage', (component, expected) => {
    const skill = convert().result.build.skills[0]!;
    for (const stacks of [0, 1, 2, 3, 4])
      expect(computeMultipliers({ atkBase: 100 }, skill.mods!, { skill, component, stacks }).nonCrit).toBe(expected);
  });
  it('does not reduce another skill', () => {
    const skill = convert().result.build.skills[0]!;
    expect(computeMultipliers({ atkBase: 100 }, skill.mods!, { skill: { ...skill, id: 'other' }, component: 'stack', stacks: 4 }).nonCrit).toBe(1);
  });
  it.each([
    '', '특정 버프가 있을 때만 ' + text, text + ' 마나가 50% 이상인 경우에만 적용된다.',
    text.replace('스택트 효과로 주는 피해', '스킬 피해'), text.replace('15.0', '1.2.3'),
    text.replace('15.0', '9'.repeat(400)), text.replace('15.0', '-1'), text.replace('15.0', '101'),
  ])('rejects incomplete or invalid descriptions: %s', description => {
    const result = convert(1, description).result;
    expect(result.build.skills[0]!.mods!.some(m => m.source === '스톰 가든')).toBe(false);
    expect(result.warnings.some(w => w.includes('스톰 가든') && w.includes('해석 못함'))).toBe(true);
  });
  it.each([0, 100])('accepts the boundary reduction %s', reduction => {
    const skill = convert(1, text.replace('15.0', String(reduction))).result.build.skills[0]!;
    expect(computeMultipliers({ atkBase: 100 }, skill.mods!, { skill, component: 'stack', stacks: 4 }).nonCrit).toBe(1 - reduction / 100);
  });
});
