import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip, tooltipLines } from '../tooltip';

const load = (file: string) => JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/' + file + '.json', 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'), arkpassive: load('arkpassive'),
  arkgrid: null, engravings: null, gems: null };
const names = ['황후의 계략', '황후의 탐욕', '황후의 연회', '황후의 속삭임', '황제의 자비'];
const empty = buildFromArmory({ ...raw, arkpassive: null }).build;
function input(name: string) {
  return { ...raw, arkpassive: { Effects: [structuredClone(raw.arkpassive!.Effects.find(e => e.Description.includes(name))!)] } };
}

describe.each(names)('%s complete input', name => {
  it('preserves the official target, resource change or trigger', () => {
    const { build, warnings } = buildFromArmory(input(name));
    const mods = build.passiveMods.filter(m => m.source.startsWith(name));
    if (name === '황후의 계략') expect(build.cardDurationBonus).toEqual({ cull: 2, judgment: 2 });
    if (name === '황후의 탐욕') {
      expect(mods).toEqual([{ bucket: 'skillDmg', value: 0.009000000000000001, filter: { kinds: ['ruin'] }, source: '황후의 탐욕 Lv1' }]);
      expect(build.params.gaugeGainBonus - empty.params.gaugeGainBonus).toBeCloseTo(0.04);
      expect(build.params.normalGaugePenalty - empty.params.normalGaugePenalty).toBe(-0.5);
    }
    if (name === '황후의 연회') expect(mods).toEqual([{ bucket: 'skillDmg', value: 0.26, filter: { kinds: ['ruin'], minStacks: 4 }, source: '황후의 연회 Lv3' }]);
    if (name === '황후의 속삭임') {
      expect(mods.map(m => [m.bucket, m.value, m.filter])).toEqual([
        ['skillDmg', 0.2, { kinds: ['ruin'] }], ['cooldown', 0.06, { kinds: ['normal', 'stack'] }],
      ]);
      expect(build.onRuinAt4).toEqual([{ id: 'whisper_as', duration: 6, mod: { bucket: 'atkSpeed', value: 0.08, source: '황후의 속삭임 Lv3' } }]);
    }
    if (name === '황제의 자비') expect(build.onCardUse).toEqual([{ id: 'mercy', duration: 8, mod: { bucket: 'dmgToEnemy', value: 0.012, source: '황제의 자비 Lv1' } }]);
    expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(false);
  });

  it.each(['prefix', 'suffix', 'separate condition', 'reversed effect', 'category', 'tier', 'zero level', 'unsupported level', 'invalid number', 'missing description'])(
    'does not partially apply unsupported %s', change => {
      const value = input(name), node = value.arkpassive.Effects[0]!;
      node.Description = strip(node.Description);
      const text = tooltipLines(node.ToolTip).filter(t => t !== name && !['깨달음', 'NameTagBox', 'CommonSkillTitle', 'MultiTextBox'].includes(t) && !/^아크 패시브 레벨/.test(t)).join(' ').replace(/\|\|/g, ' ').trim();
      if (change === 'prefix') node.ToolTip = JSON.stringify({ value: '마나가 절반 이상일 때 ' + text });
      if (change === 'suffix') node.ToolTip = JSON.stringify({ value: text + ' 마나가 절반 이상일 때만 적용됩니다.' });
      if (change === 'separate condition') node.ToolTip = JSON.stringify({ value: text, condition: '마나가 절반 이상일 때만 적용됩니다.' });
      if (change === 'reversed effect') node.ToolTip = JSON.stringify({ value: text.replace('증가', '감소') });
      if (change === 'category') node.Description = node.Description.replace('깨달음', '진화');
      if (change === 'tier') node.Description = node.Description.replace(/\d티어/, '5티어');
      if (change === 'zero level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.0');
      if (change === 'unsupported level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.9');
      if (change === 'invalid number') node.ToolTip = JSON.stringify({ value: text.replace(/[\d.]+(?:%|초)/, '1.2.3%') });
      if (change === 'missing description') node.ToolTip = '';
      const { build, warnings } = buildFromArmory(value);
      expect(build).toEqual(empty);
      expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
});

it.each(['황후의 계략', '황후의 탐욕', '황후의 속삭임', '황제의 자비'])('does not guess a missing clause or duration for %s', name => {
  const value = input(name), node = value.arkpassive.Effects[0]!;
  const text = name === '황후의 계략' ? '카드덱에 도태 카드의 지속시간이 2.0초 증가한다.'
    : name === '황후의 탐욕' ? '루인 스킬의 피해량이 0.9% 증가하며 덱 게이지 획득량이 4.0% 증가한다.'
      : name === '황후의 속삭임' ? '루인 스킬의 피해량이 20.0% 증가하며 일반 스킬과 스택트 스킬의 재사용 대기시간이 6.0% 감소한다. 추가로 4스택 이상인 적에게 루인 스킬 적중 시 자신의 공격속도를 8.0% 증가 시키는 효과를 추가한다.'
        : '카드 사용 시 적에게 주는 피해가 1.2% 증가한다. 또한 이동기의 재사용 대기 시간이 즉시 1.0초 감소한다.';
  node.ToolTip = JSON.stringify({ value: text });
  const { build, warnings } = buildFromArmory(value);
  expect(build).toEqual(empty);
  expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
});
