import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const records: { responses: { endpoint: string; body: string }[] }[] = JSON.parse(
  readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records;
const raws = records.map(record => Object.fromEntries(record.responses.map(response => [
  response.endpoint === 'combat-skills' ? 'combatSkills' : response.endpoint, JSON.parse(response.body),
])) as unknown as RawArmory);

describe('Arcana character import', () => {
  it.each(['바드', '소서리스', ''])('rejects unsupported or missing class %s before building an Arcana simulation', characterClass => {
    for (const raw of raws) {
      const input = { ...raw, profiles: { ...raw.profiles, CharacterClassName: characterClass } };
      expect(() => buildFromArmory(input)).toThrow('아르카나 캐릭터만 지원합니다');
    }
  });

  it('keeps both supported Arcana variants', () => {
    expect(raws.map(raw => buildFromArmory(raw).build.variant)).toEqual(['emperor', 'empress']);
  });
});
