import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[1];
const raw = Object.fromEntries(source.responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
const original = raw.combatSkills.find(s => s.Name === '셀레스티얼 레인')!;
const tripod = original.Tripods!.find(t => t.Name === '약점 포착')!;
const text = strip(tripod.Tooltip);
function convert(description?: string) {
  const skill = structuredClone(original); skill.Rune = null;
  skill.Tripods = description === undefined ? [] : [{ ...tripod, IsSelected: true, Tooltip: description }];
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
const base = convert().build.skills[0]!;
describe('Rain weak point keeps damage and cooldown conditions together', () => {
  it('keeps the official 4-stack bonus and cooldown increase', () => {
    const result = convert(text).build.skills[0]!;
    expect(result.cooldown).toBe(base.cooldown + 8);
    expect(result.mods).toContainEqual({ bucket: 'stackEffectDmg', value: 1.76, filter: { ids: ['celestial_rain'], minStacks: 4 }, source: '약점 포착(4중첩)' });
  });
  it.each([
    ['prefix condition', '특정 버프가 있을 때만 ' + text],
    ['suffix condition', text + ' 마나가 50% 이상인 경우에만 적용됩니다.'],
    ['changed target', text.replace('피격이상 면역인 적', '일반 몬스터')],
    ['missing cooldown', text.replace('증가하지만 재사용 대기 시간이 8.0초 증가한다.', '증가한다.')],
    ['missing damage', '재사용 대기 시간이 8.0초 증가한다.'],
    ['reversed range', text.replace('44.0% ~ 176.0%', '176.0% ~ 44.0%')],
  ])('rejects both effects for %s', (_label, description) => {
    const result = convert(description);
    expect(result.build.skills[0]).toEqual(base);
    expect(result.warnings.some(w => w.includes('약점 포착') && w.includes('해석 못함'))).toBe(true);
  });
  for (const [index, match] of [...text.matchAll(/[\d.]+(?=%|초)/g)].entries()) {
    it.each(['1.2.3', '9'.repeat(400)])(`rejects invalid field ${index + 1} without partial changes: %s`, invalid => {
      const changed = text.slice(0, match.index) + invalid + text.slice(match.index! + match[0].length);
      expect(convert(changed).build.skills[0]).toEqual(base);
    });
  }
});
