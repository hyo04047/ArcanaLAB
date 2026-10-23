import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { cardsFor } from '../presets';
import { coreTestPassives, coreTestTooltip } from './core-fixture';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-heart-sources.json', 'utf8'));
const profile = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-impact-mate-sources.json', 'utf8')).responses.profiles.data;
function input(point = 17, ancient = false): RawArmory {
  const core = structuredClone(source.core); core.Point = point; core.Gems = [];
  if (ancient) { core.Grade = '고대'; core.Tooltip = coreTestTooltip(source.db[1].options.replaceAll('&apos;', "'"), true); }
  return { profiles: profile, combatSkills: [], arkpassive: coreTestPassives(true), arkgrid: { Slots: [core] }, engravings: null, gems: null };
}
function state(point = 17, ancient = false) {
  const { build } = buildFromArmory(input(point, ancient));
  build.passiveMods = build.passiveMods.filter(m => m.source === '황제의 심장 17P');
  build.params.atkBase = 100; build.params.raidCaptainRatio = 0; build.bluntThorn = undefined;
  build.params.cardDamageCoef = { emperor: 2, empress_knight: 3 }; build.params.cardDamageFlat = { emperor: 30, empress_knight: 10 };
  build.anotherEmperorChance = 1; build.onCardUse = []; build.onDestiny = [];
  return new SimState(build, createRng(1), cardsFor('emperor', { add: ['empress_knight'] }));
}
const play = (s: SimState, id: string) => { s.drawCards(1, id); s.useCardNow(id); };
describe('Emperor Heart card damage scope', () => {
  it.each([[16, false, 1], [17, false, 1.15], [17, true, 1.2], [20, false, 1.15]] as const)('applies only the active grade at %sP ancient=%s', (point, ancient, factor) => {
    const s = state(point, ancient); play(s, 'emperor'); play(s, 'star');
    expect(s.breakdown.get('card_emperor')?.direct).toBeCloseTo(230 * factor);
    expect(s.breakdown.get('card_emperor_proc')?.direct).toBeCloseTo(230 * factor);
  });
  it('does not increase Knight, normal, or T skill damage', () => {
    const s = state(); play(s, 'empress_knight'); expect(s.breakdown.get('card_empress_knight')?.direct).toBe(310);
    for (const skill of [
      { id: 'dark_resurrection', kind: 'normal' as const, usesMana: true },
      { id: 'the_sun', kind: 'hyper_awakening' as const, tags: ['normal'], usesMana: true },
    ]) expect(computeMultipliers({ atkBase: 100 }, s.activeMods(), { skill: { ...skill, name: '', directCoef: 1, hits: 1, castTime: 0, cooldown: 0 }, stacks: 0, component: 'direct' }).skillDmg).toBe(1);
  });
  it('preserves separate Emperor gem and Edict multipliers on direct use and proc', () => {
    const s = state(); s.build.passiveMods.push(
      { bucket: 'skillDmg', value: 0.44, filter: { ids: ['card_emperor'] }, source: 'gem' },
      { bucket: 'skillDmg', value: 0.8, filter: { ids: ['card_emperor'] }, source: 'edict' });
    play(s, 'emperor'); play(s, 'star');
    for (const id of ['card_emperor', 'card_emperor_proc']) expect(s.breakdown.get(id)?.direct).toBeCloseTo(230 * 1.15 * 1.44 * 1.8);
  });
  it('does not invent base damage and keeps the unverified 14P warning', () => {
    const { build, warnings } = buildFromArmory(input()); expect(build.params.cardDamageCoef).toEqual({});
    expect(warnings.some(w => w.includes('황제의 심장 14P') && w.includes('미반영'))).toBe(true);
  });
  it.each(['condition', 'nodes'])('rejects unverified condition or missing nodes: %s', change => {
    const raw = input(), core = raw.arkgrid!.Slots[0]!;
    if (change === 'nodes') raw.arkpassive = coreTestPassives(false);
    else core.Tooltip = coreTestTooltip(source.db[0].options.replaceAll('&apos;', "'").replace('15.0% 증가한다.', '15.0% 증가한다. 생명력이 낮을 때'), true);
    expect(buildFromArmory(raw).build.passiveMods.some(m => m.source === '황제의 심장 17P')).toBe(false);
  });
});
