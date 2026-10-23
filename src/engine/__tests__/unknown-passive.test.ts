import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';

const load = (file: string) => JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/' + file + '.json', 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'),
  arkpassive: load('arkpassive'), arkgrid: null, engravings: null, gems: null };
const crush = raw.arkpassive!.Effects.find(e => e.Description.includes('분쇄'))!;
const text = '진화형 피해가 20.0% 증가하며, 받는 피해가 4.0% 감소합니다.';
function input(description: string, tooltip: string) {
  return { ...raw, arkpassive: { Effects: [{ ...crush, Description: description, ToolTip: tooltip }] } };
}

describe('unknown passive effects', () => {
  it.each([
    '카드 사용 후 5초 동안 진화형 피해가 20.0% 증가합니다.',
    '마나가 절반 이상이면 치명타 적중률이 20.0% 증가합니다.',
    '일반 스킬의 재사용 대기시간이 20.0% 감소합니다.',
    '적에게 적중하면 5초간 공격 속도가 20.0% 증가합니다.',
    '루인 스킬의 치명타 피해가 20.0% 증가합니다.',
    '진화형 피해가 20.0% 증가합니다.',
  ])('warns without inventing an unconditional effect: %s', effect => {
    const name = '미지원 패시브';
    const { build, warnings } = buildFromArmory(input(`진화 3티어 ${name} Lv.1`, JSON.stringify({ value: effect })));
    expect(build.passiveMods.filter(m => m.source.startsWith(name))).toEqual([]);
    expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
  });

  it('retains the official Crush contribution alongside other evolution damage', () => {
    const { build, warnings } = buildFromArmory({ ...raw, arkpassive: { Effects: [crush] } });
    const mods = build.passiveMods.filter(m => m.source.startsWith('분쇄'));
    const result = computeMultipliers({ atkBase: 1 }, [...mods, { bucket: 'evoDmg', value: 0.5, source: 'control' }],
      { skill: build.skills[0]!, stacks: 4, component: 'direct' });
    expect(result.evoDmg).toBe(1.7);
    expect(warnings.some(w => w.includes('분쇄') && w.includes('해석 못함'))).toBe(false);
  });

  it.each(['prefix', 'suffix', 'separate condition', 'target', 'category', 'tier', 'zero level', 'unsupported level', 'invalid percentage', 'missing description'])(
    'excludes Crush entirely for unsupported %s', change => {
      let description = '진화 4티어 분쇄 Lv.1';
      let tooltip = JSON.stringify({ value: text });
      if (change === 'prefix') tooltip = JSON.stringify({ value: '카드 사용 후 5초 동안 ' + text });
      if (change === 'suffix') tooltip = JSON.stringify({ value: text + ' 마나가 절반 이상일 때만 적용됩니다.' });
      if (change === 'separate condition') tooltip = JSON.stringify({ value: text, condition: '마나가 절반 이상일 때만 적용됩니다.' });
      if (change === 'target') tooltip = JSON.stringify({ value: '일반 스킬의 ' + text });
      if (change === 'category') description = '깨달음 4티어 분쇄 Lv.1';
      if (change === 'tier') description = '진화 5티어 분쇄 Lv.1';
      if (change === 'zero level') description = '진화 4티어 분쇄 Lv.0';
      if (change === 'unsupported level') description = '진화 4티어 분쇄 Lv.2';
      if (change === 'invalid percentage') tooltip = JSON.stringify({ value: text.replace('20.0%', '1.2.3%') });
      if (change === 'missing description') tooltip = '';
      const { build, warnings } = buildFromArmory(input(description, tooltip));
      expect(build.passiveMods.filter(m => m.source.startsWith('분쇄'))).toEqual([]);
      expect(warnings.some(w => w.includes('분쇄') && w.includes('해석 못함'))).toBe(true);
    });
});
