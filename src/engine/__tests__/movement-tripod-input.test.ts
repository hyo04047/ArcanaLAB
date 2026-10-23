import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[1];
const raw = Object.fromEntries(source.responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
function convert(skillName: string, name: string, text?: string) {
  const skill = structuredClone(raw.combatSkills.find(s => s.Name === skillName)!);
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = text === undefined ? [] : [{ ...skill.Tripods!.find(t => t.Name === name)!, IsSelected: true, Tooltip: text }];
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
describe.each([
  { skill: '스크래치 딜러', name: '안전 장치', duration: 5, count: 2 },
  { skill: '스파이럴 엣지', name: '가벼운 발걸음', duration: 2, count: 1 },
])('$skill / $name all-or-nothing cast buff', ({ skill, name, duration, count }) => {
  const text = strip(raw.combatSkills.find(s => s.Name === skill)!.Tripods!.find(t => t.Name === name)!.Tooltip);
  const base = convert(skill, name).build.skills[0]!;
  it('keeps the official buffs and duration', () => {
    const result = convert(skill, name, text).build.skills[0]!;
    const buffs = result.onCast!.filter(e => e.mod.source === name);
    expect(buffs).toHaveLength(count);
    expect(buffs.every(e => e.duration === duration)).toBe(true);
  });
  it.each(['prefix condition', 'suffix condition', 'zero duration', 'wrong target'])('does not keep a partial buff for %s', change => {
    const changed = change === 'prefix condition' ? '특정 버프가 있을 때만 ' + text
      : change === 'suffix condition' ? text + ' 마나가 50% 이상일 때만 적용됩니다.'
        : change === 'zero duration' ? text.replace(/[\d.]+초간/, '0초간') : text.replace('이동속도가', '적의 이동속도가');
    const result = convert(skill, name, changed);
    expect(result.build.skills[0]).toEqual(base);
    expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
  });
  for (const [index, match] of [...text.matchAll(/[\d.]+(?=%|초|m)/g)].entries()) {
    it.each(['1.2.3', '9'.repeat(400)])(`rejects invalid numeric field ${index + 1}: %s`, invalid => {
      const changed = text.slice(0, match.index) + invalid + text.slice(match.index! + match[0].length);
      expect(convert(skill, name, changed).build.skills[0]).toEqual(base);
    });
  }
});
it('does not turn Flower teleport timing into an immediate movement buff', () => {
  const skill = raw.combatSkills.find(s => s.Name === '댄싱 오브 스파인플라워')!;
  const result = convert(skill.Name, '가벼운 발걸음', strip(skill.Tripods!.find(t => t.Name === '가벼운 발걸음')!.Tooltip));
  expect(result.build.skills[0]!.onCast!.some(e => e.mod.source === '가벼운 발걸음')).toBe(false);
  expect(result.warnings.some(w => w.includes('가벼운 발걸음') && w.includes('해석 못함'))).toBe(true);
});
