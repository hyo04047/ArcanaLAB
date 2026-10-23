import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[1];
const raw = Object.fromEntries(source.responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
const original = raw.combatSkills.find(s => s.Name === '세렌디피티')!;
const cases = [
  { name: '꿰뚫는 일격', target: '스킬 및 스택트 효과' },
  { name: '눈속임', target: '스킬' },
  { name: '우연한 일격', target: '루인' },
  { name: '연속된 어둠', target: '스킬이 콤보 조작' },
  { name: '의도된 우연', target: '세렌디피티' },
];
function convert(name?: string, edit?: (text: string) => string) {
  const skill = structuredClone(original);
  const tripod = skill.Tripods!.find(t => t.Name === name);
  skill.Tripods = tripod ? [{ ...tripod, IsSelected: true, Tooltip: edit ? edit(tripod.Tooltip!) : tripod.Tooltip }] : [];
  skill.Rune = null;
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
const base = convert().build.skills[0]!;
describe.each(cases)('Serendipity $name full-text validation', ({ name, target }) => {
  it('keeps the official effect', () => {
    const result = convert(name);
    expect(result.build.skills[0]).not.toEqual(base);
    expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(false);
  });
  it.each(['empty', 'prefix condition', 'suffix condition', 'wrong target', 'malformed number', 'nonfinite number'])(
    'does not apply a partial effect or combo profile for %s', change => {
      const result = convert(name, text => {
        if (change === 'empty') return '';
        if (change === 'prefix condition') return '특정 버프가 있을 때만 ' + text;
        if (change === 'suffix condition') return text + ' 마나가 50% 이상인 경우에만 적용됩니다.';
        if (change === 'wrong target') return text.replace(target, '대상 변경 통제');
        return text.replace(/[\d.]+(?=%)/, change === 'malformed number' ? '1.2.3' : '9'.repeat(400));
      });
      expect(result.build.skills[0]).toEqual(base);
      expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
});
it.each(cases.filter(c => c.name !== '연속된 어둠'))('rejects an over-100 probability for $name', ({ name }) => {
  const result = convert(name, text => text.replace(/[\d.]+(?=%)/, '101'));
  expect(result.build.skills[0]).toEqual(base);
});
it('rejects over-100 defense ignore without retaining its probability', () => {
  const result = convert('꿰뚫는 일격', text => text.replace('80.0%', '101%'));
  expect(result.build.skills[0]).toEqual(base);
});
it('keeps a damage increase above 100 percent while validating chance', () => {
  expect(convert('우연한 일격').build.skills[0]!.procCritDmg).toEqual({ chancePerStack: 0.2, value: 5.04 });
});
