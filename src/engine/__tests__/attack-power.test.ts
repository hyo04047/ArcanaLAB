import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { createRng } from '../rng';
import { SimState } from '../sim';

const dir = resolve(__dirname, '../../../tests/fixtures/armory/FixtureCharacter26');
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, name + '.json'), 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), equipment: load('equipment'), combatSkills: load('combat-skills'), arkpassive: load('arkpassive'), arkgrid: load('arkgrid'), engravings: load('engravings'), gems: load('gems') };
const withoutAdrenaline = () => ({ ...structuredClone(raw), engravings: null });
const attack = (build: ReturnType<typeof buildFromArmory>['build']) => computeMultipliers(
  { atkBase: build.params.atkBase }, build.passiveMods,
  { skill: build.skills.find(s => s.id === 'celestial_rain')!, stacks: 4, component: 'direct' },
).atk;

describe('armory attack power decomposition', () => {
  it('reconstructs the displayed attack from base, flat core, and static percentages', () => {
    const { build } = buildFromArmory(withoutAdrenaline());
    expect(build.params.atkBase).toBe(158137);
    expect(build.attackPower).toMatchObject({ displayed: 171684, base: 158137, increase: 13547, status: 'matched-display' });
    expect(attack(build)).toBeCloseTo(171683.8255, 7);
    expect(build.passiveMods.filter(m => m.bucket === 'atkFlat').reduce((a, m) => a + m.value, 0)).toBe(3600);
    expect(build.passiveMods.filter(m => m.bucket === 'atk').reduce((a, m) => a + m.value, 0)).toBeCloseTo(0.0615);
  });

  it('uses the aggregate gem attack once rather than adding individual values again', () => {
    const { build } = buildFromArmory(withoutAdrenaline());
    const gems = build.passiveMods.filter(m => m.bucket === 'atk' && m.source.startsWith('젬'));
    expect(gems).toHaveLength(1);
    expect(gems[0]!.value).toBeCloseTo(0.0205);
  });

  it('adds combat adrenaline after snapshot validation, not into the profile base', () => {
    const { build } = buildFromArmory(raw);
    expect(build.attackPower?.status).toBe('matched-display');
    expect(attack(build)).toBeCloseTo(180417.6235, 7);
  });

  it('reaches the separated damage path using the reconstructed attack', () => {
    const { build } = buildFromArmory(withoutAdrenaline());
    const rain = { ...build.skills.find(s => s.id === 'celestial_rain')!, mods: [], onCast: [] };
    const state = new SimState({ ...build, skills: [rain], bluntThorn: undefined,
      passiveMods: build.passiveMods.filter(m => m.bucket === 'atk' || m.bucket === 'atkFlat') }, createRng(1), []);
    state.cast(rain, 10);
    expect(state.breakdown.get(rain.id)!.direct).toBeCloseTo(705.5 + 4.718 * 171683.8255, 7);
  });

  it('keeps static flat attack separate so a core downgrade changes both terms', () => {
    const input = withoutAdrenaline();
    input.arkgrid!.Slots.find(s => s.Name.endsWith(' : 공격'))!.Point = 14;
    const { build, warnings } = buildFromArmory(input);
    expect(attack(build)).toBeCloseTo((158137 + 900) * 1.045, 7);
    expect(build.attackPower?.status).toBe('mismatch');
    expect(warnings.some(w => w.includes('공격력 재구성 불일치'))).toBe(true);
  });

  it('does not treat weapon, base or ally attack as ordinary attack options', () => {
    const input = withoutAdrenaline();
    input.equipment = [{ Type: '귀걸이', Tooltip: JSON.stringify({ effect: { type: 'ItemPartBox', value: {
      Element_000: '연마 효과', Element_001: ['무기 공격력 +99.00%', '기본 공격력 +80.00%', '아군 공격력 강화 효과 +90.00%', '공격력 +0.95%'].map(text => `<img src='option'>${text}`).join('<br>'),
    } } }) }];
    const { build } = buildFromArmory(input);
    const accessory = build.passiveMods.filter(m => m.source.startsWith('장신구'));
    expect(accessory).toHaveLength(1);
    expect(accessory[0]).toMatchObject({ bucket: 'atk', value: 0.0095 });
  });

  it('warns when the aggregate is missing instead of treating a sum as verified', () => {
    const input = withoutAdrenaline();
    input.arkgrid!.Effects = [];
    const { build, warnings } = buildFromArmory(input);
    expect(warnings.some(w => w.includes('젬 공격력 합산 효과 없음'))).toBe(true);
    expect(build.attackPower?.status).toBe('mismatch');
  });

  it('does not silently match the profile when equipment is missing', () => {
    const input = withoutAdrenaline();
    delete input.equipment;
    const { build, warnings } = buildFromArmory(input);
    expect(build.params.atkBase).toBe(158137);
    expect(build.attackPower?.status).toBe('mismatch');
    expect(warnings.some(w => w.includes('장비 정보 없음'))).toBe(true);
  });

  it('keeps a placeholder with a warning when a base cannot be extracted', () => {
    const input = withoutAdrenaline();
    input.profiles.Stats.find(s => s.Type === '공격력')!.Tooltip = [];
    const { build, warnings } = buildFromArmory(input);
    expect(build.params.atkBase).toBe(1);
    expect(build.attackPower).toBeUndefined();
    expect(warnings.some(w => w.includes('기본 공격력 툴팁 미확인'))).toBe(true);
  });

  it('reports inconsistent profile totals without calibrating a residual', () => {
    const input = withoutAdrenaline();
    input.profiles.Stats.find(s => s.Type === '공격력')!.Value = '200,000';
    const { build } = buildFromArmory(input);
    expect(build.params.atkBase).toBe(158137);
    expect(build.attackPower?.status).toBe('mismatch');
    expect(attack(build)).toBeCloseTo(171683.8255, 7);
  });
});
