import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const profiles = load('tests/fixtures/audit/2026-10-13-emperor-import-sources.json').responses.profiles.data;
const icon = "<img src='option'></img>";
const input = (text: string, Type = '귀걸이', title = Type === '팔찌' ? '팔찌 효과' : '연마 효과'): RawArmory => ({
  profiles, combatSkills: [], arkpassive: null, arkgrid: null, engravings: null, gems: null,
  equipment: [{ Type, Tooltip: JSON.stringify({ effect: { type: 'ItemPartBox',
    value: { Element_000: title, Element_001: icon + text } } }) }],
});
const mods = (raw: RawArmory) => buildFromArmory(raw).build.passiveMods.filter(m => m.source.startsWith('장신구'));
it.each(['목걸이', '귀걸이', '반지', '팔찌'])('retains complete ordinary attack options for %s', type => {
  const actual = mods(input('공격력 <font>+0.95%</font><BR>' + icon + '공격력 +1,200', type));
  expect(actual).toEqual([{ bucket: 'atk', value: 0.0095, source: `장신구 ${type}` },
    { bucket: 'atkFlat', value: 1200, source: `장신구 ${type}` }]);
});
it.each(['공격력 +9% (체력 50% 이하)', '체력이 50% 이하일 때 공격력 +9%',
  '공격력 +9%<BR>치명타 적중 시에만 적용됩니다.', '공격력 +9%<BR>공격 속도가 2% 감소한다.',
  '공격력 +1.2.3%', '공격력 +1,20', '공격력 +101%', '공격력 +9%%'])('rejects partial or malformed attack options: %s', text => {
  const raw = input(text);
  expect(mods(raw)).toEqual([]);
  expect(buildFromArmory(raw).warnings.some(w => w.includes('장신구 공격력 해석 못함'))).toBe(true);
});
it('preserves the whole two-line bracelet option instead of dropping its condition', () => {
  const raw = input('공격력 +900<BR>무력화 상태인 적에게만 적용됩니다.<BR>' + icon + '치명 +100', '팔찌');
  expect(mods(raw)).toEqual([]);
  expect(buildFromArmory(raw).warnings.some(w => w.includes('장신구 공격력 해석 못함'))).toBe(true);
});
it.each(['기본 효과', '조건부 세트 효과', '아이템 설명'])('ignores attack text in the unrelated %s section', title => {
  expect(mods(input('공격력 +99%', '귀걸이', title))).toEqual([]);
});
it('ignores weapon, base, and ally attack without suppressing a valid adjacent option', () => {
  const text = ['무기 공격력 +99%', '기본 공격력 +80%', '아군 공격력 강화 효과 +90%', '공격력 +0.95%'].join('<BR>' + icon);
  expect(mods(input(text))).toEqual([{ bucket: 'atk', value: 0.0095, source: '장신구 귀걸이' }]);
});
it('does not treat an unstructured description as an equipment effect', () => {
  const raw = input(''); raw.equipment![0]!.Tooltip = '공격력 +99%';
  expect(mods(raw)).toEqual([]);
  expect(buildFromArmory(raw).warnings.some(w => w.includes('장신구 공격력 자료 없음'))).toBe(true);
});
it.each([
  { equipment: load('tests/fixtures/audit/2026-10-13-emperor-import-sources.json').responses.equipment.data, flat: 1170, percent: 0.019 },
  { equipment: load('tests/fixtures/armory/FixtureCharacter26/equipment.json'), flat: 0, percent: 0.019 },
])('preserves actual saved accessory attack totals', ({ equipment, flat, percent }) => {
  const actual = mods({ ...input(''), equipment });
  expect(actual.filter(m => m.bucket === 'atkFlat').reduce((s, m) => s + m.value, 0)).toBe(flat);
  expect(actual.filter(m => m.bucket === 'atk').reduce((s, m) => s + m.value, 0)).toBeCloseTo(percent, 12);
});
