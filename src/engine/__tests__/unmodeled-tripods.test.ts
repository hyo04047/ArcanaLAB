import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const rows: { skill: string; name: string; text: string; status: string }[] = load('tests/fixtures/audit/2026-10-17-tripod-corpus-inventory.json').unique;
const cases = rows.filter(r => r.status === 'unchanged_without_warning' && !(r.skill === '운명의 부름' && r.name === '꿰뚫는 일격'));
const raw = Object.fromEntries(load('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json').records[1].responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;

describe('Unmodeled tripod choices remain visible', () => {
  it('does not label the separately handled Stream profile as an ignored tripod', () => {
    for (const record of load('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json').records) {
      const source = Object.fromEntries(record.responses.map((r: { endpoint: string; body: string }) =>
        [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
      expect(buildFromArmory(source).warnings.some(w => w.startsWith('트라이포드 효과 미모델') && w.includes('stream_of_edge'))).toBe(false);
    }
  });
  it.each(cases)('$skill / $name: warns without introducing a modeled effect', ({ skill: name, name: tripodName, text }) => {
    const skill = structuredClone(raw.combatSkills.find(s => s.Name === name)!);
    const tripod = skill.Tripods!.find(t => t.Name === tripodName)!;
    skill.Level = 10; skill.Rune = null; skill.Tripods = [];
    const baseline = buildFromArmory({ ...raw, combatSkills: [skill] });
    skill.Tripods = [{ ...tripod, IsSelected: true, Tooltip: text }];
    const result = buildFromArmory({ ...raw, combatSkills: [skill] });
    expect(result.build).toEqual(baseline.build);
    expect(result.warnings.filter(w => w.includes(`트라이포드 효과 미모델`) && w.includes(tripodName) && w.includes(text))).toHaveLength(1);
  });
});
