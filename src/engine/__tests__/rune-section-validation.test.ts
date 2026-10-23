import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[0];
const raw = Object.fromEntries(source.responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
const names = ['질풍', '풍요', '속행', '단죄', '심판'];
function input(name: string) {
  const skill = structuredClone(raw.combatSkills.find(s => s.Rune?.Name === name)!);
  skill.Tripods = [];
  return { ...raw, combatSkills: [skill] };
}
type Section = { type?: string; value?: Record<string, unknown> };
function reject(name: string, edit: (parts: Record<string, Section>, effect: Section) => void) {
  const data = input(name), rune = data.combatSkills[0]!.Rune!;
  const parts: Record<string, Section> = JSON.parse(rune.Tooltip!);
  const effect = Object.values(parts).find(p => p?.type === 'ItemPartBox' && JSON.stringify(p.value).includes('스킬 룬 효과'))!;
  edit(parts, effect);
  rune.Tooltip = JSON.stringify(parts);
  const result = buildFromArmory(data);
  data.combatSkills[0]!.Rune = null;
  expect(result.build).toEqual(buildFromArmory(data).build);
  expect(result.warnings.some(w => w.includes(`룬 ${name} 해석 못함`))).toBe(true);
}

describe('Rune effect sections preserve every condition before applying an effect', () => {
  it.each(names)('keeps the official %s tooltip', name => {
    const data = input(name), result = buildFromArmory(data);
    expect(result.warnings.some(w => w.includes(`룬 ${name} 해석 못함`))).toBe(false);
    data.combatSkills[0]!.Rune = null;
    expect(result.build).not.toEqual(buildFromArmory(data).build);
  });
  it.each(names)('rejects a %s condition in another field of the same effect section', name => {
    reject(name, (_parts, effect) => { effect.value!.Element_002 = '마나가 50% 이상인 경우에만 적용됩니다.'; });
  });
  it.each(names)('rejects duplicate %s effect sections', name => {
    reject(name, (parts, effect) => { parts.ExtraEffect = structuredClone(effect); });
  });
  it.each(names)('does not apply a %s effect moved outside the rune-effect section', name => {
    reject(name, (_parts, effect) => { effect.value!.Element_000 = '획득 방법'; });
  });
  it.each(['단죄', '심판'])('rejects a nonfinite %s duration', name => {
    reject(name, (_parts, effect) => {
      effect.value!.Element_001 = String(effect.value!.Element_001).replace(/\d+초간/, '9'.repeat(400) + '초간');
    });
  });
});
