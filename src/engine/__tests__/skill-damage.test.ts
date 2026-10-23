import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { empressInkomsu440 } from '../presets';
import { directCoef, SKILL_BY_ID } from '../skilldata';
import { simulate, SimState } from '../sim';
import { createRng } from '../rng';

const dir = resolve(__dirname, '../../../tests/fixtures/armory/FixtureCharacter26');
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, name + '.json'), 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'), arkpassive: load('arkpassive'), arkgrid: load('arkgrid'), engravings: load('engravings'), gems: load('gems') };
const skill = (id: string) => SKILL_BY_ID.get(id)!;

describe('skill level and damage basis', () => {
  it.each([[1, 207], [7, 722], [10, 825]])('selects Call of Destiny tooltip at level %i', (level, expected) => {
    expect(directCoef(skill('call_of_destiny'), level)).toBe(expected);
  });

  it.each([11, 12, 13, 14])('does not claim a known coefficient for level %i', level => {
    expect(directCoef(skill('call_of_destiny'), level)).toBeUndefined();
  });

  it('excludes Rain airborne-only damage against the modeled boss', () => {
    expect(directCoef(skill('celestial_rain'), 1)).toBe(178);
    expect(directCoef(skill('celestial_rain'), 10)).toBe(705);
    for (const build of [empressInkomsu440(), buildFromArmory(raw).build]) {
      expect(build.skills.find(s => s.id === 'celestial_rain')!.hits).toBe(1);
    }
  });

  it.each([
    ['quadra_accelerate', 1008], ['dancing_of_spineflower', 2455],
    ['unlimited_shuffle', 3609], ['stream_of_edge', 88],
  ])('sums each tooltip component once with its stated hit count: %s', (id, expected) => {
    expect(directCoef(skill(id), 10)).toBe(expected);
  });

  it('preserves combat and skill levels and uses the selected supported level', () => {
    const changed = structuredClone(raw);
    changed.combatSkills.find(s => s.Name === '운명의 부름')!.Level = 7;
    const { build } = buildFromArmory(changed);
    expect(build.combatLevel).toBe(70);
    const call = build.skills.find(s => s.id === 'call_of_destiny')!;
    expect(call.level).toBe(7);
    expect(call.directCoef).toBe(2.616);
    expect(call.directFlat).toBe(432);
    expect(call.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level: 7, effectIds: [191823] });
  });

  it('labels Four level 14 as a public candidate instead of the former tooltip fallback', () => {
    const { build, warnings } = buildFromArmory(raw);
    const four = build.skills.find(s => s.id === 'four_of_a_kind')!;
    expect(four.level).toBe(14);
    expect(four.directCoef).toBe(4.243);
    expect(four.directFlat).toBe(636.5);
    expect(four.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level: 14, effectIds: [191600] });
    expect(warnings.some(w => w.includes('포 카드 Lv14') && w.includes('공개 자료 후보'))).toBe(true);
  });

  it('keeps the actual T skill level when connecting its public coefficient candidate', () => {
    const { build, warnings } = buildFromArmory(raw);
    const devil = build.skills.find(s => s.id === 'the_devil')!;
    expect(devil.level).toBe(1);
    expect(devil.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level: 1, effectIds: [193501] });
    expect(warnings.some(w => w.includes('더 데빌') && w.includes('공개 자료 후보'))).toBe(true);
    expect(warnings.some(w => w.includes('표시 Lv1') && w.includes('피해 배열') && w.includes('확인하지 못'))).toBe(true);
  });

  it('does not add a historical Devil buff to only the manual preset', () => {
    for (const b of [empressInkomsu440(), buildFromArmory(raw).build]) {
      expect(b.skills.find(s => s.id === 'the_devil')!.mods?.some(m => m.source.includes('2025-12-10')) ?? false).toBe(false);
    }
  });

  it('does not change stack-effect scaling when only skill level changes', () => {
    const hit = (level: number) => {
      const changed = structuredClone(raw);
      changed.combatSkills.find(s => s.Name === '셀레스티얼 레인')!.Level = level;
      const { build } = buildFromArmory(changed);
      const rain = build.skills.find(s => s.id === 'celestial_rain')!;
      const state = new SimState({ ...build, passiveMods: [], skills: [rain], bluntThorn: undefined }, createRng(1), []);
      state.stacks = 4;
      state.cast(rain, 10);
      return state.breakdown.get(rain.id)!;
    };
    const low = hit(7), high = hit(10);
    expect(high.direct).toBeGreaterThan(low.direct);
    expect(high.stackEffect).toBe(low.stackEffect);
  });

  it('includes unresolved damage bases in simulation results from both build paths', () => {
    for (const build of [empressInkomsu440(), buildFromArmory(raw).build]) {
      const summary = simulate(build, [], { iterations: 2, durationSec: 3, seed: 1 });
      expect(summary.damageWarnings.some(w => w.includes('정규화'))).toBe(true);
      expect(summary.damageWarnings.some(w => w.includes('각성기') && w.includes('카드 수급') && w.includes('부분 모델'))).toBe(true);
      expect(summary.damageWarnings.some(w => w.includes('표시 Lv1') && w.includes('피해 배열'))).toBe(true);
      expect(summary.damageWarnings.some(w => w.includes('Lv14') && w.includes('공개 자료 후보'))).toBe(true);
      expect(summary.damageWarnings.some(w => w.includes('스택트 효과') && w.includes('Lv70 공개 계수 후보') && w.includes('실측 미검증'))).toBe(true);
    }
  });
});
