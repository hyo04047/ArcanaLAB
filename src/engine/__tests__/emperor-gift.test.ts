import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { Deck } from '../deck';
import { cardsFor } from '../presets';
import { createRng } from '../rng';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const effects = load('tests/fixtures/audit/2026-10-13-knight-passive-sources.json').refs[0].data.Effects;
const edict = effects.find((e: { Description: string }) => e.Description.includes('황제의 칙령'));
const gift = effects.find((e: { Description: string }) => e.Description.includes('황제의 하사품'));
const knight = effects.find((e: { Description: string }) => e.Description.includes('황후의 기사'));
function input(nodes = [edict, gift]): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [],
    arkpassive: { Effects: nodes }, arkgrid: null, engravings: null, gems: null };
}
function deck(nodes = [edict, gift]) {
  const result = buildFromArmory(input(nodes));
  return { ...result, cards: cardsFor(result.build.variant, result.build.deckOverrides) };
}

describe('Emperor Gift card replacements', () => {
  it('uses the live level 2 tooltip to replace both cards without reducing deck size', () => {
    const { cards, warnings } = deck(); const ids = cards.map(c => c.id);
    expect(ids).toHaveLength(15); expect(new Set(ids).size).toBe(15);
    expect(ids).toEqual(expect.arrayContaining(['emperor', 'chancellor', 'sovereign']));
    expect(ids).not.toContain('balance'); expect(ids).not.toContain('judgment');
    expect(warnings.some(w => w.includes('황제의 하사품') && w.includes('해석 못함'))).toBe(false);
  });
  it('replaces only Balance for the supplied level one description', () => {
    const node = structuredClone(gift);
    node.Description = node.Description.replace('Lv.2', 'Lv.1');
    node.ToolTip = JSON.stringify({ value: '카드덱의 균형 카드가 재상 카드로 교체된다.' });
    const ids = deck([edict, node]).cards.map(c => c.id);
    expect(ids).toHaveLength(15); expect(ids).toContain('chancellor'); expect(ids).toContain('judgment');
    expect(ids).not.toContain('balance'); expect(ids).not.toContain('sovereign');
  });
  it('keeps original cards when the Emperor has no Gift node', () => {
    const ids = deck([edict]).cards.map(c => c.id);
    expect(ids).toHaveLength(15); expect(ids).toContain('balance'); expect(ids).toContain('judgment');
    expect(ids).not.toContain('chancellor'); expect(ids).not.toContain('sovereign');
  });
  it('does not change the fourteen-card Empress deck', () => {
    expect(deck([]).cards.map(c => c.id)).toEqual(cardsFor('empress').map(c => c.id));
    expect(deck([]).cards).toHaveLength(14);
  });
  it('adds Knight on top of both replacements once', () => {
    const ids = deck([edict, gift, knight]).cards.map(c => c.id);
    expect(ids).toHaveLength(16); expect(new Set(ids).size).toBe(16);
    expect(ids).toEqual(expect.arrayContaining(['empress_knight', 'chancellor', 'sovereign']));
  });
  it.each([undefined, '특정 조건에서 카드덱의 균형 카드가 재상 카드로 교체된다.'])('warns about missing or conditional text rather than inferring replacements from the level', text => {
    const node = structuredClone(gift); node.ToolTip = text === undefined ? undefined : JSON.stringify({ value: text });
    const { cards, warnings } = deck([edict, node]);
    expect(cards.map(c => c.id)).not.toContain('sovereign'); expect(cards.map(c => c.id)).not.toContain('chancellor');
    expect(warnings.some(w => w.includes('황제의 하사품') && w.includes('해석 못함'))).toBe(true);
  });
  it('draws Sovereign naturally and never draws replaced cards across fixed seeds', () => {
    for (const seed of [1, 11, 42]) {
      const d = new Deck(deck().cards), rng = createRng(seed), seen = new Set<string>();
      for (let i = 0; i < 1000; i++) { const id = d.draw(rng)!; seen.add(id); d.use(id); }
      expect(seen.has('sovereign')).toBe(true); expect(seen.has('balance')).toBe(false); expect(seen.has('judgment')).toBe(false);
      expect(seen.size).toBe(15);
    }
  });
});
