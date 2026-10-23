import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { damageWarnings, resolveSkillDamage, SKILL_BY_ID } from '../skilldata';
import { SimState, simulate } from '../sim';
import type { Build, SkillDef } from '../types';

const preset = empressInkomsu440();
const dir = resolve(__dirname, '../../../tests/fixtures/armory/FixtureCharacter26');
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, name + '.json'), 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'), arkpassive: load('arkpassive'), arkgrid: load('arkgrid'), engravings: load('engravings'), gems: load('gems') };
const imported = buildFromArmory(raw).build;
const ids = ['celestial_rain', 'secret_garden', 'four_of_a_kind', 'serendipity', 'the_devil'];

function state(id: string, build = preset, extra: Partial<SkillDef> = {}) {
  const skill: SkillDef = { ...build.skills.find(s => s.id === id)!, mods: [], onCast: [], castTime: 1,
    procCritDmg: undefined, defenseIgnore: undefined, cdResetChance: undefined, keepStacksChance: undefined, ...extra };
  return new SimState({ ...build, skills: [skill], passiveMods: [], bluntThorn: undefined,
    onRuinAt4: [], cardDurationBonus: {}, params: { ...build.params, atkBase: 10000,
      gaugePerHit: { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 } } }, createRng(1), cardsFor('empress'));
}

function hit(s: SimState, stacks: number, judgment = false) {
  s.stacks = stacks;
  if (judgment) { s.drawCards(1, 'judgment'); s.useCardNow('judgment'); }
  s.cast(s.build.skills[0]!, 100, 'full');
  return s.breakdown.get(s.build.skills[0]!.id)!;
}

describe('Lv70 ruin candidates through actual hits', () => {
  // S38 기록으로 계산한 고정 검산값입니다. 별도의 인게임 실측값은 아닙니다.
  const expectedNormal = [0, 21505.5, 47885.5, 79332, 161320];
  const expectedDevil = [0, 317078, 705379, 1168568, 2376266.5];

  it.each(ids)('uses the non-linear table for %s on both build paths', id => {
    for (const build of [preset, imported]) {
      for (let stacks = 0; stacks <= 4; stacks++) {
        const s = state(id, build);
        const result = hit(s, stacks);
        expect(result.stackEffect).toBeCloseTo((id === 'the_devil' ? expectedDevil : expectedNormal)[stacks]!, 7);
        expect(s.stacks).toBe(0);
        expect(s.ruinAt4).toBe(stacks === 4 ? 1 : 0);
        expect(s.total).toBeCloseTo(result.direct + result.stackEffect, 7);
      }
    }
  });

  it.each(['preset', 'armory'])('keeps explosion unchanged at skill Lv10 and Lv14 via %s', path => {
    const results = [10, 14].map(level => {
      const input = structuredClone(raw);
      input.combatSkills.find(s => s.Name === '셀레스티얼 레인')!.Level = level;
      const build = path === 'armory' ? buildFromArmory(input).build : preset;
      return hit(state('celestial_rain', build, path === 'preset'
        ? resolveSkillDamage(SKILL_BY_ID.get('celestial_rain')!, level) : {}), 4);
    });
    expect(results.map(r => r.stackEffect)).toEqual([161320, 161320]);
    expect(results[0]!.direct).toBeCloseTo(39315.5, 7);
    expect(results[1]!.direct).toBeCloseTo(47885.5, 7);
  });

  it.each(ids)('uses four-stack damage under judgment for %s at any actual stack', id => {
    for (let stacks = 0; stacks <= 4; stacks++) {
      const s = state(id);
      expect(hit(s, stacks, true).stackEffect).toBeCloseTo(id === 'the_devil' ? 2376266.5 : 161320 * (id === 'serendipity' ? 3 : 1), 7);
      expect(s.stacks).toBe(0);
      expect(s.ruinAt4).toBe(1);
    }
  });

  it.each(['celestial_rain', 'the_devil'])('uses judgment at hit time for %s, excluding expiration', id => {
    for (const time of [3.999, 4, 4.001]) {
      const s = state(id);
      s.drawCards(1, 'judgment'); s.useCardNow('judgment');
      s.now = time - 1;
      const result = hit(s, 2);
      const expected = id === 'the_devil' ? expectedDevil : expectedNormal;
      expect(result.stackEffect).toBeCloseTo(expected[time < 4 ? 4 : 2]!, 7);
    }
  });

  it('does not multiply candidates by any legacy stack or skill scaling', () => {
    for (const id of ids) {
      const build = { ...preset, params: { ...preset.params, stackEffectCoefPerStack: 999999, stackEffectScale: [0, 7, 9, 13, 99] } };
      const result = hit(state(id, build, { stackEffectMultiplier: 77 }), 4);
      expect(result.stackEffect).toBeCloseTo(id === 'the_devil' ? 2376266.5 : 161320, 7);
    }
  });

  it.each(['celestial_rain', 'the_devil'])('separates flat damage, attack modifiers and stack-only damage for %s', id => {
    const s = state(id);
    s.build.passiveMods = [
      { bucket: 'atkFlat', value: 1000, source: 'test' }, { bucket: 'atk', value: 0.2, source: 'test' },
      { bucket: 'stackEffectDmg', value: 0.5, source: 'test', filter: { minStacks: 4 } },
      { bucket: 'critRate', value: 1, source: 'test' },
    ];
    const result = hit(s, 0, true);
    const expected = id === 'the_devil' ? (35056.5 + 234.121 * 13200) * 1.5 * 2 : (2380 + 15.894 * 13200) * 1.5 * 2;
    expect(result.stackEffect).toBeCloseTo(expected, 7);
    const skill = s.build.skills[0]!;
    expect(result.direct).toBeCloseTo(((skill.directFlat ?? 0) + skill.directCoef * 13200) * 2, 7);
  });

  it('does not explode or consume stacks when the hit is beyond the fight end', () => {
    const s = state('the_devil');
    s.stacks = 4;
    s.cast(s.build.skills[0]!, 0.5);
    expect(s.total).toBe(0);
    expect(s.stacks).toBe(4);
    expect(s.ruinCasts).toBe(0);
  });

  it('does not add a ruin effect to Sun under judgment', () => {
    const s = state('the_devil', preset, { id: 'the_sun', kind: 'hyper_awakening', tags: ['normal'] });
    expect(hit(s, 4, true).stackEffect).toBe(0);
    expect(s.stacks).toBe(4);
  });

  it.each([undefined, 55, 60, 65, 69, 71])('keeps explicit legacy fallback at unsupported combat level %s', combatLevel => {
    const build = { ...preset, combatLevel };
    expect(hit(state('celestial_rain', build), 4).stackEffect).toBe(24000000);
    expect(damageWarnings(build).some(w => w.includes('스택트 효과') && w.includes('Lv70 후보 미적용') && w.includes('임시값'))).toBe(true);
  });

  it('does not silently apply a generic candidate to an unregistered ruin', () => {
    const s = state('celestial_rain', preset, { id: 'unknown_ruin', name: '미등록 루인' });
    expect(hit(s, 4).stackEffect).toBe(24000000);
    expect(damageWarnings(s.build).some(w => w.includes('미등록 루인') && w.includes('임시값'))).toBe(true);
  });

  it('reports Lv70 candidate use and remaining limits in results', () => {
    for (const build of [preset, imported]) {
      const warnings = simulate(build, [], { seed: 1, durationSec: 3, iterations: 1 }).damageWarnings;
      expect(warnings.some(w => w.includes('스택트 효과') && w.includes('Lv70') && w.includes('후보') && w.includes('실측 미검증'))).toBe(true);
      expect(warnings.some(w => w.includes('스택트 효과') && w.includes('기존 임시값 사용'))).toBe(false);
    }
  });
});
