import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { resolveSkillDamage, SKILL_BY_ID } from '../skilldata';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-stack-skill-sources.json').official.data.find((s: { Name: string }) => s.Name === '스파이럴 엣지');
function input(selected: string[] = []): RawArmory {
  const skill = structuredClone(source); skill.Level = 10; skill.Rune = null;
  skill.Tripods.forEach((t: { Name: string; IsSelected: boolean }) => t.IsSelected = selected.includes(t.Name));
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [skill], arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
const row = SKILL_BY_ID.get('spiral_edge')!;

describe('Spiral Edge damage per input', () => {
  it.each([[1, 128, 2.138], [10, 505.5, 2.78], [14, 505.5, 3.398], [20, 505.5, 4.711]])('keeps one jump flat and AP at level %s', (level, flat, ap) => {
    const s = resolveSkillDamage(row, level);
    expect(s.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level, effectIds: [191902] });
    expect(s.directCoef).toBe(ap); expect(s.directFlat).toBe(flat);
  });
  it.each([0, 1.5, 21])('retains the marked fallback at unsupported level %s', level => {
    const s = resolveSkillDamage(row, level); expect(s.directFlat).toBe(0);
    expect(s.directCoef).toBe(505); expect(s.damageReference?.source).toBe('codex-tooltip');
  });
  it.each([[[], 1, 1, 1], [['무자비한 사격'], 2, 2, 1.46]] as const)('uses %j hit count without multiplying total damage again', (names, hits, stacks, mult) => {
    const { build } = buildFromArmory(input([...names])), s = build.skills[0]!;
    expect(s.hits).toBe(hits); expect(s.stacksGranted).toBe(stacks);
    expect(computeMultipliers({ atkBase: 100 }, s.mods!, { skill: s, stacks: 0, component: 'direct' }).nonCrit).toBeCloseTo(mult);
    build.passiveMods = []; build.params.atkBase = 100; build.params.gaugePerHit.stack = 0;
    const sim = new SimState(build, createRng(1), []); sim.cast(s, 10);
    expect(sim.total).toBeCloseTo(783.5 * mult); expect(sim.stacks).toBe(stacks);
  });
  it('keeps preset per-input damage and Fast Preparation aligned with the API', () => {
    const s = empressInkomsu440().skills.find(s => s.id === row.id)!;
    expect(s.directCoef).toBe(2.78); expect(s.directFlat).toBe(505.5); expect(s.hits).toBe(2);
    expect(s.cooldown).toBe(9);
  });
  it('rejects altered conditional Ruthless Shot text', () => {
    const raw = input(['무자비한 사격']); raw.combatSkills[0]!.Tripods!.find(t => t.Name === '무자비한 사격')!.Tooltip = '특정 조건에서 총 46.0% 증가된 피해를 준다.';
    const result = buildFromArmory(raw), s = result.build.skills[0]!;
    expect(s.hits).toBe(1); expect(s.stacksGranted).toBe(1); expect(s.mods).toEqual([]);
    expect(result.warnings.some(w => w.includes('무자비한 사격') && w.includes('해석 못함'))).toBe(true);
  });
  it('makes unsupported Card Storm explicit without applying an aggregate guessed multiplier', () => {
    const result = buildFromArmory(input(['카드 폭풍']));
    expect(result.build.skills[0]!.mods).toEqual([]);
    expect(result.warnings.some(w => w.includes('카드 폭풍') && w.includes('미반영'))).toBe(true);
  });
  it('reports that the second input and cooldown timing are still unresolved', () => {
    const { warnings } = buildFromArmory(input(['무자비한 사격']));
    expect(warnings.some(w => w.includes('스파이럴 엣지') && w.includes('체인') && w.includes('미반영'))).toBe(true);
  });
});
