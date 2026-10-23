import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const profile = JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8'));
const base: RawArmory = { profiles: profile, combatSkills: [], arkpassive: null, arkgrid: null, engravings: null, gems: null };
const cases = [
  { type: '무기', text: '추가 피해 +30.00%' },
  { type: '목걸이', text: '추가 피해 +2.60%' },
  { type: '목걸이', text: '적에게 주는 피해 +2.00%' },
  { type: '반지', text: '치명타 적중률 +0.95%' },
  { type: '반지', text: '치명타 피해 +2.40%' },
];
function convert(type: string, text: string) {
  return buildFromArmory({ ...base, equipment: [{ Type: type, Tooltip: JSON.stringify({ effect: { type: 'ItemPartBox', value: {
    Element_000: type === '무기' ? '추가 효과' : '연마 효과', Element_001: text,
  } } }) }] });
}
const equipmentMods = (result: ReturnType<typeof buildFromArmory>) => result.build.passiveMods.filter(m => m.source.startsWith('장비 '));

describe.each(cases)('$type $text condition boundaries', ({ type, text }) => {
  it.each(['<br>', '<BR />', '<br/>'])('keeps the condition after %s with its option', br => {
    const result = convert(type, `<img src='dot'>${text}${br}체력이 50% 이하일 때만 적용됩니다.`);
    expect(equipmentMods(result)).toEqual([]);
    expect(result.warnings.some(w => w.includes('장비 피해 옵션 해석 못함'))).toBe(true);
  });
  it('does not extract one effect from an unmarked multiline option', () => {
    const result = convert(type, `${text}<br>체력이 50% 이하일 때만 적용됩니다.`);
    expect(equipmentMods(result)).toEqual([]);
  });
});
it('retains a separate valid option after a conditional option', () => {
  const result = convert('목걸이', "<img src='dot'>추가 피해 +2.60%<br>체력이 50% 이하일 때만 적용됩니다.<br><img src='dot'>적에게 주는 피해 +2.00%");
  expect(equipmentMods(result).map(m => [m.bucket, m.value])).toEqual([['dmgToEnemy', 0.02]]);
});
it('does not guess separate options when a multiline text has no option markers', () => {
  expect(equipmentMods(convert('목걸이', '추가 피해 +2.60%<br>적에게 주는 피해 +2.00%'))).toEqual([]);
});
