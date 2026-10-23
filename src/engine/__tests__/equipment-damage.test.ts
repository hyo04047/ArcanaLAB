import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-emperor-import-sources.json').responses;
const base: RawArmory = { profiles: source.profiles.data, combatSkills: [], arkpassive: null, arkgrid: null, engravings: null, gems: null };
const mods = (raw: RawArmory) => buildFromArmory(raw).build.passiveMods.filter(m => m.source.startsWith('장비 '));
function input(Type: string, text: string, title = Type === '무기' ? '추가 효과' : '연마 효과'): RawArmory {
  return { ...base, equipment: [{ Type, Tooltip: JSON.stringify({ effect: { type: 'ItemPartBox',
    value: { Element_000: `<font>${title}</font>`, Element_001: text } } }) }] };
}
describe.each([
  { type: '무기', text: '추가 피해 +30.00%', bucket: 'addDmg', value: 0.30 },
  { type: '목걸이', text: '추가 피해 +2.60%', bucket: 'addDmg', value: 0.026 },
  { type: '목걸이', text: '적에게 주는 피해 +2.00%', bucket: 'dmgToEnemy', value: 0.02 },
  { type: '반지', text: '치명타 적중률 +0.95%', bucket: 'critRate', value: 0.0095 },
  { type: '반지', text: '치명타 피해 +2.40%', bucket: 'critDmg', value: 0.024 },
])('$type $text', ({ type, text, bucket, value }) => {
  it('imports the complete option from its equipment effect section', () => {
    const actual = mods(input(type, `<img src='dot'> <font>${text}</font>`));
    expect(actual).toHaveLength(1); expect(actual[0]!.bucket).toBe(bucket);
    expect(actual[0]!.value).toBeCloseTo(value, 12);
  });
  it.each(['condition', 'number'])('rejects an unsupported %s without extracting a partial number', change => {
    const text2 = change === 'condition' ? text + ' (체력 50% 이하)' : text.replace(/[\d.]+%/, '1.2.3%');
    const raw = input(type, text2);
    expect(mods(raw)).toEqual([]);
    expect(buildFromArmory(raw).warnings.some(w => w.includes('장비 피해 옵션 해석 못함'))).toBe(true);
  });
  it('does not apply similar text from an unrelated section', () => {
    expect(mods(input(type, text, '조건부 세트 효과'))).toEqual([]);
  });
});
it.each([
  { equipment: source.equipment.data, weapon: 0.30, necklace: 0.026, enemy: 0.02 },
  { equipment: load('tests/fixtures/armory/FixtureCharacter26/equipment.json'), weapon: 0.2882, necklace: 0.016, enemy: 0.012 },
])('imports both rings and excludes ally effects, weapon attack and base attack', ({ equipment, weapon, necklace, enemy }) => {
  const actual = mods({ ...base, equipment });
  expect(actual).toHaveLength(7);
  const additional = actual.filter(m => m.bucket === 'addDmg');
  expect(additional).toHaveLength(2);
  expect(additional[0]!.value).toBeCloseTo(weapon, 12);
  expect(additional[1]!.value).toBeCloseTo(necklace, 12);
  expect(actual.filter(m => m.bucket === 'dmgToEnemy').map(m => m.value)).toEqual([enemy]);
  expect(actual.filter(m => m.bucket === 'critRate').reduce((s, m) => s + m.value, 0)).toBe(0.019);
  expect(actual.filter(m => m.bucket === 'critDmg').reduce((s, m) => s + m.value, 0)).toBe(0.048);
  expect(actual.every(m => m.filter === undefined)).toBe(true);
});
it('separates marked options across different HTML line breaks', () => {
  expect(mods(input('목걸이', "<img src='dot'>추가 피해 +2.60%<BR /><img src='dot'>최대 생명력 +1300<br/><img src='dot'>적에게 주는 피해 +2.00%"))).toHaveLength(2);
});
it('does not import bracelet conditions as simple ring options', () => {
  expect(mods(input('팔찌', '치명타 적중률 +9.00%'))).toEqual([]);
});
it('reports missing weapon/accessory effect sections', () => {
  const result = buildFromArmory(input('무기', '추가 피해 +30.00%', '기본 효과'));
  expect(result.warnings.some(w => w.includes('장비 피해 옵션 자료 없음'))).toBe(true);
});
