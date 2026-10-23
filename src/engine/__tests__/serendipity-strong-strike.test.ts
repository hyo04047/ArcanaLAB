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
  const skill = raw.combatSkills.find(s => s.Name === '세렌디피티')!;
  const tripod = skill.Tripods!.find(t => t.Name === '강화된 일격')!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = [{ ...tripod, IsSelected: true, Tooltip: description ?? tripod.Tooltip }];
  return { result: buildFromArmory({ ...raw, combatSkills: [skill] }), text: strip(tripod.Tooltip) };
}
const text = convert().text;
describe('Serendipity Strong Strike direct-only damage', () => {
  it.each([0, 1])('preserves official source %s damage with direct scope', index => {
    expect(convert(index).result.build.skills[0]!.mods).toContainEqual({ bucket: 'skillDmg', value: 1.7,
      filter: { ids: ['serendipity'], component: 'direct' }, source: '강화된 일격' });
  });
  it.each([['direct', 2.7], ['stack', 1], ['dot', 1]] as const)('applies the correct %s multiplier', (component, expected) => {
    const skill = convert().result.build.skills[0]!;
    expect(computeMultipliers({ atkBase: 100 }, skill.mods!, { skill, component, stacks: 4 }).nonCrit).toBe(expected);
  });
  it('does not amplify another skill', () => {
    const skill = convert().result.build.skills[0]!;
    expect(computeMultipliers({ atkBase: 100 }, skill.mods!, { skill: { ...skill, id: 'other' }, component: 'direct', stacks: 4 }).nonCrit).toBe(1);
  });
  it.each([
    '', '특정 버프가 있을 때만 ' + text, text + ' 마나가 50% 이상일 때만 적용된다.',
    text.replace('스킬 피해', '스택트 피해'), text.replace('170.0', '1.2.3'),
    text.replace('170.0', '9'.repeat(400)), text.replace('170.0', '-1'),
  ])('rejects altered descriptions without partial damage: %s', description => {
    const result = convert(1, description).result;
    expect(result.build.skills[0]!.mods!.some(m => m.source === '강화된 일격')).toBe(false);
    expect(result.warnings.some(w => w.includes('강화된 일격') && w.includes('해석 못함'))).toBe(true);
  });
});
