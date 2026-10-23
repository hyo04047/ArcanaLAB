import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const load = (file: string) => JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/' + file + '.json', 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'),
  arkpassive: load('arkpassive'), arkgrid: null, engravings: null, gems: null };
const names = ['끝없는 마나', '무한한 마력', '최적화 훈련', '타이밍 지배'];
function input(name: string) {
  const result = structuredClone(raw);
  const node = structuredClone(raw.arkpassive!.Effects.find(e => e.Description.includes(name === '타이밍 지배' ? '최적화 훈련' : name))!);
  // 타이밍 지배는 기존 쿨감 테스트와 같은 통제 입력이며 공식 수집 표본이 아닙니다.
  if (name === '타이밍 지배') {
    node.Description = '진화 3티어 타이밍 지배 Lv.2';
    node.ToolTip = JSON.stringify({ value: '각성기, 이동 및 기상기를 제외한 스킬의 재사용 대기시간이 10.0% 감소하고, 진화형 피해가 16.0% 증가합니다.' });
  }
  result.arkpassive = { Effects: [node] };
  return result;
}

describe.each(names)('%s import boundary', name => {
  it('keeps the supported cooldown scope and group', () => {
    const { build, warnings } = buildFromArmory(input(name));
    const mods = build.passiveMods.filter(m => m.source.startsWith(name));
    const mana = name === '끝없는 마나' || name === '무한한 마력';
    const cd = mods.find(m => m.bucket === 'cooldown')!;
    expect(cd.filter).toEqual(mana ? { usesMana: true } : { excludeKinds: ['awakening'] });
    expect(cd.cooldownGroup).toBe(mana ? 'manaEvolution' : 'nonAwakeningEvolution');
    expect(cd.value).toBe(name === '타이밍 지배' ? 0.1 : name === '최적화 훈련' ? 0.04 : 0.14);
    expect(mods.filter(m => m.bucket === 'evoDmg').map(m => m.value)).toEqual(
      name === '끝없는 마나' ? [] : [name === '최적화 훈련' ? 0.05 : 0.16]);
    expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(false);
  });

  it.each(['condition', 'suffix', 'separate condition', 'target', 'category', 'tier', 'zero level', 'unsupported level', 'invalid percentage'])(
    'excludes the entire node for unsupported %s', change => {
      const value = input(name), node = value.arkpassive!.Effects[0]!;
      const text = name === '끝없는 마나'
        ? '마나 사용 스킬의 재사용 대기시간이 14.0% 감소하고, 마나 소모량이 20.0% 감소합니다.'
        : name === '무한한 마력'
          ? '진화형 피해가 16.0% 증가하고, 마나 스킬의 재사용 대기시간이 14.0% 감소, 마나 소모량이 16.0% 감소합니다.'
          : `각성기, 이동 및 기상기를 제외한 스킬의 재사용 대기시간이 ${name === '최적화 훈련' ? '4.0' : '10.0'}% 감소하고, 진화형 피해가 ${name === '최적화 훈련' ? '5.0' : '16.0'}% 증가합니다.`;
      if (change === 'condition') node.ToolTip = JSON.stringify({ value: '카드 사용 후 5초 동안 ' + text });
      if (change === 'suffix') node.ToolTip = JSON.stringify({ value: text + ' 마나가 절반 이상일 때만 적용됩니다.' });
      if (change === 'separate condition') node.ToolTip = JSON.stringify({ value: text, condition: '마나가 절반 이상일 때만 적용됩니다.' });
      if (change === 'target') node.ToolTip = JSON.stringify({ value: text.replace(/(?:마나(?: 사용)? 스킬|각성기, 이동 및 기상기를 제외한 스킬)의 재사용/, '각성기의 재사용') });
      if (change === 'category') node.Description = node.Description.replaceAll('진화', '도약');
      if (change === 'tier') node.Description = node.Description.replace(/\d티어/, '5티어');
      if (change === 'zero level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.0');
      if (change === 'unsupported level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.3');
      if (change === 'invalid percentage') node.ToolTip = JSON.stringify({ value: text.replace(/대기시간이 [\d.]+%/, '대기시간이 101.0%') });
      const { build, warnings } = buildFromArmory(value);
      expect(build.passiveMods.filter(m => m.source.startsWith(name))).toEqual([]);
      expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
});
