import { coreTestPassives, coreTestTooltip } from './core-fixture';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor } from '../presets';
import { SimState } from '../sim';
import { createRng } from '../rng';
import { cardSupplyWarnings } from '../cards';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function input(point = 14): RawArmory {
  const source = load('tests/fixtures/audit/2026-10-13-ruin-minorset-sources.json');
  const slot = structuredClone(source.official.responses.arkgrid.data.Slots.find((s: { Name: string }) => s.Name.includes('루인 풀셋')));
  slot.Point = point; slot.Gems = [];
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: load('tests/fixtures/armory/FixtureCharacter26/combat-skills.json'),
    arkgrid: { Slots: [slot] }, arkpassive: coreTestPassives(), engravings: null, gems: null };
}
function state(point = 14) {
  const { build } = buildFromArmory(input(point));
  build.passiveMods = []; build.bluntThorn = undefined; build.onRuinAt4 = []; build.onDestiny = ['drawCard'];
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  for (const s of build.skills) { s.cooldown = 0; s.runeCdReduce = undefined; s.quickDraw = undefined; s.hitRune = undefined; s.onCast = []; s.onHit = []; }
  return new SimState(build, { ...createRng(1), chance: () => false }, cardsFor('empress'));
}
function cast(sim: SimState, id = 'secret_garden', stacks = 4) { sim.stacks = stacks; sim.cast(sim.skill(id), 100); }

describe('Ruin Fullset first-hit counting candidate', () => {
  it('imports the exact 14P sentence from the actual core, with or without its final period', () => {
    for (const period of ['', '.']) {
      const raw = input(), slot = raw.arkgrid!.Slots[0]!;
      slot.Tooltip = coreTestTooltip(`[10P] 초각성 스킬을 제외한 루인 스킬의 피해량이 2.8% 증가한다. [14P] 루인 스킬 4회 적중 시 '운명'이 발동한다${period}`);
      expect(buildFromArmory(raw).build.ruinFullset).toBe(true);
    }
    const { build, warnings } = buildFromArmory(input(18));
    expect(build.ruinFullset).toBe(true);
    expect(build.passiveMods.find(m => m.source === '루인 풀셋 17P')?.value).toBe(0.055);
    expect(warnings.some(w => w.includes('루인 풀셋 14P') && w.includes('미모델'))).toBe(false);
    expect(cardSupplyWarnings(build).some(w => w.includes('루인 풀셋') && w.includes('미검증'))).toBe(true);
  });
  it('does not trigger below 14P or from a different core name or changed condition', () => {
    const base = state(13); for (let i = 0; i < 8; i++) cast(base);
    expect(base.cardDraws.destiny).toBe(0);
    for (const change of ['name', 'condition']) {
      const raw = input(), slot = raw.arkgrid!.Slots[0]!;
      if (change === 'name') slot.Name = '질서의 달 코어 : 알 수 없는 코어';
      else slot.Tooltip = slot.Tooltip!.replace('적중 시', '치명타 적중 시');
      const { build, warnings } = buildFromArmory(raw);
      expect(build.ruinFullset).toBeUndefined();
      expect(warnings.some(w => w.includes('14P') && w.includes('미모델'))).toBe(true);
    }
  });
  it.each([0, 4])('counts one successful skill use regardless of %s stacks, with no double count for explosion', stacks => {
    const sim = state();
    for (let i = 0; i < 3; i++) cast(sim, 'secret_garden', stacks);
    expect(sim.cardDraws.destiny).toBe(0); cast(sim, 'secret_garden', stacks);
    expect(sim.cardDraws.destiny).toBe(1);
    for (let i = 0; i < 4; i++) cast(sim, 'secret_garden', stacks);
    expect(sim.cardDraws.destiny).toBe(2);
  });
  it.each([false, true])('counts Serendipity once across its normal/Judgment combo, Judgment=%s', judgment => {
    const sim = state();
    if (judgment) sim.applyBuff({ id: 'judgment', duration: 50, mod: { bucket: 'skillDmg', value: 0, source: '통제 심판' } });
    cast(sim, 'serendipity'); cast(sim); cast(sim);
    expect(sim.cardDraws.destiny).toBe(0); cast(sim);
    expect(sim.cardDraws.destiny).toBe(1); expect(sim.ruinCasts).toBe(4);
  });
  it('includes Devil but excludes normal, stack, awakening and non-ruin T skills', () => {
    const sim = state(), other = sim.skill('call_of_destiny');
    for (const kind of ['normal', 'stack', 'awakening', 'hyper_awakening'] as const) {
      other.kind = kind; other.tags = []; for (let i = 0; i < 4; i++) cast(sim, other.id);
    }
    expect(sim.cardDraws.destiny).toBe(0);
    for (let i = 0; i < 4; i++) cast(sim, 'the_devil');
    expect(sim.cardDraws.destiny).toBe(1);
  });
  it('triggers at the first delayed hit, once for the cast and only after its damage', () => {
    const sim = state(), s = sim.skill('celestial_rain');
    for (let i = 0; i < 3; i++) cast(sim);
    sim.build.onDestiny = [{ id: 'test_destiny', duration: 10, mod: { bucket: 'skillDmg', value: 1, source: '통제 운명' } }];
    s.mods = []; s.castTime = 1; s.directCoef = 1; s.directFlat = 0;
    s.delayedHits = { duration: 1, spawnAt: 0, hits: [{ after: 2, directCoef: 1, directFlat: 0 }, { after: 3, directCoef: 1, directFlat: 0 }] };
    const start = sim.now; sim.stacks = 0; sim.cast(s, 100);
    expect(sim.buffs.has('test_destiny', sim.now)).toBe(false);
    sim.advanceTo(start + 2 - 1e-6); expect(sim.buffs.has('test_destiny', sim.now)).toBe(false);
    sim.advanceTo(start + 2); const first = sim.breakdown.get(s.id)!.direct;
    expect(sim.buffs.has('test_destiny', sim.now)).toBe(true);
    sim.advanceTo(start + 3); expect(sim.breakdown.get(s.id)!.direct).toBeCloseTo(first * 3);
    sim.build.onDestiny = ['drawCard']; cast(sim); cast(sim);
    expect(sim.cardDraws.destiny).toBe(0); cast(sim); cast(sim);
    expect(sim.cardDraws.destiny).toBe(1);
  });
  it('does not count an input truncated before any hit', () => {
    const sim = state(); for (let i = 0; i < 3; i++) cast(sim);
    const s = sim.skill('secret_garden'), start = sim.now;
    sim.cast(s, start + s.castTime / 2); expect(sim.cardDraws.destiny).toBe(0);
    cast(sim); expect(sim.cardDraws.destiny).toBe(1);
  });
  it('consumes a completed cycle while the hand is full, without carrying a pending card', () => {
    const sim = state(); sim.drawCards(2);
    for (let i = 0; i < 4; i++) cast(sim);
    expect(sim.cardDraws.destiny).toBe(0); sim.deck.use(sim.deck.hand[0]!);
    for (let i = 0; i < 3; i++) cast(sim);
    expect(sim.cardDraws.destiny).toBe(0); cast(sim);
    expect(sim.cardDraws.destiny).toBe(1);
  });
  it('keeps partial counts across waiting and handles gauge before destiny on the same hit', () => {
    const sim = state(); for (let i = 0; i < 3; i++) cast(sim);
    sim.advanceTo(50); sim.deck.gauge = 0.9; sim.build.params.gaugePerHit.ruin = 0.2;
    cast(sim); expect(sim.cardDraws.gauge).toBe(1); expect(sim.cardDraws.destiny).toBe(1);
    expect(sim.deck.hand).toHaveLength(2);
  });
  it('does not turn a fullset trigger into a draw without an equipped sun-core effect', () => {
    const sim = state(); sim.build.onDestiny = [];
    for (let i = 0; i < 4; i++) cast(sim);
    expect(sim.cardsDrawn).toBe(0);
  });
});
