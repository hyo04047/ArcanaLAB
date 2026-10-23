import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const refs = load('tests/fixtures/audit/2026-10-13-identity-gems-sources.json').refs as { character: string; data: RawArmory['gems'] }[];
function input(gems = refs[0]!.data): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [],
    arkpassive: { Effects: [{ Name: '깨달음', Description: '깨달음 1티어 황제의 칙령 Lv.3' }] },
    arkgrid: null, engravings: null, gems };
}
const card: SkillDef = { id: 'card_emperor', name: '황제', kind: 'identity_card', usesMana: false, directCoef: 2, directFlat: 30, hits: 1, cooldown: 0, castTime: 0 };
describe('official identity gem conversion', () => {
  it.each(refs)('maps $character Emperor damage gem exactly once and only to Emperor', ref => {
    const { build } = buildFromArmory(input(ref.data));
    const line = ref.data!.Effects!.Skills!.find(s => s.Name === '황제')!.Description![0]!;
    const value = Number(line.match(/[\d.]+/)![0]) / 100;
    const mods = build.passiveMods.filter(m => m.source === '보석 황제');
    expect(mods).toHaveLength(1); expect(mods[0]!.value).toBe(value);
    for (const target of [card, { ...card, id: 'card_empress_knight' }, { ...card, id: 'the_sun', kind: 'hyper_awakening' as const, tags: ['normal'] }, { ...card, id: 'evoke', kind: 'normal' as const }]) {
      expect(computeMultipliers({ atkBase: 100 }, mods, { skill: target, component: 'direct', stacks: 0 }).skillDmg)
        .toBeCloseTo(target.id === card.id ? 1 + value : 1, 12);
    }
    expect(mods.some(m => m.bucket === 'atk' || m.bucket === 'atkFlat')).toBe(false);
  });
  it.each(refs)('uses $character gem on both card damage terms without filling unknown base damage', ref => {
    const { build } = buildFromArmory(input(ref.data));
    build.passiveMods = build.passiveMods.filter(m => m.source === '보석 황제');
    build.params.atkBase = 100; build.bluntThorn = undefined;
    const empty = new SimState(build, createRng(1), cardsFor('emperor'));
    empty.drawCards(1, 'emperor'); empty.useCardNow('emperor'); expect(empty.total).toBe(0);
    build.params.cardDamageCoef = { emperor: 2 }; build.params.cardDamageFlat = { emperor: 30 };
    const sim = new SimState(build, createRng(1), cardsFor('emperor'));
    sim.drawCards(1, 'emperor'); sim.useCardNow('emperor');
    expect(sim.total).toBeCloseTo(230 * (ref.character === refs[0]!.character ? 1.44 : 1.36), 10);
  });
  it('reports an unknown gem target instead of silently dropping it', () => {
    const { warnings } = buildFromArmory(input({ Effects: { Skills: [{ Name: '새 카드 이름', Description: ['피해 44.00% 증가'] }] } }));
    expect(warnings.some(w => w.includes('보석 대상 미지원: 새 카드 이름'))).toBe(true);
  });
});
