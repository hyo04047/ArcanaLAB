import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const base: RawArmory = { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [],
  arkpassive: null, arkgrid: null, engravings: null, gems: null };
const sources: { character: string; body: string }[] = load('tests/fixtures/audit/2026-10-17-card-set-sources.json').records;
const cardWarnings = (raw: RawArmory) => buildFromArmory(raw).warnings.filter(w => w.startsWith('장착 카드'));

describe('Equipped card set effects remain visible until attribute damage is modeled', () => {
  it.each(sources)('preserves every official effect in warnings for $character without changing damage', ({ body }) => {
    const cards = JSON.parse(body);
    const converted = buildFromArmory({ ...base, cards });
    const warnings = cardWarnings({ ...base, cards });
    expect(warnings).toHaveLength(cards.Effects.length);
    for (const effect of cards.Effects) for (const item of effect.Items) {
      expect(warnings.join('\n')).toContain(item.Name);
      expect(warnings.join('\n')).toContain(item.Description);
    }
    expect(converted.build).toEqual(buildFromArmory(base).build);
    expect(converted.summary).toEqual(buildFromArmory(base).summary);
  });
  it.each([undefined, null])('marks unavailable card input explicitly: %s', cards => {
    expect(cardWarnings({ ...base, cards })).toEqual(['장착 카드 정보 없음 — 카드 세트 효과 미반영']);
  });
  it('does not call a successful empty effect list missing input', () => {
    expect(cardWarnings({ ...base, cards: { Effects: [] } })).toEqual([]);
  });
  it('does not infer an active effect from an empty set group', () => {
    expect(cardWarnings({ ...base, cards: { Effects: [{ Items: [] }] } })).toEqual([]);
  });
});
