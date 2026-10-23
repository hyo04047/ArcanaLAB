import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { strip } from '../tooltip';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { character: string; responses: { endpoint: string; body: string }[] }[];
function convert(index: number, description?: string) {
  const raw = Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === '운명의 부름')!;
  const tripod = skill.Tripods!.find(t => t.Name === '꿰뚫는 일격')!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = description === '' ? [] : [{ ...tripod, IsSelected: true, Tooltip: description ?? tripod.Tooltip }];
  return buildFromArmory({ ...raw, combatSkills: [skill], arkpassive: null, arkgrid: null, engravings: null, gems: null, equipment: null });
}
describe('Call of Destiny defense ignore', () => {
  it.each([0, 1])('connects the official 30 percent value from source %s', index => {
    const active = convert(index), baseline = convert(index, '');
    expect(active.build.skills[0]!.defenseIgnore).toEqual({ chance: 1, fraction: 0.3 });
    expect({ ...active.build.skills[0], defenseIgnore: undefined }).toEqual({ ...baseline.build.skills[0], defenseIgnore: undefined });
    expect(active.build.passiveMods).toEqual(baseline.build.passiveMods);
    expect(active.warnings.some(w => w.includes('운명의 부름 꿰뚫는 일격') && w.includes('6500 가정'))).toBe(true);
  });
  it.each([
    '조건부로 적중된 적의 모든 방어력을 30.0% 무시한다.',
    '적중된 적의 모든 방어력을 30.0% 무시한다. 마나가 50% 이상일 때만 적용된다.',
    '적중된 적의 모든 방어력을 101% 무시한다.',
    '적중된 적의 모든 방어력을 1.2.3% 무시한다.',
    '적중된 적의 모든 방어력을 ' + '9'.repeat(400) + '% 무시한다.',
    '아군의 모든 방어력을 30.0% 무시한다.',
  ])('rejects changed or invalid text: %s', text => {
    const result = convert(0, strip(text));
    expect(result.build).toEqual(convert(0, '').build);
    expect(result.warnings.some(w => w.includes('운명의 부름') && w.includes('방어 무시 미반영'))).toBe(true);
  });
  it.each([0, 6500, 13000])('applies only the existing direct-damage ratio at target defense %s', targetDefense => {
    const damage = (active: boolean) => {
      const build = convert(0, active ? undefined : '').build;
      build.passiveMods = []; build.params.atkBase = 100; build.params.targetDefense = targetDefense;
      build.params.gaugePerHit.normal = 0; build.params.gaugePerHit.stack = 0;
      const sim = new SimState(build, createRng(1), []), skill = build.skills[0]!;
      const row = sim.breakdown.get(skill.id)!;
      sim.hit(skill, row);
      return row;
    };
    const baseline = damage(false), active = damage(true);
    expect(active.direct / baseline.direct).toBeCloseTo((6500 + targetDefense) / (6500 + targetDefense * 0.7), 12);
    expect(active.stackEffect).toBe(0);
    expect(active.dot ?? 0).toBe(0);
  });
});
