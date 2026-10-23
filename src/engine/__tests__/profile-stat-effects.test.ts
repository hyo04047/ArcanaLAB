import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { statMods } from '../presets';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const profiles = [load('tests/fixtures/audit/2026-10-13-emperor-import-sources.json').responses.profiles.data,
  load('tests/fixtures/armory/FixtureCharacter26/profiles.json')] as RawArmory['profiles'][];
const raw = (profile = profiles[0]!): RawArmory => ({ profiles: structuredClone(profile), combatSkills: [],
  arkpassive: null, arkgrid: null, engravings: null, gems: null });
const fields = [
  ['치명', 'critRate'], ['신속', 'atkSpeed'], ['신속', 'moveSpeed'], ['신속', 'cooldown'],
  ['특화(루인)', 'skillDmg'], ['특화(각성)', 'skillDmg'],
] as const;
function values(input: RawArmory) {
  const build = buildFromArmory(input).build;
  return [...fields.map(([source, bucket]) => build.passiveMods.find(m => m.source === source && m.bucket === bucket)!.value),
    build.params!.gaugeGainBonus];
}
describe.each([
  { index: 0, expected: [23.04, 31.38, 31.38, 39.23, 3.75, 1.63, 2.68] },
  { index: 1, expected: [18.82, 3.89, 3.89, 4.87, 86.87, 37.92, 62.05] },
])('saved official profile $index', ({ index, expected }) => {
  it.each(expected.map((percent, field) => ({ percent, field })))('uses official effect $field at its displayed precision', ({ percent, field }) => {
    expect(values(raw(profiles[index]))[field]).toBeCloseTo(percent / 100, 12);
  });
});
it('falls back only for the missing effect and reports the approximation', () => {
  const input = raw();
  input.profiles.Stats.find(s => s.Type === '신속')!.Tooltip!.splice(1, 1);
  const converted = buildFromArmory(input);
  expect(values(input)[2]).toBeCloseTo(1827 * 12 / 69900, 12);
  expect(values(input)[1]).toBeCloseTo(0.3138, 12);
  expect(converted.warnings.some(w => w.includes('신속 이동 속도') && w.includes('근사'))).toBe(true);
});
it.each(['체력이 50% 이하일 때 치명타 적중률이 99% 증가합니다.',
  '치명타 적중률이 99% 증가합니다. 적에게 주는 피해가 감소합니다.',
  '치명타 적중률이 1.2.3% 증가합니다.', '치명타 적중률이 -1% 증가합니다.',
  '치명타 적중률이 101% 증가합니다.'])('does not partially apply malformed or conditional text: %s', text => {
  const input = raw();
  input.profiles.Stats.find(s => s.Type === '치명')!.Tooltip = [text];
  expect(values(input)[0]).toBeCloseTo(644 * 25 / 69900, 12);
  expect(buildFromArmory(input).warnings.some(w => w.includes('치명 치명타 적중률') && w.includes('근사'))).toBe(true);
});
it('rejects cooldown reduction of 100 percent', () => {
  const input = raw();
  input.profiles.Stats.find(s => s.Type === '신속')!.Tooltip![2] = '스킬 재사용 대기시간이 100% 감소합니다.';
  expect(values(input)[3]).toBeCloseTo(1827 * 15 / 69900, 12);
  expect(buildFromArmory(input).warnings.some(w => w.includes('신속 쿨타임') && w.includes('근사'))).toBe(true);
});
it('accepts a displayed zero instead of treating it as missing', () => {
  const input = raw();
  input.profiles.Stats.find(s => s.Type === '치명')!.Tooltip = ['치명타 적중률이 0% 증가합니다.'];
  expect(values(input)[0]).toBe(0);
});
it('does not cap specialization damage at 100 percent', () => {
  const input = raw();
  input.profiles.Stats.find(s => s.Type === '특화')!.Tooltip![0] = '루인 스킬 피해량이 120% 증가합니다.';
  expect(values(input)[4]).toBe(1.2);
});
it('keeps manual stat-only conversion unchanged when no profile tooltips exist', () => {
  const input = raw();
  input.profiles.Stats.forEach(s => delete s.Tooltip);
  const old = statMods({ crit: 644, spec: 75, swift: 1827 });
  expect(values(input)).toEqual([...old.mods.map(m => m.value), old.gaugeBonus]);
  expect(buildFromArmory(input).warnings.filter(w => w.startsWith('전투 특성 툴팁 미확인:'))).toHaveLength(7);
});
