import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { strip } from '../tooltip';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { responses: { endpoint: string; body: string }[] }[];
function convert(index = 1, description?: string, selected = true) {
  const raw = Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === '쿼드라 엑셀레이트')!;
  const tripod = skill.Tripods!.find(t => t.Name === '카드 증가')!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = [{ ...tripod, IsSelected: selected, Tooltip: description ?? tripod.Tooltip }];
  return { result: buildFromArmory({ ...raw, combatSkills: [skill] }), text: strip(tripod.Tooltip) };
}
const text = convert().text, base = convert(1, undefined, false).result.build.skills[0]!;
describe('Quadra Card Increase partial support boundary', () => {
  it.each([0, 1])('keeps the unconditional damage from official source %s and discloses unsupported procs', index => {
    const { result } = convert(index), skill = result.build.skills[0]!;
    expect(skill.mods).toContainEqual({ bucket: 'skillDmg', value: 0.45,
      filter: { ids: ['quadra_accelerate'], component: 'direct' }, source: '카드 증가' });
    expect(skill.hits).toBe(base.hits); expect(skill.stacksGranted).toBe(base.stacksGranted);
    expect(result.warnings.some(w => w.includes('쿼드라') && w.includes('카드 증가') && w.includes('확률 추가타') && w.includes('4중첩') && w.includes('미반영'))).toBe(true);
  });
  it.each([['direct', 1.45], ['stack', 1], ['dot', 1]] as const)('limits the constant multiplier for %s', (component, expected) => {
    const skill = convert().result.build.skills[0]!;
    expect(computeMultipliers({ atkBase: 100 }, skill.mods!, { skill, component, stacks: 4 }).nonCrit).toBe(expected);
  });
  it.each([
    '', '특정 버프가 있을 때만 ' + text, text + ' 마나가 50% 이상인 경우에만 적용된다.',
    text.replace('4중첩', '3중첩'), text.replace('피해가', '아군 피해가'),
    '피해가 45.0% 증가한다.', text.replace('5.0% 확률', '101% 확률'),
  ])('does not silently apply a partial altered clause: %s', description => {
    const result = convert(1, description).result;
    expect(result.build.skills[0]).toEqual(base);
    expect(result.warnings.some(w => w.includes('카드 증가') && w.includes('해석 못함'))).toBe(true);
  });
  for (const [index, match] of [...text.matchAll(/[\d.]+(?=%)/g)].entries()) {
    it.each(['1.2.3', '9'.repeat(400), '-1'])(`rejects invalid field ${index + 1}: %s`, invalid => {
      const description = text.slice(0, match.index) + invalid + text.slice(match.index! + match[0].length);
      expect(convert(1, description).result.build.skills[0]).toEqual(base);
    });
  }
  it('does not show the partial support warning when unselected', () => {
    expect(convert(1, undefined, false).result.warnings.some(w => w.startsWith('쿼드라 엑셀레이트 / 카드 증가:'))).toBe(false);
  });
});
