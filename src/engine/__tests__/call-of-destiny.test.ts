import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers, rollHit } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { resolveSkillDamage, SKILL_BY_ID } from '../skilldata';
import candidate from '../../../data/call_of_destiny_effects.json';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-stack-skill-sources.json').official.data.find((s: { Name: string }) => s.Name === '운명의 부름');
function input(selected: string[] = [], level = 10): RawArmory {
  const skill = structuredClone(source); skill.Level = level; skill.Rune = null;
  skill.Tripods.forEach((t: { Name: string; IsSelected: boolean }) => t.IsSelected = selected.includes(t.Name));
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [skill], arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
const row = SKILL_BY_ID.get('call_of_destiny')!;

describe('Call of Destiny direct effects', () => {
  it.each([1, 10, 14, 20])('separates flat and attack terms at level %s', level => {
    const s = resolveSkillDamage(row, level), effects = candidate.effects.slice(0, 2);
    expect(s.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level, effectIds: [191801, 191803] });
    const flat = effects.reduce((sum, e) => sum + (e.flatMinByLevel[level - 1]! + e.flatMaxByLevel[level - 1]!) / 2, 0);
    const ap = effects.reduce((sum, e) => sum + e.apByLevel[level - 1]!, 0);
    expect(s.directCoef).toBeCloseTo(ap); expect(s.directFlat).toBe(flat); expect(s.hits).toBe(2);
    for (const atkBase of [0, 100, 10000]) {
      const skill = { ...empressInkomsu440().skills[0]!, ...s, mods: [], onCast: [] };
      const m = computeMultipliers({ atkBase }, [], { skill, stacks: 0, component: 'direct' });
      expect(rollHit(createRng(1), s.directCoef, m, s.directFlat).dmg).toBeCloseTo(flat + ap * atkBase);
    }
  });
  it.each([0, 1.5, 21])('does not retain a candidate flat term at unsupported level %s', level => {
    const s = resolveSkillDamage(row, level); expect(s.directFlat).toBe(0);
    expect(s.damageReference?.source).toBe('codex-tooltip');
  });
  it.each([
    [[], 'normal', 2, 4.505, 825.5, 1],
    [['연속 공격'], 'normal', 3, 6.307, 1156.5, 1.22],
    [['페이크 플립'], 'stack', 1, 2.703, 494.5, 1.45],
  ] as const)('selects %j without multiplying the total increase twice', (tripods, kind, hits, ap, flat, bonus) => {
    const { build } = buildFromArmory(input([...tripods])); const skill = build.skills[0]!;
    expect(skill.kind).toBe(kind); expect(skill.hits).toBe(hits);
    expect(skill.directCoef).toBeCloseTo(ap); expect(skill.directFlat).toBe(flat);
    expect(skill.stacksGranted ?? 0).toBe(kind === 'stack' ? 2 : 0);
    const m = computeMultipliers({ atkBase: 100 }, skill.mods!, { skill, stacks: 0, component: 'direct' });
    expect(m.nonCrit).toBeCloseTo(bonus);
    build.passiveMods = []; build.params.atkBase = 100; build.params.gaugePerHit.normal = 0; build.params.gaugePerHit.stack = 0;
    const sim = new SimState(build, createRng(1), []); sim.cast(skill, 10);
    expect(sim.total).toBeCloseTo((flat + ap * 100) * bonus); expect(sim.stacks).toBe(kind === 'stack' ? 2 : 0);
  });
  it('keeps Fake Flip coefficient and tripod bonus separate in the preset', () => {
    const s = empressInkomsu440().skills.find(s => s.id === row.id)!;
    expect(s.directCoef).toBe(2.703); expect(s.directFlat).toBe(494.5);
    expect(s.damageReference).toMatchObject({ effectIds: [191823] });
  });
  it.each(['연속 공격', '페이크 플립'])('rejects changed conditional %s text and keeps basic coefficients', name => {
    const raw = input([name]); raw.combatSkills[0]!.Tripods!.find(t => t.Name === name)!.Tooltip = '특정 조건에서 45.0% 증가된 피해를 준다.';
    const result = buildFromArmory(raw), skill = result.build.skills[0]!;
    expect(skill.directCoef).toBeCloseTo(4.505); expect(skill.hits).toBe(2);
    expect(skill.mods?.some(m => m.source === name)).toBe(false);
    expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
  });
  it('keeps Quick Draw attempts aligned with the selected attack shape', () => {
    for (const [tripod, hits] of [['페이크 플립', 1], ['연속 공격', 3]] as const) {
      const result = buildFromArmory(input(['퀵 드로', tripod]));
      expect(result.build.skills[0]!.quickDraw?.attempts).toBe(hits);
      expect(result.warnings.some(w => w.includes('운명의 부름') && w.includes('비행'))).toBe(true);
    }
  });
});
