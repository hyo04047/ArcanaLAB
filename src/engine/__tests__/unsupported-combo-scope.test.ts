import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { responses: { endpoint: string; body: string }[] }[];
const cases = [
  { skillName: '리턴', name: '노출된 표적', other: '약점 포착' },
  { skillName: '댄싱 오브 스파인플라워', name: '가시 집약', other: '격렬한 춤' },
];
function convert(skillName: string, selected: string[], index = 1) {
  const raw = Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === skillName)!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = skill.Tripods!.map(t => ({ ...t, IsSelected: selected.includes(t.Name) }));
  return buildFromArmory({ ...raw, combatSkills: [skill], arkpassive: null, arkgrid: null,
    engravings: null, gems: null, equipment: null, cards: null });
}
for (const { skillName, name, other } of cases) describe(`${skillName} unsupported ${name}`, () => {
  it.each([0, 1])('does not apply a partial damage multiplier from official source %s', index => {
    const base = convert(skillName, [], index), result = convert(skillName, [name], index);
    expect(result.build).toEqual(base.build);
    expect(result.warnings.some(w => w.includes(name) && w.includes('미반영'))).toBe(true);
  });
  it('does not remove another supported tripod', () => {
    const base = convert(skillName, [other]), result = convert(skillName, [other, name]);
    expect(result.build).toEqual(base.build);
    expect(result.build.skills[0]!.mods!.some(m => m.source.startsWith(other))).toBe(true);
  });
  it('does not emit a selected-effect warning for an unselected tripod', () => {
    expect(convert(skillName, []).warnings.some(w => w.startsWith(`${skillName} / ${name}:`))).toBe(false);
  });
  it('preserves base-only damage and gauge in an actual cast', () => {
    const states = [[], [name]].map(selected => {
      const { build } = convert(skillName, selected), skill = build.skills[0]!;
      const sim = new SimState(build, createRng(42), cardsFor('empress'));
      sim.cast(skill, 100);
      return { total: sim.total, gauge: sim.deck.gauge, stacks: sim.stacks, breakdown: [...sim.breakdown.values()] };
    });
    expect(states[1]).toEqual(states[0]);
  });
});
