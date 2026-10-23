import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { strip } from '../tooltip';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { responses: { endpoint: string; body: string }[] }[];
function convert(skillName: string, description?: string, index = 1) {
  const raw = Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === skillName)!, tripod = skill.Tripods!.find(t => t.Name === '카드 증가')!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = description === undefined ? [] : [{ ...tripod, IsSelected: true, Tooltip: description }];
  return { result: buildFromArmory({ ...raw, combatSkills: [skill], arkpassive: null, arkgrid: null,
    engravings: null, gems: null, equipment: null, cards: null }), text: strip(tripod.Tooltip) };
}
for (const [skillName, before, after] of [['백 플러쉬', 2, 3], ['체크메이트', 3, 4]] as const) describe(`${skillName} Card Increase`, () => {
  const { result: empty, text } = convert(skillName), base = empty.build.skills[0]!;
  it.each([0, 1])('preserves official source %s stack count', index => {
    const official = convert(skillName, undefined, index).text;
    const skill = convert(skillName, official, index).result.build.skills[0]!;
    expect(base.stacksGranted).toBe(before); expect(skill.stacksGranted).toBe(after);
    expect({ ...skill, stacksGranted: before }).toEqual(base);
  });
  it('grants the converted count through an actual cast', () => {
    const { build } = convert(skillName, text).result, skill = build.skills[0]!;
    const sim = new SimState(build, createRng(42), cardsFor('empress'));
    sim.cast(skill, 100); expect(sim.stacks).toBe(after);
  });
  it.each([
    '', '특정 버프가 있을 때만 ' + text, text + ' 마나가 50% 이상일 때만 적용된다.',
    text.replace(skillName, '다른 스킬'), text.replace(`${before}에서`, '0에서'),
    text.replace(`${after}로`, '5로'), text.replace(`${after}로`, '0로'),
    text.replace(`${after}로`, '1.2.3로'), text.replace(`${after}로`, '9'.repeat(400) + '로'),
  ])('rejects changed targets, conditions or counts: %s', description => {
    const result = convert(skillName, description).result;
    expect(result.build.skills[0]).toEqual(base);
    expect(result.warnings.some(w => w.includes('카드 증가') && w.includes('해석 못함'))).toBe(true);
  });
});
