import { coreTestPassives, coreTestTooltip } from './core-fixture';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor } from '../presets';
import { cardSupplyWarnings } from '../cards';
import { createRng } from '../rng';
import { SimState } from '../sim';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function input(point = 14, ancient = false): RawArmory {
  const text = load('tests/fixtures/audit/2026-10-13-chain-draw-sources.json').sources[ancient ? 1 : 0].options.replaceAll('&apos;', "'");
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [], arkpassive: coreTestPassives(), engravings: null, gems: null,
    arkgrid: { Slots: [{ Index: 1, Name: '질서의 달 코어 : 체인 드로우', Point: point, Tooltip: coreTestTooltip(text) }] } };
}
function state(point = 14, proc = true) {
  const { build } = buildFromArmory(input(point));
  build.passiveMods = []; build.bluntThorn = undefined; build.onDestiny = ['drawCard'];
  build.params.gaugeGainBonus = 0; build.params.normalGaugePenalty = 0;
  build.params.gaugePerHit = { normal: 0.1, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  build.skills = [{ id: 'test', name: '통제 스킬', kind: 'normal', usesMana: true, directCoef: 0, hits: 1, cooldown: 0, castTime: 0 }];
  const chance = vi.fn(() => proc);
  return { sim: new SimState(build, { ...createRng(42), chance }, cardsFor('empress')), chance };
}
const play = (s: SimState, card: string) => { s.drawCards(1, card); s.useCardNow(card); };

describe('Chain Draw use trigger and hit gauge', () => {
  it.each([[13, undefined, undefined], [14, 0.25, undefined], [16, 0.25, undefined], [17, 0.25, 0.15]] as const)('reads point thresholds at %sP', (point, chance, gaugeBonus) => {
    const { build } = buildFromArmory(input(point));
    expect(build.chainDraw?.chance).toBe(chance); expect(build.chainDraw?.gaugeBonus).toBe(gaugeBonus);
  });
  it('reads the ancient 17% gauge value without replacing the existing stat bonus', () => {
    const base = buildFromArmory(input(16)).build, { build } = buildFromArmory(input(17, true));
    expect(build.chainDraw).toEqual({ chance: 0.25, gaugeBonus: 0.17 });
    expect(build.params.gaugeGainBonus).toBe(base.params.gaugeGainBonus);
    expect(cardSupplyWarnings(build).some(w => w.includes('체인 드로우') && w.includes('미검증'))).toBe(true);
  });
  it.each(['name', '14', '17'])('rejects a different core or extra clause: %s', change => {
    const raw = input(17), slot = raw.arkgrid!.Slots[0]!;
    if (change === 'name') slot.Name = '알 수 없는 코어';
    else slot.Tooltip = slot.Tooltip!.replace(`[${change}P] `, `[${change}P] 생명력이 50% 이하일 때 `);
    const { build, warnings } = buildFromArmory(raw);
    if (change !== '17') expect(build.chainDraw?.chance).toBeUndefined();
    if (change !== '14') expect(build.chainDraw?.gaugeBonus).toBeUndefined();
    expect(warnings.some(w => w.includes('미모델'))).toBe(true);
  });
  it('only rolls once after a real card use, not on draw or missing-card calls', () => {
    const { sim, chance } = state(); sim.useCardNow('star'); expect(chance).not.toHaveBeenCalled();
    sim.drawCards(1, 'star'); expect(chance).not.toHaveBeenCalled(); sim.useCardNow('star');
    expect(chance).toHaveBeenCalledTimes(1); expect(chance).toHaveBeenCalledWith(0.25);
    expect(sim.cardDraws.destiny).toBe(1); expect(sim.lastUsedCard()).toBe('star');
    expect(sim.deck.hand).toHaveLength(1);
  });
  it('does not roll for an unequipped core or grant a draw on failed probability', () => {
    const a = state(13), b = state(14, false); play(a.sim, 'star'); play(b.sim, 'star');
    expect(a.chance).not.toHaveBeenCalled(); expect(b.chance).toHaveBeenCalledTimes(1); expect(b.chance).toHaveBeenCalledWith(0.25);
    expect(a.sim.cardDraws.destiny).toBe(0); expect(b.sim.cardDraws.destiny).toBe(0);
  });
  it('processes Royal before destiny so a full hand cannot gain a third card', () => {
    const { sim, chance } = state(); sim.drawCards(1, 'cull'); play(sim, 'royal');
    expect(chance).toHaveBeenCalledTimes(1); expect(chance).toHaveBeenCalledWith(0.25);
    expect(sim.cardDraws.royal).toBe(1); expect(sim.cardDraws.destiny).toBe(0); expect(sim.deck.hand).toHaveLength(2);
  });
  it('does not treat Clown copying as an extra use and later uses the copy normally', () => {
    const { sim, chance } = state(14, false); play(sim, 'star');
    chance.mockReturnValue(true); play(sim, 'clown');
    expect(chance).toHaveBeenCalledTimes(2); expect(sim.cardDraws.clown).toBe(1); expect(sim.cardDraws.destiny).toBe(1);
    sim.useCardNow('star'); expect(chance).toHaveBeenCalledTimes(3); expect(sim.cardDraws.destiny).toBe(2);
  });
  it('does not recursively consume a newly drawn instant card in the same flush', () => {
    const { sim, chance } = state();
    const onlyStar = new SimState(sim.build, sim.rng, [{ id: 'star', name: '별', duration: 0, weight: 1, availability: ['empress'] }]);
    onlyStar.drawCards(1, 'star'); onlyStar.flushInstantCards();
    expect(chance).toHaveBeenCalledTimes(1); expect(onlyStar.cardDraws.destiny).toBe(1); expect(onlyStar.deck.hand).toEqual(['star']);
  });
  it('adds 17P only on the hit-gauge path under the existing additive approximation', () => {
    const { sim } = state(17, false); sim.build.params.gaugeGainBonus = 0.5; sim.skill('test').gaugeMultiplier = 1.4;
    sim.cast(sim.skill('test'), 10); expect(sim.deck.gauge).toBeCloseTo(0.1 * (1 + 0.5 + 0.15) * 1.4);
    play(sim, 'star'); expect(sim.deck.gauge).toBeCloseTo(0.1 * 1.65 * 1.4);
    sim.skill('test').kind = 'identity_card'; sim.cast(sim.skill('test'), 10);
    expect(sim.deck.gauge).toBeCloseTo(0.1 * 1.65 * 1.4);
  });
  it('does not multiply guaranteed card quantities or produce a draw without the sun effect', () => {
    const { sim } = state(17); sim.build.onDestiny = [];
    play(sim, 'star'); expect(sim.cardDraws.destiny).toBe(0);
    play(sim, 'royal'); expect(sim.cardDraws.royal).toBe(2); expect(sim.deck.hand).toHaveLength(2);
  });
});
