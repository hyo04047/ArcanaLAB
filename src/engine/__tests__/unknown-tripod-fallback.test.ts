import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const record = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[1] as
  { responses: { endpoint: string; body: string }[] };
function convert(description?: string) {
  const raw = Object.fromEntries(record.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === '운명의 부름')!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = description === undefined ? [] : [{ Tier: 0, Slot: 1, Name: '알 수 없는 트라이포드', IsSelected: true, Tooltip: description }];
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
const base = convert().build;
describe('Unknown tripods are not inferred from isolated numbers', () => {
  it.each([
    '[스택트 스킬] 형태로 변경되어 스택트 중첩이 2회 부여되고 45.0% 증가된 피해를 준다.',
    '최대 스택트 중첩수가 1회 증가한다.',
    '최대 스택트 중첩수가 2에서 4로 증가한다.',
    '재사용 대기시간이 5.0초 증가한다.',
    '공격속도가 27.0% 증가한다.',
    '시전 속도가 30.0% 증가한다.',
    '치명타 적중률이 40.0% 증가한다.',
    '기존 스택트 효과에 추가로 4중첩인 적에게 80.0% 증가된 피해를 준다.',
    '스택트 효과 중첩에 따라 피해가 40.0% ~ 160.0% 증가한다.',
    '스택트 피해 효과가 95.0% 증가한다.',
    '스킬 및 스택트 효과 피해가 60.0% 증가한다.',
    '총 스킬 피해량이 70.0% 증가한다.',
    '총 50.0% 증가한다.',
    '적에게 주는 피해가 50.0% 증가한다.',
    '피격이상 면역인 적에게 주는 피해가 70.0% 증가한다.',
  ])('preserves the base build and reports unsupported text: %s', description => {
    const result = convert(description);
    expect(result.build).toEqual(base);
    expect(result.warnings.some(w => w.includes('알 수 없는 트라이포드') && w.includes('해석 못함'))).toBe(true);
  });
});
