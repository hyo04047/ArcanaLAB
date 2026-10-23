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
function convert(name: string, description?: string, index = 1) {
  const raw = rawAt(index), skill = raw.combatSkills.find(s => s.Name === '시크릿 가든')!;
  const tripod = skill.Tripods!.find(t => t.Name === name)!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = description === undefined ? [] : [{ ...tripod, IsSelected: true, Tooltip: description }];
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
const cases = [
  { name: '급소 타격', bucket: 'critRate', value: 0.4, filter: { ids: ['secret_garden'] } },
  { name: '완전한 비밀', bucket: 'stackEffectDmg', value: 0.8, filter: { ids: ['secret_garden'], minStacks: 4 } },
  { name: '시크릿 찬스', bucket: 'stackEffectDmg', value: 0.95, filter: { ids: ['secret_garden'] } },
];
for (const { name, bucket, value, filter } of cases) {
  const text = strip(rawAt(1).combatSkills.find(s => s.Name === '시크릿 가든')!.Tripods!.find(t => t.Name === name)!.Tooltip);
  const base = convert(name).build.skills[0]!;
  describe(`Secret Garden ${name} complete description`, () => {
    it.each([0, 1])('preserves official source %s', index => {
      const official = strip(rawAt(index).combatSkills.find(s => s.Name === '시크릿 가든')!.Tripods!.find(t => t.Name === name)!.Tooltip);
      expect(convert(name, official, index).build.skills[0]!.mods).toContainEqual({ bucket, value, filter, source: name });
    });
    it.each([
      ['prefix condition', '마나가 50% 이상일 때만 ' + text],
      ['suffix condition', text + ' 버프가 있을 때만 적용된다.'],
      ['changed target', name === '급소 타격' ? text.replace('스킬 및 스택트 효과', '파티원')
        : name === '완전한 비밀' ? text.replace('4중첩인 적', '일반 적') : text.replace('적에게', '파티원에게')],
      ['missing text', ''],
    ])('rejects %s without partial effects', (_label, changed) => {
      const result = convert(name, changed);
      expect(result.build.skills[0]).toEqual(base);
      expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
    for (const [index, match] of [...text.matchAll(/[\d.]+(?=%)/g)].entries()) {
      it.each(['1.2.3', '9'.repeat(400), '-1'])(`rejects invalid numeric field ${index + 1}: %s`, invalid => {
        const changed = text.slice(0, match.index) + invalid + text.slice(match.index! + match[0].length);
        expect(convert(name, changed).build.skills[0]).toEqual(base);
      });
    }
    it('keeps zero as a valid increase', () => {
      expect(convert(name, text.replace(/[\d.]+%/, '0%')).build.skills[0]!.mods)
        .toContainEqual({ bucket, value: 0, filter, source: name });
    });
    it('distinguishes the crit probability limit from damage increases', () => {
      const result = convert(name, text.replace(/[\d.]+%/, '150%'));
      if (name === '급소 타격') expect(result.build.skills[0]).toEqual(base);
      else expect(result.build.skills[0]!.mods).toContainEqual({ bucket, value: 1.5, filter, source: name });
    });
  });
}

it('requires the four-stack condition for Complete Secret', () => {
  expect(convert('완전한 비밀', '기존 스택트 효과에 추가로 3중첩인 적에게 80.0% 증가된 피해를 준다.').build.skills[0])
    .toEqual(convert('완전한 비밀').build.skills[0]);
});
it('does not substitute the adventurer bonus for the PvE bonus', () => {
  const result = convert('시크릿 찬스', '적에게 주는 스택트 피해 효과가 95.0% 증가한다. 대상이 모험가일 경우 250.0% 증가한다.');
  expect(result.build.skills[0]!.mods!.filter(m => m.source === '시크릿 찬스').map(m => m.value)).toEqual([0.95]);
});
