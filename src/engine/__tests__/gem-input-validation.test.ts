import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-emperor-import-sources.json').responses;
const raw: RawArmory = { profiles: source.profiles.data, combatSkills: [], arkpassive: null,
  arkgrid: null, engravings: null, gems: null };
const input = (name: string, Description?: string[]) => ({ ...raw, gems: { Effects: { Skills: [{ Name: name, Description }] } } });

describe.each([
  { name: '이보크', text: '피해 44.00% 증가', bucket: 'skillDmg', value: 0.44 },
  { name: '이보크', text: '재사용 대기시간 24.00% 감소', bucket: 'cooldown', value: 0.24 },
  { name: '황제', text: '피해 44.00% 증가', bucket: 'skillDmg', value: 0.44 },
])('$name $text gem input', ({ name, text, bucket, value }) => {
  it('retains the official effect with HTML and whitespace', () => {
    const result = buildFromArmory(input(name, [` <font>${text}</font> `]));
    const mods = result.build.passiveMods.filter(m => m.source === '보석 ' + name);
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({ bucket, value, filter: { ids: [name === '황제' ? 'card_emperor' : 'evoke'] } });
    if (name === '이보크' && bucket === 'skillDmg') expect(mods[0]!.dotScope).toBe('exclude');
  });
  it.each(['prefix', 'suffix', 'invalid number', 'over 100'])(
    'rejects %s without applying a substring', change => {
      const description = change === 'prefix' ? '치명타 적중 시 ' + text
        : change === 'suffix' ? text + ', 적중 후 5초 동안'
          : text.replace(/[\d.]+%/, change === 'invalid number' ? '1.2.3%' : '101%');
      const result = buildFromArmory(input(name, [description]));
      expect(result.build.passiveMods.some(m => m.source === '보석 ' + name)).toBe(false);
      expect(result.warnings.some(w => w.startsWith('보석 해석 못함:'))).toBe(true);
    });
});

it.each([undefined, []])('warns about a selected gem without a description: %s', description => {
  const result = buildFromArmory(input('이보크', description));
  expect(result.build.passiveMods.some(m => m.source === '보석 이보크')).toBe(false);
  expect(result.warnings.some(w => w.startsWith('보석 설명 없음: 이보크'))).toBe(true);
});

it('rejects a cooldown gem that would erase the entire cooldown', () => {
  const result = buildFromArmory(input('이보크', ['재사용 대기시간 100% 감소']));
  expect(result.build.passiveMods.some(m => m.source === '보석 이보크')).toBe(false);
});

it('keeps Emperor cooldown gems unsupported', () => {
  const result = buildFromArmory(input('황제', ['재사용 대기시간 24.00% 감소']));
  expect(result.build.passiveMods.some(m => m.source === '보석 황제')).toBe(false);
  expect(result.warnings.some(w => w.startsWith('보석 해석 못함:'))).toBe(true);
});

it('retains all eleven official effects without reading duplicate tooltip summaries', () => {
  const result = buildFromArmory({ ...raw, gems: source.gems.data });
  const mods = result.build.passiveMods.filter(m => m.source.startsWith('보석 '));
  expect(mods).toHaveLength(11);
  expect(result.warnings.some(w => w.startsWith('보석 '))).toBe(false);
});
