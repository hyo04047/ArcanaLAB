import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-hit-buff-sources.json').official.data;
const cases = [
  ['운명의 부름', '어두운 운명', 5, 0.775], ['리턴', '노출된 어둠', 7, 0.775],
  ['스파이럴 엣지', '급소 포착', 5, 0.775], ['리턴', '급소 노출', 10, 0.1], ['스크래치 딜러', '급소 노출', 10, 0.1],
] as const;
function input(skillName: string, tripod: string): RawArmory {
  const skill = structuredClone(source.find((s: { Name: string }) => s.Name === skillName));
  skill.Level = 10; skill.Rune = null;
  skill.Tripods.forEach((t: { Name: string; IsSelected: boolean }) => t.IsSelected = t.Name === tripod);
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [skill], arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
function reject(raw: RawArmory, name: string) {
  const result = buildFromArmory(raw), skill = result.build.skills[0]!;
  expect(skill.onHit?.filter(e => e.mod.source === name) ?? []).toEqual([]);
  expect(skill.mods?.filter(m => m.source === name) ?? []).toEqual([]);
  expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
}

describe.each(cases)('%s / %s numerical boundary', (skillName, tripod, duration, value) => {
  it('preserves the saved official duration and bonus', () => {
    const skill = buildFromArmory(input(skillName, tripod)).build.skills[0]!;
    expect(skill.onHit?.find(e => e.mod.source === tripod)).toMatchObject({ duration, mod: { value } });
  });
  it.each(['invalid duration', 'zero duration', 'overflow duration', 'invalid bonus', 'overflow bonus'])(
    'rejects %s without keeping a partial own-skill effect', change => {
      const raw = input(skillName, tripod), node = raw.combatSkills[0]!.Tripods!.find(t => t.Name === tripod)!;
      let text = strip(node.Tooltip);
      if (change === 'invalid duration') text = text.replace(/[\d.]+초간/, '1.2.3초간');
      if (change === 'zero duration') text = text.replace(/[\d.]+초간/, '0초간');
      if (change === 'overflow duration') text = text.replace(/[\d.]+초간/, '9'.repeat(400) + '초간');
      if (change === 'invalid bonus') text = text.replace(/[\d.]+%(?= (?:증가|감소)한다\.$)/, '1.2.3%');
      if (change === 'overflow bonus') text = text.replace(/[\d.]+%(?= (?:증가|감소)한다\.$)/, '9'.repeat(400) + '%');
      node.Tooltip = text; reject(raw, tripod);
    });
});

it.each([['리턴', '노출된 어둠'], ['리턴', '급소 노출'], ['스크래치 딜러', '급소 노출']])(
  'rejects a critical chance over 100 percent: %s / %s', (skillName, tripod) => {
    const raw = input(skillName, tripod), node = raw.combatSkills[0]!.Tripods!.find(t => t.Name === tripod)!;
    node.Tooltip = strip(node.Tooltip).replace(/[\d.]+%/, '120%');
    reject(raw, tripod);
  });

it.each([['운명의 부름', '어두운 운명'], ['리턴', '노출된 어둠']])(
  'rejects an invalid own-skill bonus with its hit buff: %s / %s', (skillName, tripod) => {
    const raw = input(skillName, tripod), node = raw.combatSkills[0]!.Tripods!.find(t => t.Name === tripod)!;
    node.Tooltip = strip(node.Tooltip).replace(/[\d.]+%/, '1.2.3%');
    reject(raw, tripod);
  });

it.each(cases.slice(0, 3))('does not impose a critical-damage cap on %s / %s', (skillName, tripod) => {
  const raw = input(skillName, tripod), node = raw.combatSkills[0]!.Tripods!.find(t => t.Name === tripod)!;
  node.Tooltip = strip(node.Tooltip).replace('77.5%', '177.5%');
  expect(buildFromArmory(raw).build.skills[0]!.onHit?.find(e => e.mod.source === tripod)?.mod.value).toBe(1.775);
});
