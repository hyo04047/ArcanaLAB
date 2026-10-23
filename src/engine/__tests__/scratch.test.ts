import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers, rollHit } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { resolveSkillDamage, SKILL_BY_ID } from '../skilldata';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-stack-skill-sources.json').official.data.find((s: { Name: string }) => s.Name === '스크래치 딜러');
function input(selected: string[] = []): RawArmory {
  const skill = structuredClone(source); skill.Level = 10; skill.Rune = null;
  skill.Tripods.forEach((t: { Name: string; IsSelected: boolean }) => t.IsSelected = selected.includes(t.Name));
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [skill], arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
const row = SKILL_BY_ID.get('scratch_dealer')!;

describe('Scratch Dealer base damage', () => {
  it.each([[1, 182.5, 3.03], [10, 724.5, 3.941], [14, 724.5, 4.816], [20, 724.5, 6.681]])('uses each total once at level %s', (level, flat, ap) => {
    const s = resolveSkillDamage(row, level);
    expect(s.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level, effectIds: [193200, 193202] });
    expect(s.directCoef).toBeCloseTo(ap); expect(s.directFlat).toBe(flat);
    for (const atkBase of [0, 100, 10000]) {
      const skill = { ...empressInkomsu440().skills[0]!, ...s, mods: [], onCast: [] };
      const m = computeMultipliers({ atkBase }, [], { skill, stacks: 0, component: 'direct' });
      expect(rollHit(createRng(1), s.directCoef, m, s.directFlat).dmg).toBeCloseTo(flat + ap * atkBase);
    }
  });
  it.each([0, 1.5, 21])('does not retain candidate data at unsupported level %s', level => {
    const s = resolveSkillDamage(row, level); expect(s.directFlat).toBe(0);
    expect(s.directCoef).toBe(724); expect(s.damageReference?.source).toBe('codex-tooltip');
  });
  it.each(['preset', 'armory'])('preserves two-stack basic combo through %s', path => {
    const build = path === 'preset' ? empressInkomsu440() : buildFromArmory(input(['안전 장치'])).build;
    const skill = build.skills.find(s => s.id === row.id)!;
    expect(skill.directCoef).toBeCloseTo(3.941); expect(skill.directFlat).toBe(724.5);
    expect(skill.hits).toBe(2); expect(skill.stacksGranted).toBe(2);
    build.passiveMods = []; build.bluntThorn = undefined; build.params.atkBase = 100; build.params.raidCaptainRatio = 0;
    build.params.gaugePerHit.stack = 0; skill.mods = []; skill.onCast = [];
    const sim = new SimState(build, createRng(1), []); sim.cast(skill, 10);
    expect(sim.total).toBeCloseTo(1118.6); expect(sim.stacks).toBe(2);
  });
  it.each(['퍼스트 스크래치', '연속 공격'])('does not silently treat %s as unconditional basic damage', name => {
    const result = buildFromArmory(input([name])), s = result.build.skills[0]!;
    expect(s.mods?.some(m => m.source === name)).toBe(false);
    expect(result.warnings.some(w => w.includes(name) && w.includes('미반영'))).toBe(true);
  });
  it('applies Sharp Strike only to this skill direct critical damage', () => {
    const { build } = buildFromArmory(input(['예리한 일격'])), s = build.skills[0]!;
    expect(s.mods).toContainEqual({ bucket: 'critDmg', value: 1.6, filter: { ids: [row.id], component: 'direct' }, source: '예리한 일격' });
    for (const component of ['direct', 'dot', 'stack'] as const) {
      const m = computeMultipliers({ atkBase: 100 }, s.mods!, { skill: s, stacks: 0, component });
      expect(m.critDmg).toBeCloseTo(component === 'direct' ? 3.6 : 2);
    }
  });
  it('rejects changed conditional Sharp Strike text', () => {
    const raw = input(['예리한 일격']); raw.combatSkills[0]!.Tripods!.find(t => t.Name === '예리한 일격')!.Tooltip = '스택트가 없으면 치명타 피해가 160.0% 증가한다.';
    const result = buildFromArmory(raw);
    expect(result.build.skills[0]!.mods).toEqual([]);
    expect(result.warnings.some(w => w.includes('예리한 일격') && w.includes('해석 못함'))).toBe(true);
  });
});
