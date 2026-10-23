import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSeconds, tooltipLines } from '../tooltip';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records;
const controls: { character: string; name: string; value: string; seconds: number }[] = records.flatMap((record: { character: string; responses: { endpoint: string; body: string }[] }) =>
  JSON.parse(record.responses.find(r => r.endpoint === 'combat-skills')!.body)
    .filter((skill: { SkillType: number }) => skill.SkillType === 1)
    .map((skill: { Name: string; Tooltip: string }) => ({ character: record.character, name: skill.Name,
      value: tooltipLines(skill.Tooltip).find(t => t.startsWith('재사용 대기시간'))!.replace('재사용 대기시간', ''),
      seconds: skill.Name === '더 썬' ? 80 : 60 })));

describe('minute cooldowns after removing the official tooltip label', () => {
  it.each(controls)('reads $character $name without falling back to catalog cooldowns', ({ value, seconds }) => {
    expect(parseSeconds(value)).toBe(seconds);
  });
  it.each([['9초', 9], [' 9초 ', 9], ['1분', 60], ['1분 30초', 90], [' 1분 30초 ', 90]] as const)(
    'reads %s as %s seconds', (value, seconds) => expect(parseSeconds(value)).toBe(seconds));
});
