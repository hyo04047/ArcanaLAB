import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor } from '../presets';

const load = (file: string) => JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/' + file + '.json', 'utf8'));
function input(description: string, category = '깨달음'): RawArmory {
  return { profiles: load('profiles'), combatSkills: load('combat-skills'), arkgrid: null, engravings: null, gems: null,
    arkpassive: { Effects: [{ Name: category, Description: description }] } };
}

describe('Emperor variant requires an active main-node identity', () => {
  it.each([1, 2, 3])('keeps Emperor, Sun and its base deck for active level %s', level => {
    const { build } = buildFromArmory(input(`깨달음 1티어 황제의 칙령 Lv.${level}`));
    expect(build.variant).toBe('emperor');
    expect(build.skills.some(s => s.id === 'the_sun')).toBe(true);
    expect(build.skills.some(s => s.id === 'the_devil')).toBe(false);
    expect(cardsFor(build.variant, build.deckOverrides).some(c => c.id === 'emperor')).toBe(true);
  });

  it.each([
    ['깨달음 1티어 황제의 칙령 Lv.0', '깨달음'],
    ['깨달음 1티어 황제의 칙령 Lv.9', '깨달음'],
    ['깨달음 2티어 황제의 칙령 Lv.3', '깨달음'],
    ['진화 1티어 황제의 칙령 Lv.3', '진화'],
    ['깨달음 1티어 황제의 칙령 Lv.3', '도약'],
    ['깨달음 1티어 옛 황제의 칙령 Lv.3', '깨달음'],
    ['깨달음 1티어 황제의 칙령 Lv.3 비활성', '깨달음'],
    ['황제의 칙령', '깨달음'],
  ])('does not select Emperor from %s / %s', (description, category) => {
    const { build } = buildFromArmory(input(description, category));
    expect(build.variant).toBe('empress');
    expect(build.skills.some(s => s.id === 'the_devil')).toBe(true);
    expect(build.skills.some(s => s.id === 'the_sun')).toBe(false);
    expect(cardsFor(build.variant, build.deckOverrides).some(c => c.id === 'emperor')).toBe(false);
  });
});
