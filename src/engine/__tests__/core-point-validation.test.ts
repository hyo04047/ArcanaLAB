import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const responses = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
const raw = Object.fromEntries(Object.entries(responses).map(([key, r]) =>
  [key === 'combat-skills' ? 'combatSkills' : key, (r as { data: unknown }).data])) as unknown as RawArmory;
const pointInput = (point: unknown) => {
  const input = structuredClone(raw);
  input.arkgrid!.Slots.find(s => s.Name.endsWith(' : 공격'))!.Point = point as number;
  return input;
};
const coreMods = (input: RawArmory) => buildFromArmory(input).build.passiveMods.filter(m => m.source.startsWith('공격 '));
const gemMods = (input: RawArmory) => buildFromArmory(input).build.passiveMods.filter(m => m.source.startsWith('젬 '));
it.each([undefined, null, NaN, Infinity, -1, 17.5, '20', Number.MAX_SAFE_INTEGER + 1])('does not activate core stages for invalid points %s', point => {
  const input = pointInput(point);
  expect(coreMods(input)).toEqual([]);
  expect(buildFromArmory(input).warnings.some(w => w.includes('코어 포인트 미확인'))).toBe(true);
  expect(gemMods(input)).toEqual(gemMods(raw));
});
it('rejects an actually omitted JSON point field', () => {
  const input = pointInput(20);
  delete (input.arkgrid!.Slots.find(s => s.Name.endsWith(' : 공격'))! as { Point?: number }).Point;
  expect(coreMods(input)).toEqual([]);
});
it.each([[0, 0, 0], [9, 0, 0], [10, 900, 0], [14, 900, 0.0055], [17, 2700, 0.0165], [20, 2700, 0.0213]])('keeps the saved attack-core thresholds at %s points', (point, flat, percent) => {
  const input = pointInput(point);
  const mods = coreMods(input);
  expect(mods.filter(m => m.bucket === 'atkFlat').reduce((n, m) => n + m.value, 0)).toBe(flat);
  expect(mods.filter(m => m.bucket === 'atk').reduce((n, m) => n + m.value, 0)).toBeCloseTo(percent, 12);
  expect(buildFromArmory(input).warnings.some(w => w.includes('코어 포인트 미확인'))).toBe(false);
});
it('does not apply missing-point effects that would modify the card deck or cast policy', () => {
  const input = structuredClone(raw);
  input.arkgrid!.Slots.forEach(s => { s.Point = undefined as unknown as number; });
  const noCore = structuredClone(raw); noCore.arkgrid!.Slots.forEach(s => { s.Point = 0; });
  expect(buildFromArmory(input).build).toEqual(buildFromArmory(noCore).build);
});
