import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip, tooltipLines } from '../tooltip';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const responses = load('tests/fixtures/audit/2026-10-13-emperor-import-sources.json').responses;
const effects: NonNullable<RawArmory['arkpassive']>['Effects'] = [...responses.arkpassive.data.Effects,
  ...load('tests/fixtures/audit/2026-10-13-sun-nodes-details.json').official.data.Effects];
const raw: RawArmory = { profiles: responses.profiles.data, combatSkills: [], arkpassive: null,
  arkgrid: null, engravings: null, gems: null };
const names = ['황제의 칙령', '황제의 만찬', '또 다른 황제', '황제의 심판'];
function input(name: string) {
  return { ...raw, arkpassive: { Effects: [structuredClone(effects.find(e => strip(e.Description).includes(name))!)] } };
}

describe.each(names)('%s damage input boundary', name => {
  it('keeps the supplied official damage and proc values', () => {
    const { build, warnings } = buildFromArmory(input(name));
    const mods = build.passiveMods.filter(m => m.source.startsWith(name));
    expect(mods.map(m => [m.bucket, m.value])).toEqual(name === '황제의 칙령' ? [['emperorCardDmg', 0.8]]
      : name === '황제의 만찬' ? [['skillDmg', 0.47]]
        : name === '또 다른 황제' ? [['dmgToEnemy', 0.16], ['emperorCardDmg', 0.4]]
          : [['skillDmg', -0.02], ['skillDmg', 0.02]]);
    expect(build.anotherEmperorChance).toBe(name === '또 다른 황제' ? 0.2 : undefined);
    expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(false);
  });

  it.each(['condition', 'category', 'tier', 'zero level', 'unsupported level', 'invalid number', 'reversed effect'])(
    'does not apply damage or a proc from %s', change => {
      const value = input(name), node = value.arkpassive.Effects[0]!;
      node.Description = strip(node.Description);
      const text = tooltipLines(node.ToolTip).filter(t => ![name, '깨달음'].includes(t) && !/^아크 패시브 레벨/.test(t))
        .join(' ').replace(/\|\|/g, ' ').trim();
      if (change === 'condition') node.ToolTip = JSON.stringify({ value: text, condition: '생명력이 절반 이상일 때만 적용됩니다.' });
      if (change === 'category') node.Description = node.Description.replace('깨달음', '도약');
      if (change === 'tier') node.Description = node.Description.replace(/\d티어/, '5티어');
      if (change === 'zero level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.0');
      if (change === 'unsupported level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.9');
      if (change === 'invalid number') node.ToolTip = JSON.stringify({ value: text.replace(/[\d.]+%/, '1.2.3%') });
      if (change === 'reversed effect') node.ToolTip = JSON.stringify({ value: text.replace('증가', '감소') });
      const { build, warnings } = buildFromArmory(value);
      expect(build.passiveMods.some(m => m.source.startsWith(name))).toBe(false);
      expect(build.anotherEmperorChance).toBeUndefined();
      expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
});

it('does not apply Feast from an isolated damage sentence without its normal-use clause', () => {
  const value = input('황제의 만찬');
  value.arkpassive.Effects[0]!.ToolTip = JSON.stringify({ value: '일반 스킬의 피해량이 47.0% 증가한다.' });
  expect(buildFromArmory(value).build.passiveMods.some(m => m.source.startsWith('황제의 만찬'))).toBe(false);
});
