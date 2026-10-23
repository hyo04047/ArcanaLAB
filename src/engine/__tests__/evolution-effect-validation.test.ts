import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip, tooltipLines } from '../tooltip';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const base = 'tests/fixtures/armory/FixtureCharacter26/';
const effects: NonNullable<RawArmory['arkpassive']>['Effects'] = [
  ...load(base + 'arkpassive.json').Effects,
  ...load('tests/fixtures/audit/2026-10-17-common-passive-sources.json').records.flatMap((r: { body: string }) => JSON.parse(r.body).Effects),
];
const raw: RawArmory = { profiles: load(base + 'profiles.json'), combatSkills: load(base + 'combat-skills.json'),
  arkpassive: null, arkgrid: null, engravings: null, gems: null };
const baseline = buildFromArmory(raw).build;
const names = ['회심', '뭉툭한 가시', '달인', '일격', '금단의 주문', '입식 타격가'];
function input(name: string) {
  return { ...raw, arkpassive: { Effects: [structuredClone(effects.find(e => strip(e.Description).match(new RegExp(`^진화 \\d티어 ${name} Lv\\.\\d+$`)))!)] } };
}
function textOf(node: NonNullable<RawArmory['arkpassive']>['Effects'][number], name: string) {
  return tooltipLines(node.ToolTip).filter(t => ![name, '진화'].includes(t) && !/^아크 패시브 레벨/.test(t))
    .join(' ').replace(/\|\|/g, ' ').trim();
}

describe.each(names)('%s evolution input boundary', name => {
  it('keeps the stored official effect', () => {
    const { build, warnings } = buildFromArmory(input(name));
    if (name === '회심') expect(build.passiveMods.find(m => m.source.startsWith(name))!.value).toBe(0.12);
    if (name === '뭉툭한 가시') expect(build.bluntThorn).toEqual({ base: 0.15, ratio: 1.5, cap: 0.75 });
    if (name === '달인') expect(build.skills.some(s => s.onCast?.some(e => e.id === 'master_crit' && e.duration === 10 && e.maxStacks === 5))).toBe(true);
    if (name === '일격') expect(build.passiveMods.filter(m => m.source.startsWith(name)).map(m => m.value)).toEqual([0.1, 0.16]);
    if (name === '금단의 주문') expect(build.passiveMods.filter(m => m.source.startsWith(name)).map(m => m.value)).toEqual([0.1, 0.1]);
    if (name === '입식 타격가') expect(build.passiveMods.find(m => m.source.startsWith(name))!.value).toBeCloseTo(0.21);
    expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(false);
  });

  it.each(['separate condition', 'zero level', 'wrong tier', 'invalid number'])(
    'rejects %s without partial application', change => {
      const value = input(name), node = value.arkpassive.Effects[0]!;
      node.Description = strip(node.Description);
      const text = textOf(node, name);
      if (change === 'separate condition') node.ToolTip = JSON.stringify({ value: text, condition: '생명력이 절반 이상일 때만 적용합니다.' });
      if (change === 'zero level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.0');
      if (change === 'wrong tier') node.Description = node.Description.replace(/\d티어/, '1티어');
      if (change === 'invalid number') node.ToolTip = JSON.stringify({ value: text.replace(/[\d.]+%/, '1.2.3%') });
      const { build, warnings } = buildFromArmory(value);
      expect(build).toEqual(baseline);
      expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
});

it.each(['missing cap', 'changed cap'])('does not assume the Blunt Thorn critical cap: %s', change => {
  const value = input('뭉툭한 가시'), node = value.arkpassive.Effects[0]!;
  let text = textOf(node, '뭉툭한 가시');
  text = change === 'missing cap' ? text.replace(/치명타가 발생할 확률이 최대 [\d.]+% 로 제한됩니다\. /, '') : text.replace('80.0%', '70.0%');
  node.ToolTip = JSON.stringify({ value: text });
  expect(buildFromArmory(value).build.bluntThorn).toBeUndefined();
});

it.each(['duration', 'stacks'])('does not create a Master buff with zero %s', change => {
  const value = input('달인'), node = value.arkpassive.Effects[0]!;
  node.ToolTip = node.ToolTip!.replace(change === 'duration' ? '10초간' : '5중첩', change === 'duration' ? '0초간' : '0중첩');
  expect(buildFromArmory(value).build).toEqual(baseline);
});
