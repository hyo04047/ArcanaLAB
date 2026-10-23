import { coreTestPassives, coreTestTooltip } from './core-fixture';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { SimState } from '../sim';
import { createRng } from '../rng';
import { cardsFor } from '../presets';
import { cardSupplyWarnings } from '../cards';
import { computeMultipliers } from '../damage';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function input(point = 17): RawArmory {
  const options = load('tests/fixtures/audit/2026-10-13-fatal-hand-sources.json').relicDb.options.replace(/(\d)\s+초/g, '$1초');
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [], arkpassive: coreTestPassives(), engravings: null, gems: null,
    arkgrid: { Slots: [{ Index: 2, Name: '질서의 별 코어 : 페이탈 핸드', Point: point, Tooltip: coreTestTooltip(options) }] } };
}
function state(point: number, hitProc = false) {
  const { build } = buildFromArmory(input(point));
  build.passiveMods = []; build.bluntThorn = undefined; build.onRuinAt4 = [];
  build.params.atkBase = 1; build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  build.skills = [{ id: 'ruin', name: '통제 루인', kind: 'ruin', directCoef: 1, hits: 1, castTime: 0, cooldown: 0 }];
  return new SimState(build, { ...createRng(1), chance: () => hitProc }, cardsFor('empress'));
}
function play(sim: SimState, card: string) { sim.drawCards(1, card); sim.useCardNow(card); }
function crit(sim: SimState) { return computeMultipliers({ atkBase: 1 }, sim.activeMods(), { skill: sim.skill('ruin'), stacks: 0, component: 'direct' }).critDmg; }

describe('Fatal Hand parsed card effects', () => {
  it.each([[9, 4], [10, 6]])('applies only Twisted Fate duration at %s points', (point, duration) => {
    const sim = state(point); play(sim, 'twisted_fate');
    expect(sim.buffs.remaining('twisted_fate', 0)).toBe(duration);
    expect(sim.buffs.has('twisted_fate', duration - 1e-6)).toBe(true);
    expect(sim.buffs.has('twisted_fate', duration)).toBe(false);
    play(sim, 'cull'); play(sim, 'judgment');
    expect(sim.buffs.remaining('cull_dmg', 0)).toBe(4); expect(sim.buffs.remaining('judgment', 0)).toBe(4);
  });
  it('keeps scheme duration on Cull/Judgment separate from the core duration', () => {
    const sim = state(14); sim.build.cardDurationBonus = { ...sim.build.cardDurationBonus, cull: 2, judgment: 2 };
    for (const card of ['twisted_fate', 'cull', 'judgment']) play(sim, card);
    expect(sim.buffs.remaining('twisted_fate', 0)).toBe(6);
    expect(sim.buffs.remaining('cull_dmg', 0)).toBe(6); expect(sim.buffs.remaining('judgment', 0)).toBe(6);
  });
  it('refreshes copied Twisted Fate duration without adding the previous remainder', () => {
    const sim = state(10); play(sim, 'twisted_fate'); sim.advanceTo(3); play(sim, 'clown'); sim.useCardNow('twisted_fate');
    expect(sim.buffs.remaining('twisted_fate', 3)).toBe(6);
    expect(sim.activeMods().filter(m => m.source === '뒤틀린 운명')).toHaveLength(1);
  });
  it.each([[13, 0.5], [14, 0.7]])('adds the card bonus to existing crit damage at %s points', (point, bonus) => {
    const sim = state(point); sim.build.passiveMods = [{ bucket: 'critDmg', value: 0.8, source: '통제 치피' }];
    play(sim, 'cull'); expect(crit(sim)).toBeCloseTo(2.8 + bonus);
    sim.advanceTo(1); play(sim, 'cull'); expect(crit(sim)).toBeCloseTo(2.8 + bonus);
    expect(sim.buffs.remaining('cull_dmg', 1)).toBe(4);
    sim.advanceTo(5); expect(crit(sim)).toBeCloseTo(2.8);
  });
  it.each([[16, 0.1], [17, 0.12]])('replaces the corrosion value after a successful attack at %s points', (point, value) => {
    const sim = state(point, true); play(sim, 'corrosion');
    expect(sim.buffs.remaining('corrosion_window', 0)).toBe(30);
    expect(sim.activeMods().some(m => m.source === '부식' && m.bucket === 'dmgToEnemy')).toBe(false);
    sim.cast(sim.skill('ruin'), 10);
    expect(sim.activeMods().find(m => m.source === '부식' && m.bucket === 'dmgToEnemy')?.value).toBe(value);
    expect(sim.buffs.remaining('corrosion', 0)).toBe(5);
    sim.advanceTo(5); expect(sim.buffs.has('corrosion', sim.now)).toBe(false);
  });
  it('does not apply corruption before a successful roll', () => {
    const sim = state(17); play(sim, 'corrosion'); sim.cast(sim.skill('ruin'), 10);
    expect(sim.buffs.has('corrosion', 0)).toBe(false);
  });
  it('accepts the compact percentage spelling and reads the supplied grade value', () => {
    const raw = input(), slot = raw.arkgrid!.Slots[0]!;
    slot.Tooltip = slot.Tooltip!.replace('12.0% 로', '13.0%로');
    expect(buildFromArmory(raw).build.params.corrosionValue).toBe(0.13);
  });
  it('does not apply any card clause from a differently named core', () => {
    const raw = input(), slot = raw.arkgrid!.Slots[0]!; slot.Name = '알 수 없는 코어';
    const { build, warnings } = buildFromArmory(raw);
    expect(build.params.fatalHandCull).toBe(false); expect(build.params.twistedFateZeroChance).toBe(0.25);
    expect(build.params.corrosionValue).toBe(0.1); expect(build.cardDurationBonus?.twisted_fate).toBeUndefined();
    expect(warnings.filter(w => w.includes('미모델') && w.includes('알 수 없는 코어'))).toHaveLength(3);
  });
  it.each(['10', '14', '17'])('rejects an extra condition rather than partially applying the %sP clause', point => {
    const raw = input(), slot = raw.arkgrid!.Slots[0]!;
    slot.Tooltip = slot.Tooltip!.replace(`[${point}P] `, `[${point}P] 생명력이 50% 이하일 때 `);
    const { build, warnings } = buildFromArmory(raw);
    if (point === '10') { expect(build.cardDurationBonus?.twisted_fate).toBeUndefined(); expect(build.params.twistedFateZeroChance).toBe(0.25); }
    if (point === '14') expect(build.params.fatalHandCull).toBe(false);
    if (point === '17') expect(build.params.corrosionValue).toBe(0.1);
    expect(warnings.some(w => w.includes(`${point}P`) && w.includes('미모델'))).toBe(true);
  });
  it('retains placeholder odds and declares them instead of treating 2/100 as the exact rate', () => {
    const { build, warnings } = buildFromArmory(input());
    expect(build.params.twistedFateZeroChance).toBe(0.05);
    expect(warnings.some(w => w.includes('5%') && w.includes('임시'))).toBe(true);
    expect(cardSupplyWarnings(build).some(w => w.includes('도태') && w.includes('미검증'))).toBe(true);
  });
});
