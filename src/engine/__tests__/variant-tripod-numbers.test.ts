import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[0];
const raw = Object.fromEntries(source.responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
const targets: Record<string, string[]> = {
  '운명의 부름': ['연속 공격', '페이크 플립'], '언리미티드 셔플': ['어둠의 핵'],
  '다크 리저렉션': ['꿰뚫는 일격', '죽음의 공포', '분노의 일격'], '이보크': ['분할 마법진'],
  '스크래치 딜러': ['예리한 일격'], '스파이럴 엣지': ['무자비한 사격'],
  '댄싱 오브 스파인플라워': ['밤에 피는 꽃', '페이크 플립'],
};
const cases = raw.combatSkills.flatMap(s => (s.Tripods ?? []).filter(t => targets[s.Name]?.includes(t.Name))
  .map(t => ({ skill: s.Name, name: t.Name, text: strip(t.Tooltip) })));
function convert(skillName: string, name: string, text: string) {
  const skill = structuredClone(raw.combatSkills.find(s => s.Name === skillName)!);
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = [{ ...skill.Tripods!.find(t => t.Name === name)!, IsSelected: true, Tooltip: text }];
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
describe.each(cases)('$skill / $name finite variant input', ({ skill, name, text }) => {
  const baseline = convert(skill, name, '알 수 없는 설명').build.skills[0]!;
  it('keeps the official effect, including damage values above 100 percent', () => {
    expect(convert(skill, name, text).build.skills[0]).not.toEqual(baseline);
  });
  for (const [index, match] of [...text.matchAll(/[\d.]+(?=%|초)/g)].entries()) {
    it.each(['1.2.3', '9'.repeat(400)])(`rejects invalid numeric field ${index + 1} without partial changes: %s`, invalid => {
      const changed = text.slice(0, match.index) + invalid + text.slice(match.index! + match[0].length);
      const result = convert(skill, name, changed);
      expect(result.build.skills[0]).toEqual(baseline);
      expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
  }
});
it('rejects defense ignore above 100 percent', () => {
  const result = convert('다크 리저렉션', '꿰뚫는 일격', '적중된 적의 모든 방어력을 101% 무시한다.');
  expect(result.build.skills[0]!.defenseIgnore).toBeUndefined();
  expect(result.warnings.some(w => w.includes('방어 무시 미반영'))).toBe(true);
});
