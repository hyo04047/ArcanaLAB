import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const load = (file: string) => JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/' + file + '.json', 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: [], arkpassive: null, arkgrid: null,
  engravings: null, gems: null };
const effects: NonNullable<RawArmory['engravings']>['ArkPassiveEffects'] = load('engravings').ArkPassiveEffects;
function input(name: string) {
  return { ...raw, engravings: { ArkPassiveEffects: [structuredClone(effects!.find(e => e.Name === name)!)] } };
}
const names = ['원한', '저주받은 인형', '질량 증가', '아드레날린'];

describe.each(names)('%s engraving input boundary', name => {
  it('preserves the official values including active engraving-book level zero', () => {
    const { build, warnings } = buildFromArmory(input(name));
    const mods = build.passiveMods.filter(m => m.source.startsWith(name));
    expect(mods.map(m => [m.bucket, m.value])).toEqual(name === '원한' ? [['dmgToEnemy', 0.2625]]
      : name === '저주받은 인형' ? [['dmgToEnemy', 0.17]]
        : name === '질량 증가' ? [['dmgToEnemy', 0.1975], ['atkSpeed', -0.1]]
          : [['atk', 0.054000000000000006], ['critRate', 0.2]]);
    expect(warnings.some(w => w.includes(name) && w.includes('각인 해석 못함'))).toBe(false);
  });

  it.each(['missing', 'prefix', 'suffix', 'reversed', 'invalid number'])(
    'does not partially apply %s text', change => {
      const value = input(name), effect = value.engravings.ArkPassiveEffects[0]!;
      const text = strip(effect.Description);
      if (change === 'missing') effect.Description = '';
      if (change === 'prefix') effect.Description = '생명력이 절반 이상일 때 ' + text;
      if (change === 'suffix') effect.Description = text + ' 추가 조건을 만족해야 한다.';
      if (change === 'reversed') effect.Description = text.replace('증가', '감소');
      if (change === 'invalid number') effect.Description = text.replace(/[\d.]+%/, '1.2.3%');
      const { build, warnings } = buildFromArmory(value);
      expect(build.passiveMods.some(m => m.source.startsWith(name))).toBe(false);
      expect(warnings.some(w => w.includes(name) && w.includes('각인 해석 못함'))).toBe(true);
    });
});

it.each(['missing stacks', 'zero stacks', 'zero duration'])('does not invent Adrenaline stacks: %s', change => {
  const value = input('아드레날린'), effect = value.engravings.ArkPassiveEffects[0]!;
  effect.Description = strip(effect.Description);
  if (change === 'missing stacks') effect.Description = effect.Description.replace(' (최대 6중첩)', '');
  if (change === 'zero stacks') effect.Description = effect.Description.replace('최대 6중첩', '최대 0중첩');
  if (change === 'zero duration') effect.Description = effect.Description.replace('6초 동안', '0초 동안');
  expect(buildFromArmory(value).build.passiveMods.some(m => m.source.startsWith('아드레날린'))).toBe(false);
});

it('does not apply Mass Increase with its attack-speed reduction missing', () => {
  const value = input('질량 증가');
  value.engravings.ArkPassiveEffects[0]!.Description = '적에게 주는 피해가 19.75% 증가한다.';
  expect(buildFromArmory(value).build.passiveMods.some(m => m.source.startsWith('질량 증가'))).toBe(false);
});

it('does not inject a malformed Raid Captain ratio', () => {
  const value = input('돌격대장');
  value.engravings.ArkPassiveEffects[0]!.Description = '이동속도 증가량의 1.2.3% 만큼 적에게 주는 피해량이 증가한다.';
  expect(buildFromArmory(value).build.params.raidCaptainRatio).toBe(0);
});
