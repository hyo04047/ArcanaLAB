import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[0];
const raw = Object.fromEntries(source.responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
const original = raw.combatSkills.find(s => s.Name === '이보크')!;
const poison = original.Tripods!.find(t => t.Name === '마나 중독')!;
const text = strip(poison.Tooltip);
function convert(mode: string, description?: string) {
  const skill = structuredClone(original);
  skill.Rune = null;
  skill.Tripods = skill.Tripods!.filter(t => t.Name === mode).map(t => ({ ...t, IsSelected: true }));
  if (description !== undefined) skill.Tripods.push({ ...poison, IsSelected: true, Tooltip: description });
  return buildFromArmory({ ...raw, combatSkills: [skill] });
}
const invalid: [string, string][] = [
  ['prefix condition', '특정 버프가 있을 때만 ' + text],
  ['suffix condition', text + ' 마나가 50% 이상인 경우에만 적용됩니다.'],
  ['missing direct clause', text.slice(text.indexOf('더 이상'))],
  ['missing poison clause', '적에게 주는 피해가 30.0% 감소한다.'],
  ['wrong target', text.replace('적에게 주는 피해', '각성기가 주는 피해')],
  ['malformed reduction', text.replace('30.0%', '1.2.3%')],
  ['over-100 reduction', text.replace('30.0%', '101%')],
  ['over-100 slow', text.replace('40.0%', '101%')],
  ['zero duration', text.replace('3.0초간', '0초간')],
  ['nonfinite duration', text.replace('3.0초간', '9'.repeat(400) + '초간')],
  ['zero stacks', text.replace('최대 3회', '최대 0회')],
  ['nonfinite stacks', text.replace('최대 3회', '최대 ' + '9'.repeat(400) + '회')],
  ['malformed display number', text.replace('1,179,820', '1,,820')],
];
describe.each(['기본', '분할 마법진', '중첩 마법진'])('Evoke poison %s input', mode => {
  const baseline = convert(mode).build.skills[0]!;
  it('keeps the official reduction and poison together', () => {
    const result = convert(mode, text).build.skills[0]!;
    expect(result.manaPoison).toMatchObject({ duration: 3, maxStacks: 3 });
    expect(result.mods).toContainEqual({ bucket: 'skillDmg', value: -0.3, filter: { ids: ['evoke'], component: 'direct' }, source: '마나 중독' });
    expect(result.manualEvoke).toEqual(baseline.manualEvoke);
    expect(result.splitEvoke).toEqual(baseline.splitEvoke);
  });
  it.each(invalid)('rejects the whole effect for %s', (_label, description) => {
    const result = convert(mode, description);
    expect(result.build.skills[0]).toEqual(baseline);
    expect(result.warnings.some(w => w.includes('마나 중독') && w.includes('해석 못함'))).toBe(true);
  });
});
