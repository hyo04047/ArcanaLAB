import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[1];
const raw = Object.fromEntries(source.responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
const cases = [
  ...['언리미티드 셔플', '이보크', '스파이럴 엣지', '시크릿 가든'].map(skill => ({ skill, name: '빠른 준비' })),
  { skill: '포 카드', name: '신속한 준비' }, { skill: '포 카드', name: '눈속임' },
];
function input(skillName: string, name?: string, edit?: (text: string) => string) {
  const skill = structuredClone(raw.combatSkills.find(s => s.Name === skillName)!);
  skill.Level = 10; skill.Rune = null;
  const t = skill.Tripods!.find(t => t.Name === name);
  skill.Tripods = t ? [{ ...t, IsSelected: true, Tooltip: edit ? edit(strip(t.Tooltip)) : t.Tooltip }] : [];
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
describe.each(cases)('$skill / $name cooldown and chance input', ({ skill, name }) => {
  const base = input(skill).build.skills[0]!;
  it('keeps the official effect', () => {
    const result = input(skill, name);
    expect(result.build.skills[0]).not.toEqual(base);
    expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(false);
  });
  it.each(['prefix condition', 'suffix condition', 'changed effect', 'malformed number', 'nonfinite number'])(
    'does not apply a partial effect for %s', change => {
      const result = input(skill, name, text => {
        if (change === 'prefix condition') return '특정 버프가 있을 때만 ' + text;
        if (change === 'suffix condition') return text + ' 마나가 50% 이상인 경우에만 적용됩니다.';
        if (change === 'changed effect') return text.replace(name === '빠른 준비' ? '감소한다' : name === '신속한 준비' ? 'FixtureCharacter25화 된다' : '4 중첩', name === '눈속임' ? '2 중첩' : '감소하지 않는다');
        return text.replace(/[\d.]+(?=초|%)/, change === 'malformed number' ? '1.2.3' : '9'.repeat(400));
      });
      expect(result.build.skills[0]).toEqual(base);
      expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
});
it.each(['신속한 준비', '눈속임'])('rejects over-100 %s chance', name => {
  expect(input('포 카드', name, text => text.replace(/[\d.]+%/, '101%')).build.skills[0]).toEqual(input('포 카드').build.skills[0]);
});
it.each(['신속한 준비', '눈속임'])('accepts zero %s chance without inventing a fallback', name => {
  const result = input('포 카드', name, text => text.replace(/[\d.]+%/, '0%')).build.skills[0]!;
  expect(name === '신속한 준비' ? result.cdResetChance : result.keepStacksChance).toBe(0);
});
