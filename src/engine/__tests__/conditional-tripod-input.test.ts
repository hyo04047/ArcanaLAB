import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { responses: { endpoint: string; body: string }[] }[];
const cases = [
  { skill: '운명의 부름', name: '약점 포착', bucket: 'skillDmg', value: 0.7, source: '약점 포착(피면)', omitted: '' },
  { skill: '리턴', name: '약점 포착', bucket: 'skillDmg', value: 0.7, source: '약점 포착(피면)', omitted: '' },
  { skill: '스크래치 딜러', name: '약점 공격', bucket: 'skillDmg', value: 0.7, source: '약점 공격(피면)', omitted: '' },
  { skill: '체크메이트', name: '약점 포착', bucket: 'skillDmg', value: 0.8, source: '약점 포착(피면)', omitted: '무력화' },
  { skill: '리턴', name: '집중된 카드', bucket: 'skillDmg', value: 0.45, source: '집중된 카드', omitted: '거리' },
  { skill: '세렌디피티', name: '우연한 강타', bucket: 'speed', value: 0.42, source: '우연한 강타', omitted: '기절' },
  { skill: '포 카드', name: '스트레이트', bucket: 'stackEffectDmg', value: 0.6, source: '스트레이트', omitted: '면역' },
];
function convert(skillName: string, name: string, description?: string, index = 1) {
  const raw = Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === skillName)!, tripod = skill.Tripods!.find(t => t.Name === name)!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = description === undefined ? [] : [{ ...tripod, IsSelected: true, Tooltip: description }];
  return { result: buildFromArmory({ ...raw, combatSkills: [skill] }), text: strip(tripod.Tooltip) };
}
for (const { skill, name, bucket, value, source, omitted } of cases) describe(`${skill} ${name} conditions`, () => {
  const { result: empty, text } = convert(skill, name), base = empty.build.skills[0]!;
  it.each([0, 1])('preserves the supported effect in official source %s', index => {
    const official = convert(skill, name, undefined, index).text;
    const result = convert(skill, name, official, index).result, actual = result.build.skills[0]!;
    if (bucket === 'speed') expect(actual.castTime).toBeCloseTo(base.castTime / (1 + value));
    else expect(actual.mods).toContainEqual({ bucket, value, filter: { ids: [base.id] }, source });
    if (omitted) expect(result.warnings.some(w => w.includes(name) && w.includes(omitted) && w.includes('미모델'))).toBe(true);
  });
  it.each(['특정 버프가 있을 때만 ' + text, text + ' 마나가 50% 이상인 경우에만 적용된다.'])('rejects an added condition: %s', description => {
    const result = convert(skill, name, description).result;
    expect(result.build.skills[0]).toEqual(base);
    expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
  });
  for (const [index, match] of [...text.matchAll(/[\d.]+(?=%|초)/g)].entries()) {
    it.each(['1.2.3', '9'.repeat(400)])(`rejects invalid field ${index + 1}: %s`, invalid => {
      const description = text.slice(0, match.index) + invalid + text.slice(match.index! + match[0].length);
      expect(convert(skill, name, description).result.build.skills[0]).toEqual(base);
    });
  }
  if (name.startsWith('약점')) it('does not turn a different target condition into a boss bonus', () => {
    expect(convert(skill, name, text.replace('피격이상 면역인 적', '일반 몬스터')).result.build.skills[0]).toEqual(base);
  });
});

it('requires a valid stun duration before accepting Accidental Strike speed', () => {
  const text = convert('세렌디피티', '우연한 강타').text.replace('2.0초간', '0초간');
  expect(convert('세렌디피티', '우연한 강타', text).result.build.skills[0])
    .toEqual(convert('세렌디피티', '우연한 강타').result.build.skills[0]);
});
