import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const responses = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
function input(): RawArmory {
  return { profiles: structuredClone(responses.profiles.data), combatSkills: [],
    arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
const overflow = '9'.repeat(400);
function expectFinite(value: unknown): void {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  else if (value && typeof value === 'object') Object.values(value).forEach(expectFinite);
}

describe('profile numbers cannot poison a simulation', () => {
  it.each(['치명', '특화', '신속'].flatMap(type => ['NaN', 'Infinity', '-1', ' ', overflow].map((value, index) => ({ type, value, index }))))(
    'rejects invalid $type value case $index before using the stat fallback', ({ type, value }) => {
      const raw = input(), stat = raw.profiles.Stats.find(s => s.Type === type)!;
      stat.Value = value; stat.Tooltip = [];
      expect(() => buildFromArmory(raw)).toThrow(`전투 특성 값이 올바르지 않습니다: ${type}`);
    });

  it.each([{ value: '0', expected: 0 }, { value: '1,234', expected: 1234 }])('accepts displayed stat $value', ({ value, expected }) => {
    const raw = input(), stat = raw.profiles.Stats.find(s => s.Type === '치명')!;
    stat.Value = value; stat.Tooltip = [];
    const { build } = buildFromArmory(raw);
    expect(build.stats.crit).toBe(expected); expectFinite(build);
  });

  it('retains the existing missing-stat fallback', () => {
    const raw = input(); raw.profiles.Stats = raw.profiles.Stats.filter(s => s.Type !== '신속');
    const { build, warnings } = buildFromArmory(raw);
    expect(build.stats.swift).toBe(0); expectFinite(build);
    expect(warnings.some(w => w.includes('신속') && w.includes('근사'))).toBe(true);
  });

  it('keeps the documented attack placeholder when the parsed base overflows', () => {
    const raw = input(), stat = raw.profiles.Stats.find(s => s.Type === '공격력')!;
    stat.Tooltip = [`기본 공격력은 ${overflow} 입니다.`];
    const { build, warnings } = buildFromArmory(raw);
    expect(build.params.atkBase).toBe(1); expect(build.attackPower).toBeUndefined(); expectFinite(build);
    expect(warnings.some(w => w.includes('기본 공격력 툴팁 미확인'))).toBe(true);
  });

  it('does not retain an infinite displayed attack increase', () => {
    const raw = input(), stat = raw.profiles.Stats.find(s => s.Type === '공격력')!;
    stat.Tooltip![2] = `공격력이 ${overflow} 증가되었습니다.`;
    const { build, warnings } = buildFromArmory(raw);
    expect(build.params.atkBase).toBe(222811); expect(build.attackPower?.increase).toBeUndefined(); expectFinite(build);
    expect(build.attackPower?.status).toBe('mismatch');
    expect(warnings.some(w => w.includes('공격력 재구성 불일치'))).toBe(true);
  });
});
