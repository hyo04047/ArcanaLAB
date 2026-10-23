import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { tooltipLines } from '../tooltip';
import { coreTestPassives, coreTestTooltip } from './core-fixture';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-impact-mate-sources.json', 'utf8'));
function input(point = 17): RawArmory {
  const core = structuredClone(source.core); core.Point = point; core.Gems = [];
  return { profiles: source.responses.profiles.data, combatSkills: [], arkpassive: coreTestPassives(true),
    arkgrid: { Slots: [core] }, engravings: null, gems: null };
}
function state(point = 17) {
  const { build } = buildFromArmory(input(point));
  build.passiveMods = []; build.params.atkBase = 100; build.bluntThorn = undefined;
  build.params.cardDamageCoef = { emperor: 1 }; build.params.raidCaptainRatio = 0;
  build.skills = [{ id: 'normal', name: '통제', kind: 'normal', castTime: 0, cooldown: 0, hits: 1, directCoef: 1 }];
  return new SimState(build, createRng(1), cardsFor('emperor'));
}
const value = (s: SimState) => computeMultipliers({ atkBase: 100 }, s.activeMods(),
  { skill: s.skill('normal'), stacks: 0, component: 'direct' }).dmgToEnemy;
const options = (raw: RawArmory) => tooltipLines(raw.arkgrid!.Slots[0]!.Tooltip).find(l => l.startsWith('[10P]'))!;

describe('Impact Mate destiny window', () => {
  it.each([[13, 1], [14, 1.1], [16, 1.1], [17, 1.15]])('honors %sP without granting passive damage', (point, expected) => {
    const s = state(point); expect(value(s)).toBe(1); s.triggerDestiny(); expect(value(s)).toBeCloseTo(expected);
  });
  it('replaces 10% with ancient 17% instead of adding or multiplying both', () => {
    const raw = input(), core = raw.arkgrid!.Slots[0]!;
    Object.assign(core, { Grade: '고대' }); core.Tooltip = core.Tooltip!.replace('15.0%', '17.0%');
    const { build } = buildFromArmory(raw);
    expect(build.onDestiny).toHaveLength(1);
    expect(build.onDestiny![0]).toMatchObject({ duration: 5, mod: { value: 0.17 } });
  });
  it('expires at five seconds and refreshes without stacking or adding duration', () => {
    const s = state(); s.triggerDestiny(); s.advanceTo(4.9); expect(value(s)).toBeCloseTo(1.15);
    s.triggerDestiny(); expect(value(s)).toBeCloseTo(1.15);
    s.advanceTo(9.899); expect(value(s)).toBeCloseTo(1.15); s.advanceTo(9.9); expect(value(s)).toBe(1);
  });
  it('affects an identity card only if it lands within the window', () => {
    const s = state(); s.triggerDestiny(); s.dealCardDamage('emperor', 1); expect(s.total).toBeCloseTo(115);
    s.advanceTo(5); s.dealCardDamage('emperor', 1); expect(s.total).toBeCloseTo(215);
  });
  it('receives the existing two-card Stack Hold trigger without creating extra card draws', () => {
    const s = state(); s.build.stackHold = true;
    s.drawCards(1, 'star'); s.useCardNow('star'); expect(value(s)).toBe(1);
    s.drawCards(1, 'star'); s.useCardNow('star'); expect(value(s)).toBeCloseTo(1.15);
    expect(s.cardDraws.destiny).toBe(0);
  });
  it('preserves permanent Checkmate-only effects separately from the timed global buff', () => {
    const { build } = buildFromArmory(input(20));
    expect(build.passiveMods.filter(m => m.source.startsWith('임팩트 메이트'))).toEqual([
      { bucket: 'skillDmg', value: 0.12, filter: { ids: ['checkmate'] }, source: '임팩트 메이트 10P' },
      ...[18, 19, 20].map(p => ({ bucket: 'skillDmg', value: 0.008, filter: { ids: ['checkmate'] }, source: `임팩트 메이트 ${p}P` })),
    ]);
  });
  it('does not create a 17P buff when the 14P definition is absent', () => {
    const raw = input(); raw.arkgrid!.Slots[0]!.Tooltip = coreTestTooltip(options(raw).replace(/\[14P\][\s\S]*?(?=\[17P\])/, ''), true);
    const result = buildFromArmory(raw); expect(result.build.onDestiny).toEqual([]);
    expect(result.warnings.some(w => w.includes('임팩트 메이트 17P') && w.includes('미반영'))).toBe(true);
  });
  it('does not ignore an unknown condition in the compound definition', () => {
    const raw = input(); raw.arkgrid!.Slots[0]!.Tooltip = coreTestTooltip(options(raw).replace('효과를 획득한다.', '효과를 획득한다. 생명력이 낮을 때'), true);
    const result = buildFromArmory(raw); expect(result.build.onDestiny).toEqual([]);
    expect(result.build.passiveMods.some(m => m.source === '임팩트 메이트 14P')).toBe(false);
  });
  it('keeps the valid 14P value and warns if the 17P replacement is unknown', () => {
    const raw = input(); raw.arkgrid!.Slots[0]!.Tooltip = coreTestTooltip(options(raw).replace('15.0%로 변경한다.', '15.0%로 변경한다. 생명력이 낮을 때'), true);
    const result = buildFromArmory(raw); expect(result.build.onDestiny![0]).toMatchObject({ mod: { value: 0.1 } });
    expect(result.warnings.some(w => w.includes('임팩트 메이트 17P') && w.includes('미반영'))).toBe(true);
  });
  it('requires the Emperor core activation nodes', () => {
    const raw = input(); raw.arkpassive = coreTestPassives(false);
    expect(buildFromArmory(raw).build.onDestiny).toEqual([]);
  });
});
