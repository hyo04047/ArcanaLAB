import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers, expectedMultiplier, rollHit } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { damageWarnings, resolveSkillDamage, SKILL_BY_ID } from '../skilldata';
import { SimState } from '../sim';
import type { Modifier, SkillDef } from '../types';

const row = (id: string) => SKILL_BY_ID.get(id)!;
const probe: SkillDef = { id: 'probe', name: 'probe', kind: 'normal', cooldown: 1, castTime: 0, directCoef: 2, directFlat: 100, hits: 1 };
const context = { skill: probe, stacks: 4, component: 'direct' as const };

describe('separate flat damage and attack power', () => {
  it('scales only the coefficient term with additive attack buffs', () => {
    const m = computeMultipliers({ atkBase: 1000 }, [
      { bucket: 'atk', value: 0.1, source: 'a' }, { bucket: 'atk', value: 0.2, source: 'b' },
    ], context);
    expect(m.atk).toBe(1300);
    expect(m.nonCrit).toBe(1);
    expect(rollHit(createRng(1), 2, m, 100).dmg).toBe(2700);
  });

  it('keeps the flat term at zero attack without division by zero', () => {
    const m = computeMultipliers({ atkBase: 0 }, [{ bucket: 'atk', value: 0.5, source: 'a' }], context);
    expect(rollHit(createRng(1), 2, m, 100).dmg).toBe(100);
  });

  it.each([0, 1])('applies damage buckets and crit to both terms, crit=%s', crit => {
    const mods: Modifier[] = [
      { bucket: 'atk', value: 0.2, source: 'attack' },
      { bucket: 'addDmg', value: 0.1, source: 'additional' },
      { bucket: 'evoDmg', value: 0.2, source: 'evolution' },
      { bucket: 'dmgToEnemy', value: 0.3, source: 'enemy' },
      { bucket: 'skillDmg', value: 0.5, source: 'tripod' },
      { bucket: 'stackEffectDmg', value: 9, source: 'must not enter direct' },
      { bucket: 'critRate', value: crit, source: 'critical' },
      { bucket: 'critDmg', value: 0.4, source: 'critical damage' },
      { bucket: 'critHitDmg', value: 0.12, source: 'critical only' },
    ];
    const hit = rollHit(createRng(1), 2, computeMultipliers({ atkBase: 1000 }, mods, context), 100);
    expect(hit.crit).toBe(Boolean(crit));
    expect(hit.dmg).toBeCloseTo(2500 * 1.1 * 1.2 * 1.3 * 1.5 * (crit ? 2.4 * 1.12 : 1), 8);
  });

  it('preserves the zero-flat path used by placeholder stack and card damage', () => {
    const m = computeMultipliers({ atkBase: 1000 }, [
      { bucket: 'atk', value: 0.2, source: 'attack' }, { bucket: 'skillDmg', value: 0.5, source: 'skill' },
    ], context);
    expect(rollHit(createRng(1), 2, m).dmg).toBe(3600);
    expect(expectedMultiplier(m)).toBe(1800);
  });
});

// 공개 자료의 기본식으로 따로 계산한 비교값입니다. 게임 실측값이 아닙니다.
const cases = [
  ['celestial_rain', 1, 178, 2.970, [29878, 148678, 297178]],
  ['celestial_rain', 10, 705.5, 3.861, [39315.5, 193755.5, 386805.5]],
  ['celestial_rain', 14, 705.5, 4.718, [47885.5, 236605.5, 472505.5]],
  ['stream_of_edge', 1, 22, 0.362, [3642, 18122, 36222]],
  ['stream_of_edge', 10, 88, 0.469, [4778, 23538, 46988]],
  ['stream_of_edge', 14, 88, 0.573, [5818, 28738, 57388]],
] as const;

describe('Rain and Stream public coefficient candidates', () => {
  it.each(cases)('selects and reproduces %s level %s at three attack powers', (id, level, flat, coefficient, expected) => {
    const selected = resolveSkillDamage(row(id), level);
    expect(selected.directFlat).toBe(flat);
    expect(selected.directCoef).toBe(coefficient);
    expect(selected.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level });
    [10000, 50000, 100000].forEach((atkBase, index) => {
      const m = computeMultipliers({ atkBase }, [], context);
      expect(rollHit(createRng(1), selected.directCoef, m, selected.directFlat).dmg).toBeCloseTo(expected[index]!, 8);
    });
  });

  it.each([0, 1.5, 21])('marks unsupported level %s as fallback with no retained flat term', level => {
    const selected = resolveSkillDamage(row('celestial_rain'), level);
    expect(selected.directFlat).toBe(0);
    expect(selected.directCoef).toBe(705);
    expect(selected.damageReference).toEqual({ source: 'codex-tooltip', level: 10 });
  });

  it('keeps an awakening without a connected coefficient source missing', () => {
    const selected = resolveSkillDamage(row('prismatic_mirror'), 1);
    expect(selected.directFlat).toBe(0);
    expect(selected.directCoef).toBe(0);
    expect(selected.damageReference).toEqual({ source: 'missing' });
  });

  const dir = resolve(__dirname, '../../../tests/fixtures/armory/FixtureCharacter26');
  const load = (name: string) => JSON.parse(readFileSync(resolve(dir, name + '.json'), 'utf8'));
  const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'), arkpassive: load('arkpassive'), arkgrid: load('arkgrid'), engravings: load('engravings'), gems: load('gems') };

  it.each(['preset', 'armory'])('uses total base damage once through %s casts', path => {
    const build = path === 'preset' ? empressInkomsu440() : buildFromArmory(raw).build;
    for (const [id, expected] of [['celestial_rain', 47885.5], ['stream_of_edge', 4778]] as const) {
      const skill = { ...build.skills.find(s => s.id === id)!, mods: [], onCast: [], onHit: [], tags: [] };
      const state = new SimState({ ...build, passiveMods: [], bluntThorn: undefined, skills: [skill], params: { ...build.params, atkBase: 10000 } }, createRng(1), []);
      state.cast(skill, 10);
      state.advanceTo(10);
      expect(state.breakdown.get(id)!.direct).toBeCloseTo(expected, 8);
      expect(state.breakdown.get(id)!.stackEffect).toBe(0);
    }
  });

  it('retains source limits and attack basis warnings on both build paths', () => {
    for (const build of [empressInkomsu440(), buildFromArmory(raw).build]) {
      const warnings = damageWarnings(build);
      expect(warnings.some(w => w.includes('셀레스티얼 레인') && w.includes('후보') && w.includes('실측'))).toBe(true);
      expect(warnings.some(w => w.includes('스트림 오브 엣지') && w.includes('후보'))).toBe(true);
      expect(warnings.some(w => w.includes(`공격력 입력값 ${build.params.atkBase}:`) && w.includes('정규화'))).toBe(true);
      expect(warnings.some(w => w.includes('셀레스티얼 레인') && w.includes('Lv10 대체값'))).toBe(false);
    }
  });
});
