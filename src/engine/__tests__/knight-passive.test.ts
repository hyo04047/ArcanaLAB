import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const refs = load('tests/fixtures/audit/2026-10-13-knight-passive-sources.json').refs;
const nodes = refs.map((r: { data: RawArmory['arkpassive'] }) => r.data!.Effects.find(e => e.Description.includes('황후의 기사'))!);
function input(node = nodes[0], emperor = false): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [],
    arkpassive: { Effects: [node, ...(emperor ? [{ Name: '깨달음', Description: '깨달음 1티어 황제의 칙령 Lv.1', ToolTip: JSON.stringify({ value: '카드덱에 황제 카드가 추가된다.' }) }] : [])] },
    arkgrid: null, engravings: null, gems: null };
}

describe('Empress Knight passive', () => {
  it.each([false, true])('adds the card once and scopes live level 5 damage (Emperor %s)', emperor => {
    const { build } = buildFromArmory(input(nodes[0], emperor));
    expect(cardsFor(build.variant, build.deckOverrides).filter(c => c.id === 'empress_knight')).toHaveLength(1);
    const mods = build.passiveMods.filter(m => m.source.startsWith('황후의 기사'));
    expect(mods).toHaveLength(1);
    for (const id of ['card_empress_knight', 'card_emperor', 'the_sun', 'celestial_rain']) {
      const skill: SkillDef = { id, name: id, kind: 'identity_card', directCoef: 1, hits: 1, cooldown: 0, castTime: 0 };
      expect(computeMultipliers({ atkBase: 100 }, mods, { skill, stacks: 0, component: 'direct' }).nonCrit).toBe(id === 'card_empress_knight' ? 5 : 1);
    }
  });
  it('applies 400 percent to both supplied damage terms and preserves a single draw', () => {
    const build = buildFromArmory(input()).build;
    build.passiveMods = build.passiveMods.filter(m => m.source.startsWith('황후의 기사'));
    build.params.atkBase = 100; build.params.cardDamageCoef = { empress_knight: 2 }; build.params.cardDamageFlat = { empress_knight: 30 };
    const sim = new SimState(build, createRng(1), cardsFor(build.variant, build.deckOverrides));
    sim.drawCards(1, 'empress_knight'); sim.useCardNow('empress_knight');
    expect(sim.total).toBe((30 + 2 * 100) * 5); expect(sim.cardDraws.empressKnight).toBe(1);
    expect(sim.deck.hand).toHaveLength(1); expect(sim.deck.gauge).toBe(0);
  });
  it('keeps the unknown basic card damage zero and still draws a replacement card', () => {
    const build = buildFromArmory(input()).build;
    expect(build.params.cardDamageCoef).toEqual({});
    const sim = new SimState(build, createRng(1), cardsFor(build.variant, build.deckOverrides));
    sim.drawCards(1, 'empress_knight'); sim.useCardNow('empress_knight');
    expect(sim.total).toBe(0); expect(sim.cardDraws.empressKnight).toBe(1);
  });
  it('reads actual level 1 card addition without inventing a damage modifier', () => {
    const { build, warnings } = buildFromArmory(input(nodes[1]));
    expect(build.deckOverrides?.add).toContain('empress_knight');
    expect(build.passiveMods.some(m => m.source.startsWith('황후의 기사'))).toBe(false);
    expect(warnings.some(w => w.includes('황후의 기사') && w.includes('문구 미확인'))).toBe(false);
  });
  it('uses the supplied percentage instead of multiplying the node level', () => {
    const node = structuredClone(nodes[0]); node.ToolTip = node.ToolTip.replace('400.0%', '275.0%');
    expect(buildFromArmory(input(node)).build.passiveMods.find(m => m.source.startsWith('황후의 기사'))!.value).toBe(2.75);
  });
  it.each([undefined, '카드덱에 황후의 기사 카드가 추가되고, 치명타 적중 시 황후의 기사 카드의 피해량이 400.0% 증가한다.'])('reports missing or conditional damage text', text => {
    const node = structuredClone(nodes[0]); node.ToolTip = text === undefined ? undefined : JSON.stringify({ value: text });
    const { build, warnings } = buildFromArmory(input(node));
    expect(build.passiveMods.some(m => m.source.startsWith('황후의 기사'))).toBe(false);
    expect(warnings.some(w => w.includes('황후의 기사') && w.includes('문구 미확인'))).toBe(true);
  });
});
