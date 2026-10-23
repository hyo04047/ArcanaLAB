import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8'));
const raw = Object.fromEntries(source.records[0].responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
const cases = [
  { key: 'arkpassive', warning: '아크패시브 정보 없음 — 효과 미반영·황후 기본 분류 사용(T 스킬·운용 확인 필요)', empty: { Effects: [] } },
  { key: 'arkgrid', warning: '아크그리드 정보 없음 — 코어·젬 효과 미반영', empty: { Slots: [], Effects: [] } },
  { key: 'engravings', warning: '각인 정보 없음 — 각인 효과 미반영', empty: { ArkPassiveEffects: [] } },
] as const;

describe('Nullable armory inputs are distinguished from successful empty lists', () => {
  it.each(cases)('$key: reports unavailable effects once', ({ key, warning, empty }) => {
    const absent = buildFromArmory({ ...raw, [key]: null });
    expect(absent.warnings.filter(w => w === warning)).toHaveLength(1);
    expect(absent.build).toEqual(buildFromArmory({ ...raw, [key]: empty }).build);
    if (key === 'arkpassive') {
      expect(absent.build.variant).toBe('empress');
      expect(absent.build.skills.some(s => s.id === 'the_devil')).toBe(true);
      expect(absent.build.skills.some(s => s.id === 'the_sun')).toBe(false);
    }
  });
  it.each(cases)('$key: does not call a successful empty list unavailable', ({ key, warning, empty }) => {
    expect(buildFromArmory({ ...raw, [key]: empty }).warnings).not.toContain(warning);
  });
  it('does not add missing-input warnings to the full official response', () => {
    const { warnings } = buildFromArmory(raw);
    for (const { warning } of cases) expect(warnings).not.toContain(warning);
  });
});
