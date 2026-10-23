import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip, tooltipLines } from '../tooltip';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const base = 'tests/fixtures/armory/FixtureCharacter26/';
const raw: RawArmory = { profiles: load(base + 'profiles.json'), combatSkills: load(base + 'combat-skills.json'),
  arkpassive: null, arkgrid: null, engravings: null, gems: null };
const official: NonNullable<RawArmory['arkpassive']>['Effects'] = [...load(base + 'arkpassive.json').Effects,
  ...load('tests/fixtures/audit/2026-10-13-sun-nodes-details.json').official.data.Effects,
  ...load('tests/fixtures/audit/2026-10-13-sun-nodes-sources.json').official.data.Effects];
const names = ['풀려난 힘', '잠재력 해방', '즉각적인 주문', '쿼즈', '폴스 딜', '숨겨진 패'];
const baseline = buildFromArmory(raw).build;

function input(name: string) {
  return { ...raw, arkpassive: { Effects: [structuredClone(official.find(e => strip(e.Description).includes(name))!)] } };
}

describe.each(names)('%s complete leap description', name => {
  it('preserves the stored official effect', () => {
    const { build, warnings } = buildFromArmory(input(name));
    const mods = build.passiveMods.filter(m => m.source.startsWith(name));
    if (name === '풀려난 힘') expect(mods).toEqual([{ bucket: 'dmgToEnemy', value: 0.15, filter: { kinds: ['hyper_awakening'] }, source: '풀려난 힘 Lv5' }]);
    if (name === '잠재력 해방') expect(mods).toEqual([{ bucket: 'cooldown', value: 0.06, filter: { kinds: ['hyper_awakening'] }, source: '잠재력 해방 Lv3' }]);
    if (name === '즉각적인 주문') expect(build.skills.find(s => s.id === 'the_devil')!.castTime)
      .toBeCloseTo(baseline.skills.find(s => s.id === 'the_devil')!.castTime / 1.12);
    if (name === '쿼즈') expect(mods.map(m => [m.bucket, m.value, m.filter])).toEqual([
      ['skillDmg', 0.2, { ids: ['the_devil'] }], ['stackEffectDmg', 0.2, { ids: ['the_devil'], minStacks: 4 }],
    ]);
    if (name === '폴스 딜') expect(mods.map(m => [m.bucket, m.value, m.filter])).toEqual([
      ['skillDmg', 0.4, { ids: ['the_sun'], component: 'direct' }], ['critDmg', 0.3, { ids: ['the_sun'], component: 'direct' }],
    ]);
    if (name === '숨겨진 패') expect(mods).toEqual([{ bucket: 'skillDmg', value: 0.39,
      filter: { ids: ['the_sun'], component: 'direct' }, source: '숨겨진 패 Lv3' }]);
    expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(false);
  });

  it.each(['separate condition', 'wrong target', 'wrong category', 'wrong tier', 'zero level', 'invalid number'])(
    'rejects %s without applying a partial effect', change => {
      const value = input(name), node = value.arkpassive.Effects[0]!;
      node.Description = strip(node.Description);
      const text = tooltipLines(node.ToolTip).filter(t => ![name, '도약', 'NameTagBox', 'CommonSkillTitle', 'MultiTextBox'].includes(t)
        && !/^아크 패시브 레벨/.test(t)).join(' ').replace(/\|\|/g, ' ').trim();
      if (change === 'separate condition') node.ToolTip = JSON.stringify({ value: text, condition: '마나가 절반 이상일 때만 적용됩니다.' });
      if (change === 'wrong target') node.ToolTip = JSON.stringify({ value: text.replace(/초각성 스킬|더 데빌|더 썬/, '각성기') });
      if (change === 'wrong category') node.Description = node.Description.replace('도약', '진화');
      if (change === 'wrong tier') node.Description = node.Description.replace(/\d티어/, '5티어');
      if (change === 'zero level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.0');
      if (change === 'invalid number') node.ToolTip = JSON.stringify({ value: text.replace(/[\d.]+%/, '1.2.3%') });
      const { build, warnings } = buildFromArmory(value);
      expect(build).toEqual(baseline);
      expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
});

it('does not apply Quads damage when the stack clause is missing', () => {
  const value = input('쿼즈');
  value.arkpassive.Effects[0]!.ToolTip = JSON.stringify({ value: '더 데빌의 피해가 20.0% 증가한다.' });
  expect(buildFromArmory(value).build).toEqual(baseline);
});
