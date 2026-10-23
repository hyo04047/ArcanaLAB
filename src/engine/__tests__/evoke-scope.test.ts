import { coreTestPassives, coreTestTooltip } from './core-fixture';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { damageWarnings } from '../skilldata';
import type { Modifier, SkillDef } from '../types';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-evoke-overlap-sources.json', 'utf8')).official.skill;
// S56 작성자 인용 툴팁입니다. 공식 API에서 확보한 스피드 메이트 응답으로 오인하지 않습니다.
const clause = "이보크의 재사용 대기 시간이 10.0초 증가하지만, '마나 중독' 트라이포드 적용 시 마나 중독 피해량이 100% 증가한다.";
function input(point = 14, poison = true, text = clause): RawArmory {
  const selected = ['빠른 준비', poison ? '마나 중독' : '집속 마법진', '중첩 마법진'];
  return { profiles: JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8')),
    combatSkills: [{ ...source, Level: 14, Tripods: source.Tripods.map((t: { Name: string }) => ({ ...t, IsSelected: selected.includes(t.Name) })) }],
    arkpassive: coreTestPassives(true), engravings: null, gems: null,
    arkgrid: { Slots: [{ Index: 2, Name: '질서의 별 코어 : 스피드 메이트', Point: point,
      Tooltip: coreTestTooltip(`[10P] 체크메이트의 홀딩 속도가 30.0% 증가한다. [14P] ${text}`, true) }] } };
}
const mult = (mods: Modifier[], skill: SkillDef, component: 'direct' | 'dot') =>
  computeMultipliers({ atkBase: 100 }, mods, { skill, component, stacks: 0 });

describe('Evoke poison effect scope', () => {
  it('applies the two core clauses separately: flat cooldown and poison-only damage', () => {
    const off = buildFromArmory(input(13)).build;
    const result = buildFromArmory(input()); const on = result.build;
    expect(on.skills[0]!.cooldown - off.skills[0]!.cooldown).toBe(10);
    const mods = on.passiveMods.filter(m => m.source === '스피드 메이트 14P');
    expect(mult(mods, on.skills[0]!, 'dot').skillDmg).toBe(2);
    expect(mult(mods, on.skills[0]!, 'direct').skillDmg).toBe(1);
    expect(mult(mods, { ...on.skills[0]!, id: 'other' }, 'dot').skillDmg).toBe(1);
    expect(result.warnings.some(w => w.includes('스피드 메이트 14P'))).toBe(false);
    expect(result.warnings.some(w => w.includes('스피드 메이트 10P') && w.includes('미반영'))).toBe(true);
  });
  it('still increases cooldown without poison, but never invents a DOT', () => {
    const on = buildFromArmory(input(14, false)).build;
    const off = buildFromArmory(input(13, false)).build;
    expect(on.skills[0]!.cooldown - off.skills[0]!.cooldown).toBe(10);
    expect(on.skills[0]!.manaPoison).toBeUndefined();
  });
  it('rejects unknown conditional text without applying a convenient substring', () => {
    const result = buildFromArmory(input(14, true, clause.replace('적용 시', '적용 후 치명타 적중 시')));
    expect(result.build.skills[0]!.cooldown).toBe(buildFromArmory(input(13)).build.skills[0]!.cooldown);
    expect(result.build.passiveMods.some(m => m.source === '스피드 메이트 14P')).toBe(false);
    expect(result.warnings.some(w => w.includes('스피드 메이트 14P') && w.includes('미반영'))).toBe(true);
  });
  it('reads tooltip numbers instead of assuming every future grade has the same values', () => {
    const result = buildFromArmory(input(14, true, clause.replace('10.0초', '8.0초').replace('100%', '75.0%'))).build;
    expect(result.skills[0]!.cooldown - buildFromArmory(input(13)).build.skills[0]!.cooldown).toBe(8);
    expect(mult(result.passiveMods.filter(m => m.source === '스피드 메이트 14P'), result.skills[0]!, 'dot').skillDmg).toBe(1.75);
  });
  it('distinguishes a damage gem exclusion from unknown modern skill effects', () => {
    const raw = input(13);
    raw.gems = { Effects: { Skills: [{ Name: '이보크', Description: ['피해 44.00% 증가', '재사용 대기시간 24.00% 감소'] }] } };
    raw.engravings = { ArkPassiveEffects: ['타격의 대가', '마나 효율 증가'].map(Name => ({ Name, Grade: '유물', Level: 4,
      AbilityStoneLevel: null, Description: Name === '타격의 대가'
        ? '공격 타입이 백 어택 및 헤드 어택에 해당되지 않는 공격의 피해가 17.00% 증가한다. 각성기는 해당 효과가 적용되지 않는다.'
        : '마나 회복 속도가 20.00% 증가하며, 마나를 사용하는 스킬이 적에게 주는 피해가 19.75% 증가한다.' })) };
    const result = buildFromArmory(raw); const s = result.build.skills[0]!;
    const gem = result.build.passiveMods.filter(m => m.source === '보석 이보크');
    expect(mult(gem, s, 'direct').skillDmg).toBeCloseTo(1.44);
    expect(mult(gem, s, 'dot').skillDmg).toBe(1);
    expect(gem.find(m => m.bucket === 'cooldown')!.value).toBe(0.24);
    const warnings = result.warnings.filter(w => w.startsWith('마나 중독 적용 미확인'));
    expect(warnings).toHaveLength(1);
    expect(result.warnings.some(w => w.startsWith('타격의 대가:') && w.includes('도트 적용은 미확인·임시 제외'))).toBe(true);
    expect(warnings[0]).toContain('마나 효율 증가');
    expect(warnings[0]).not.toContain('보석'); expect(warnings[0]).not.toContain('마나 중독(Lv');
  });
  it('does not warn about damage effects targeting a different skill or direct hits', () => {
    const b = buildFromArmory(input()).build;
    b.passiveMods.push({ bucket: 'skillDmg', value: 0.2, filter: { ids: ['checkmate'] }, source: '다른 스킬' },
      { bucket: 'skillDmg', value: 0.2, filter: { component: 'direct' }, source: '직접 전용' });
    expect(damageWarnings(b).some(w => w.startsWith('마나 중독 적용 미확인'))).toBe(false);
  });
  it('can represent confirmed inclusion or exclusion without changing the arithmetic bucket', () => {
    const s = buildFromArmory(input()).build.skills[0]!;
    const m: Modifier = { bucket: 'skillDmg', value: 0.2, source: '합성 범위 검사', dotScope: 'include' };
    expect(mult([m], s, 'dot').skillDmg).toBe(1.2);
    expect(mult([{ ...m, dotScope: 'exclude' }], s, 'dot').skillDmg).toBe(1);
    expect(mult([{ ...m, dotScope: 'exclude' }], s, 'direct').skillDmg).toBe(1.2);
    expect(mult([{ ...m, filter: { ids: ['other'] } }], s, 'dot').skillDmg).toBe(1);
  });
});
