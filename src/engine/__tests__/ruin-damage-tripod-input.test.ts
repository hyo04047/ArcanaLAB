import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { responses: { endpoint: string; body: string }[] }[];
function rawAt(index: number): RawArmory {
  return Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
}
function convert(skillName: string, name: string, description?: string, index = 1) {
  const raw = rawAt(index), skill = raw.combatSkills.find(s => s.Name === skillName)!;
  const tripod = skill.Tripods!.find(t => t.Name === name)!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = description === undefined ? [] : [{ ...tripod, IsSelected: true, Tooltip: description }];
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
const cases = [
  { skill: '셀레스티얼 레인', id: 'celestial_rain', name: '급소 타격', effects: [['critRate', 0.45, '급소 타격']] },
  { skill: '셀레스티얼 레인', id: 'celestial_rain', name: '강화된 일격', effects: [['skillDmg', 0.6, '강화된 일격']] },
  { skill: '포 카드', id: 'four_of_a_kind', name: '카드 강화', effects: [['skillDmg', 0.75, '카드 강화']] },
  { skill: '포 카드', id: 'four_of_a_kind', name: '풀 하우스', effects: [['critRate', 0.44, '풀 하우스'], ['skillDmg', 0.36, '풀 하우스(피면)']] },
];
for (const { skill, id, name, effects } of cases) {
  const text = strip(rawAt(1).combatSkills.find(s => s.Name === skill)!.Tripods!.find(t => t.Name === name)!.Tooltip);
  const base = convert(skill, name).build.skills[0]!;
  describe(`${skill} ${name} full damage clause`, () => {
    it.each([0, 1])('preserves the complete official source %s', index => {
      const official = strip(rawAt(index).combatSkills.find(s => s.Name === skill)!.Tripods!.find(t => t.Name === name)!.Tooltip);
      const result = convert(skill, name, official, index).build.skills[0]!;
      expect(result.mods).toEqual(effects.map(([bucket, value, source]) => ({ bucket, value, filter: { ids: [id] }, source })));
    });
    it.each([
      ['prefix condition', '마나가 50% 이상인 경우에만 ' + text],
      ['suffix condition', text + ' 버프가 있을 때만 적용된다.'],
      ['changed target', text.replace('스킬 및 스택트', '파티원')],
      ['missing clause', name === '풀 하우스' ? '스킬 및 스택트 효과의 치명타 적중률이 44.0% 증가한다.' : ''],
    ])('rejects %s without partial modifiers', (_label, description) => {
      const result = convert(skill, name, description);
      expect(result.build.skills[0]).toEqual(base);
      expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
    for (const [index, match] of [...text.matchAll(/[\d.]+(?=%)/g)].entries()) {
      it.each(['1.2.3', '9'.repeat(400), '-1'])(`rejects invalid field ${index + 1}: %s`, invalid => {
        const description = text.slice(0, match.index) + invalid + text.slice(match.index! + match[0].length);
        expect(convert(skill, name, description).build.skills[0]).toEqual(base);
      });
    }
    if (effects[0]![0] === 'critRate') it('rejects a crit chance over 100 percent', () => {
      expect(convert(skill, name, text.replace(/[\d.]+%/, '101%')).build.skills[0]).toEqual(base);
    });
  });
}

it('does not keep the crit bonus when Full House changes its boss condition', () => {
  const text = '스킬 및 스택트 효과의 치명타 적중률이 44.0% 증가하고, 일반 몬스터에게 주는 피해가 36.0% 증가한다.';
  expect(convert('포 카드', '풀 하우스', text).build.skills[0]).toEqual(convert('포 카드', '풀 하우스').build.skills[0]);
});
