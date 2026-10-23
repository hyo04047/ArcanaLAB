import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-emperor-import-sources.json').responses;
const base: RawArmory = { profiles: source.profiles.data, combatSkills: [], arkpassive: null, arkgrid: null, engravings: null, gems: null };
const definitions = [
  { name: '공격력', bucket: 'atk', line: '공격력 +2.01%', value: 0.0201 },
  { name: '추가 피해', bucket: 'addDmg', line: '추가 피해 +3.23%', value: 0.0323 },
  { name: '보스 피해', bucket: 'dmgToEnemy', line: '보스 등급 이상 몬스터에게 주는 피해 +1.75%', value: 0.0175 },
] as const;
const gems = (raw: RawArmory) => buildFromArmory(raw).build.passiveMods.filter(m => m.source.startsWith('젬'));
function input(name: string, line?: string, active: boolean | undefined = true): RawArmory {
  return { ...base, arkgrid: { Effects: line === undefined ? [] : [{ Name: name, Tooltip: line }],
    Slots: [{ Index: 0, Name: '혼돈의 별 코어 : 통제', Point: 0,
      Gems: [{ Index: 0, Grade: '고대', IsActive: active,
        Tooltip: JSON.stringify({ value: `필요 의지력 : 3<br>[${name}] Lv.5<br>${name} +0.40%` }) }] }] } };
}

describe.each(definitions)('ark-grid gem $name', ({ name, bucket, line, value }) => {
  it('uses the complete official aggregate once instead of individual rounded values', () => {
    const mods = gems(input(name, line));
    expect(mods).toHaveLength(1);
    expect(mods[0]!.bucket).toBe(bucket);
    expect(mods[0]!.value).toBeCloseTo(value, 12);
  });
  it('does not add an inactive individual gem on top of the authoritative aggregate', () => {
    expect(gems(input(name, line, false))).toEqual(gems(input(name, line)));
  });
  it('keeps a zero aggregate authoritative', () => {
    const mods = gems(input(name, line.replace(/[\d.]+%/, '0%')));
    expect(mods).toHaveLength(1); expect(mods[0]!.value).toBe(0);
  });
  it.each([false, undefined])('does not use an inactive or unknown-state gem as fallback: %s', active => {
    const raw = input(name, undefined);
    raw.arkgrid!.Slots[0]!.Gems![0]!.IsActive = active;
    expect(gems(raw)).toEqual([]);
    if (active === undefined) expect(buildFromArmory(raw).warnings.some(w => w.includes('젬 활성 상태 미확인'))).toBe(true);
  });
  it('adds active fallback values within one effect and labels the approximation', () => {
    const raw = input(name);
    raw.arkgrid!.Slots[0]!.Gems!.push({ ...raw.arkgrid!.Slots[0]!.Gems![0]!, Index: 1 });
    const result = buildFromArmory(raw), mods = gems(raw);
    expect(mods).toHaveLength(1); expect(mods[0]!.value).toBeCloseTo(0.008, 12);
    expect(result.warnings.some(w => w.includes(`젬 ${name} 합산 효과 없음`))).toBe(true);
  });
  it.each(['condition', 'invalid number'])('does not fall back when the supplied aggregate is unsupported: %s', change => {
    const raw = input(name, change === 'condition' ? line + ' (적중 후)' : line.replace(/[\d.]+%/, '1.2.3%'));
    expect(gems(raw)).toEqual([]);
    expect(buildFromArmory(raw).warnings.some(w => w.includes(`젬 ${name} 합산 효과 해석 못함`))).toBe(true);
  });
});

it.each([
  { grid: source.arkgrid.data, attack: 0.0201, additional: 0.0323, boss: 0.0175 },
  { grid: load('tests/fixtures/armory/FixtureCharacter26/arkgrid.json'), attack: 0.0205, additional: 0.042, boss: 0.0108 },
])('reproduces all three official totals without multiplying separate boss gems', ({ grid, attack, additional, boss }) => {
  const mods = gems({ ...base, arkgrid: grid });
  expect(mods).toHaveLength(3);
  const skill = { id: 'control', name: '통제', kind: 'normal' as const, cooldown: 1, castTime: 1, directCoef: 1, hits: 1 };
  const m = computeMultipliers({ atkBase: 1 }, mods, { skill, stacks: 0, component: 'direct' });
  expect(m.atk).toBeCloseTo(1 + attack, 12);
  expect(m.addDmg).toBeCloseTo(1 + additional, 12);
  expect(m.dmgToEnemy).toBeCloseTo(1 + boss, 12);
});
