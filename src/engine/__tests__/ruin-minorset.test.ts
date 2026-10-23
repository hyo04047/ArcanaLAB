import { coreTestPassives, coreTestTooltip } from './core-fixture';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { SimState } from '../sim';
import { createRng } from '../rng';
import { computeMultipliers } from '../damage';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function input(points = 14, galewind = false): RawArmory {
  const raw: RawArmory = { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'),
    combatSkills: load('tests/fixtures/armory/FixtureCharacter26/combat-skills.json'), arkpassive: coreTestPassives(), arkgrid: null, engravings: null, gems: null };
  for (const s of raw.combatSkills) s.Rune = galewind && s.Name === '세렌디피티'
    ? { Name: '질풍', Grade: '전설', Tooltip: JSON.stringify({ value: '스킬 시전 속도가 14% 증가합니다.' }) } : null;
  const source = load('tests/fixtures/audit/2026-10-13-ruin-minorset-sources.json');
  const text = source.options.replace(/(\d)\s+초/g, '$1초');
  raw.arkgrid = { Slots: [{ Index: 2, Name: '질서의 별 코어 : 루인 마이너셋', Point: points,
    Tooltip: coreTestTooltip(text) }] };
  return raw;
}
function state(points: number, speed = 0, galewind = false) {
  const { build } = buildFromArmory(input(points, galewind));
  build.bluntThorn = undefined; build.onRuinAt4 = [];
  build.passiveMods = build.passiveMods.filter(m => m.source.startsWith('루인 마이너셋'));
  build.passiveMods.push({ bucket: 'atkSpeed', value: speed, source: '통제 공속' });
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  for (const s of build.skills) { s.mods = []; s.onCast = []; s.onHit = []; s.defenseIgnore = undefined; s.procCritDmg = undefined; }
  return new SimState(build, { ...createRng(1), chance: () => false }, []);
}
function cast(sim: SimState, judgment: boolean) {
  sim.stacks = 4;
  if (judgment) sim.applyBuff({ id: 'judgment', duration: 10, mod: { bucket: 'skillDmg', value: 0, source: '통제 심판' } });
  sim.cast(sim.skill('serendipity'), 10);
  return sim.breakdown.get('serendipity')!;
}

describe('Ruin Minorset skill effects', () => {
  it.each([false, true])('applies 14P to the existing first-hit/full-combo policy, judgment=%s', judgment => {
    const base = state(13), core = state(14), b = cast(base, judgment), c = cast(core, judgment);
    expect(core.now).toBeCloseTo(base.now / 1.15, 10);
    expect(c.direct / b.direct).toBeCloseTo(1.2); expect(c.stackEffect / b.stackEffect).toBeCloseTo(1.2);
    expect(core.ruinAt4).toBe(1);
    const first = state(14), firstResult = cast(first, false);
    expect(c.stackEffect / firstResult.stackEffect).toBeCloseTo(judgment ? 3 : 1);
  });
  it('keeps core speed outside the global cap and separate from Galewind', () => {
    const base = state(13), core = state(14, 0.6, true);
    cast(base, true); cast(core, true);
    expect(core.atkSpeed()).toBeCloseTo(0.4);
    expect(core.now).toBeCloseTo(base.now / (1.4 * 1.14 * 1.15), 10);
  });
  it('does not leak Serendipity damage or cast speed to other skills', () => {
    const base = state(13), core = state(14);
    for (const skill of core.build.skills.filter(s => s.id !== 'serendipity')) {
      expect(skill.castTime).toBe(base.skill(skill.id).castTime);
      expect(computeMultipliers({ atkBase: 1 }, core.activeMods(), { skill, stacks: 4, component: 'direct' }).skillDmg).toBe(1);
    }
  });
  it.each([[16, 1], [17, 1.3], [18, 1.3 * 1.02], [20, 1.3 * 1.02 ** 3]])('recognizes the core spelling of Four of a Kind at %s points', (points, expected) => {
    const sim = state(points), s = sim.skill('four_of_a_kind');
    for (const component of ['direct', 'stack'] as const) expect(computeMultipliers({ atkBase: 1 }, sim.activeMods(), { skill: s, stacks: 4, component }).skillDmg).toBeCloseTo(expected);
  });
  it('reads a different supplied grade percentage and the spaced skill name', () => {
    const raw = input(17), slot = raw.arkgrid!.Slots[0]!;
    slot.Tooltip = slot.Tooltip!.replace('30.0%', '20.0%').replaceAll('포카드', '포 카드');
    const { build } = buildFromArmory(raw);
    expect(build.passiveMods.find(m => m.source === '루인 마이너셋 17P')?.value).toBe(0.2);
  });
  it('also imports the actual relic core response without substituting the ancient value', () => {
    const raw = input(20), source = load('tests/fixtures/audit/2026-10-13-ruin-minorset-sources.json');
    const slot = structuredClone(source.official.responses.arkgrid.data.Slots.find((s: { Name: string }) => s.Name.includes('루인 마이너셋')));
    slot.Gems = []; raw.arkgrid = { Slots: [slot] };
    const { build, warnings } = buildFromArmory(raw);
    expect(build.passiveMods.find(m => m.source === '루인 마이너셋 17P')?.value).toBe(0.2);
    expect(build.skills.find(s => s.id === 'serendipity')!.castTime).toBeCloseTo(buildFromArmory(input(13)).build.skills.find(s => s.id === 'serendipity')!.castTime / 1.15);
    expect(warnings.some(w => w.includes('루인 마이너셋') && w.includes('미검증'))).toBe(true);
  });
  it('does not partially apply an unknown condition in the compound 14P sentence', () => {
    const raw = input(), slot = raw.arkgrid!.Slots[0]!;
    slot.Tooltip = slot.Tooltip!.replace('피해량이 20.0%', '적이 피격 이상 상태일 때 피해량이 20.0%');
    const { build, warnings } = buildFromArmory(raw), base = buildFromArmory(input(13)).build;
    expect(build.skills.find(s => s.id === 'serendipity')?.castTime).toBe(base.skills.find(s => s.id === 'serendipity')?.castTime);
    expect(build.passiveMods.some(m => m.source === '루인 마이너셋 14P')).toBe(false);
    expect(warnings.some(w => w.includes('14P') && w.includes('미모델'))).toBe(true);
  });
  it('retains the existing 10P Edge cooldown change and missing-skill warning', () => {
    const raw = input(), build = buildFromArmory(raw).build;
    expect(build.skills.find(s => s.id === 'spiral_edge')?.cooldown).toBe(7);
    raw.combatSkills = raw.combatSkills.filter(s => s.Name !== '세렌디피티');
    expect(buildFromArmory(raw).warnings.some(w => w.includes('코어 효과 대상 스킬 미장착') && w.includes('serendipity'))).toBe(true);
  });
});
