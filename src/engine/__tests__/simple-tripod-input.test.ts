import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { responses: { endpoint: string; body: string }[] }[];
const cases = [
  { skill: '운명의 부름', name: '날렵한 움직임', effect: 'speed', value: 0.27 },
  { skill: '다크 리저렉션', name: '날렵한 움직임', effect: 'speed', value: 0.18 },
  { skill: '쿼드라 엑셀레이트', name: '날렵한 움직임', effect: 'speed', value: 0.36 },
  { skill: '셀레스티얼 레인', name: '날렵한 움직임', effect: 'speed', value: 0.27 },
  { skill: '다크 리저렉션', name: '치명적 카드', effect: 'critRate', value: 0.6 },
  { skill: '이보크', name: '치명적 공격', effect: 'critRate', value: 0.6 },
  { skill: '체크메이트', name: '급소 타격', effect: 'critRate', value: 0.4 },
  { skill: '다크 리저렉션', name: '강렬한 카드', effect: 'skillDmg', value: 0.5 },
  { skill: '이보크', name: '집속 마법진', effect: 'skillDmg', value: 0.5 },
  { skill: '댄싱 오브 스파인플라워', name: '격렬한 춤', effect: 'skillDmg', value: 0.45 },
];
function convert(skillName: string, name: string, description?: string, index = 1) {
  const raw = Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === skillName)!, tripod = skill.Tripods!.find(t => t.Name === name)!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = description === undefined ? [] : [{ ...tripod, IsSelected: true, Tooltip: description }];
  return { result: buildFromArmory({ ...raw, combatSkills: [skill] }), text: strip(tripod.Tooltip) };
}
for (const { skill, name, effect, value } of cases) describe(`${skill} ${name} single effect`, () => {
  const { result: empty, text } = convert(skill, name), base = empty.build.skills[0]!;
  it.each([0, 1])('preserves official source %s', index => {
    const official = convert(skill, name, undefined, index).text;
    const result = convert(skill, name, official, index).result.build.skills[0]!;
    if (effect === 'speed') expect(result.castTime).toBeCloseTo(base.castTime / (1 + value));
    else expect(result.mods).toContainEqual({ bucket: effect, value, filter: { ids: [base.id] }, source: name });
  });
  it.each(['특정 버프가 있을 때만 ' + text, text + ' 마나가 50% 이상일 때만 적용된다.'])('does not drop an extra condition: %s', description => {
    const result = convert(skill, name, description).result;
    expect(result.build.skills[0]).toEqual(base);
    expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
  });
  it.each(['1.2.3', '9'.repeat(400), '-1'])('rejects invalid values: %s', invalid => {
    expect(convert(skill, name, text.replace(/[\d.]+%/, invalid + '%')).result.build.skills[0]).toEqual(base);
  });
  if (effect === 'critRate') it('rejects impossible crit probability', () => {
    expect(convert(skill, name, text.replace(/[\d.]+%/, '101%')).result.build.skills[0]).toEqual(base);
  });
  if (effect === 'skillDmg') it('allows damage over 100 percent', () => {
    expect(convert(skill, name, text.replace(/[\d.]+%/, '150%')).result.build.skills[0]!.mods)
      .toContainEqual({ bucket: effect, value: 1.5, filter: { ids: [base.id] }, source: name });
  });
});
