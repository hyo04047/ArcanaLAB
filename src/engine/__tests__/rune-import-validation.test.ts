import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const load = (file: string) => JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/' + file + '.json', 'utf8'));
const skills: RawArmory['combatSkills'] = load('combat-skills');
type Rune = NonNullable<RawArmory['combatSkills'][number]['Rune']>;
function convert(rune: Rune | null) {
  const skill = structuredClone(skills.find(s => s.Name === '셀레스티얼 레인')!);
  skill.Tripods = []; skill.Rune = rune;
  return buildFromArmory({ profiles: load('profiles'), combatSkills: [skill], arkpassive: null,
    arkgrid: null, engravings: null, gems: null });
}
const base = convert(null).build.skills[0]!;
const effects: Record<string, string> = {
  질풍: '스킬 시전 속도가 14% 증가',
  풍요: '스킬 적중 시 아이덴티티 게이지 획득량 40% 증가',
  속행: '스킬 사용 시 일정 확률로 전체 재사용 대기 시간이 16% 감소',
};

describe('Rune tooltip import', () => {
  it.each(['광분', '집중', '수호', '정화', '압도', '철벽', '비전', '알 수 없는 룬'])(
    'reports unsupported %s without inventing an effect', name => {
      const result = convert({ Name: name, Grade: '전설', Tooltip: JSON.stringify({ value: '아직 지원하지 않는 효과' }) });
      expect(result.build.skills[0]).toEqual(base);
      expect(result.warnings).toContainEqual(expect.stringContaining(`룬 ${name} 미모델`));
    });

  it.each([['질풍', '전설', 14], ['질풍', '영웅', 12], ['풍요', '전설', 40], ['속행', '전설', 16], ['속행', '영웅', 12]] as const)(
    'keeps the recorded %s %s value %s', (name, grade, value) => {
      const rune = skills.find(s => s.Rune?.Name === name && s.Rune.Grade === grade)!.Rune!;
      const result = convert(rune), skill = result.build.skills[0]!;
      if (name === '질풍') expect(skill.castTime).toBeCloseTo(base.castTime / (1 + value / 100));
      if (name === '풍요') expect(skill.gaugeMultiplier).toBeCloseTo(1 + value / 100);
      if (name === '속행') {
        expect(skill.runeCdReduce).toEqual({ chance: 0.2, fraction: value / 100 });
        expect(result.warnings.some(w => w.includes('속행 발동 확률 [미확인] 20% 가정'))).toBe(true);
      }
      expect(result.warnings.some(w => w.includes(`룬 ${name} 해석 못함`))).toBe(false);
    });

  describe.each(Object.keys(effects))('%s missing or unsupported tooltip', name => {
    it.each(['missing', 'empty', 'wrong effect', 'prefix condition', 'suffix condition', 'over 100', 'malformed number'])(
      'does not invent a rune effect for %s', change => {
        let text = effects[name]!;
        if (change === 'empty') text = '';
        if (change === 'wrong effect') text = '공격력이 30% 증가하고 받는 피해가 10% 감소';
        if (change === 'prefix condition') text = '마나가 절반 이상이면 ' + text;
        if (change === 'suffix condition') text += ' (카드 사용 후에만 적용)';
        if (change === 'over 100') text = text.replace(/\d+%/, '101%');
        if (change === 'malformed number') text = text.replace(/\d+%/, '1.2.3%');
        const result = convert({ Name: name, Grade: '영웅', ...(change === 'missing' ? {} : { Tooltip: JSON.stringify({ value: text }) }) });
        expect(result.build.skills[0]).toEqual(base);
        expect(result.warnings.some(w => w.includes(`룬 ${name} 해석 못함`) && w.includes('미반영'))).toBe(true);
      });
  });
});
