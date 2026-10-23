import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const saved = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
function input(edict = 80, another = 40, reverse = false): RawArmory {
  const effects: NonNullable<RawArmory['arkpassive']>['Effects'] = structuredClone(saved.arkpassive.data.Effects);
  const selected = effects.filter(e => /황제의 칙령|또 다른 황제/.test(e.Description));
  for (const e of selected) e.ToolTip = e.ToolTip!.replace(e.Description.includes('칙령') ? '80.0%' : '40.0%', `${e.Description.includes('칙령') ? edict : another}.0%`);
  return { profiles: saved.profiles.data, combatSkills: [], arkgrid: null, gems: null, engravings: null,
    arkpassive: { Effects: reverse ? selected.reverse() : selected } };
}
const isNode = (source: string) => /^(황제의 칙령|또 다른 황제)/.test(source);
function multiplier(raw: RawArmory, id = 'card_emperor', kind: SkillDef['kind'] = 'identity_card') {
  const { build } = buildFromArmory(raw);
  const skill: SkillDef = { id, name: id, kind, directCoef: 1, cooldown: 0, castTime: 0, hits: 1 };
  return computeMultipliers({ atkBase: 100 }, build.passiveMods.filter(m => isNode(m.source)), { skill, stacks: 0, component: 'direct' });
}

describe('Emperor passive damage addition candidate', () => {
  it.each([false, true])('adds the two supplied bonuses regardless of input order: %s', reverse => {
    expect(multiplier(input(80, 40, reverse)).skillDmg).toBeCloseTo(2.2);
    expect(multiplier(input(80, 40, reverse)).dmgToEnemy).toBeCloseTo(1.16);
  });
  it.each([[80, 0, 1.8], [40, 20, 1.6], [73, 17, 1.9], [0, 40, 1.4]])('reads %s + %s percent from the text', (edict, another, expected) => {
    expect(multiplier(input(edict, another)).skillDmg).toBeCloseTo(expected);
  });
  it.each(['card_empress_knight', 'the_sun', 'evoke'])('does not apply the card bonus to %s', id => {
    expect(multiplier(input(), id, id === 'evoke' ? 'normal' : id === 'the_sun' ? 'hyper_awakening' : 'identity_card').skillDmg).toBe(1);
  });
  it('does not infer the missing node from the remaining node', () => {
    const raw = input(); raw.arkpassive!.Effects = raw.arkpassive!.Effects.filter(e => e.Description.includes('또 다른 황제'));
    expect(multiplier(raw).skillDmg).toBeCloseTo(1.4);
  });
  it('does not use an unparsed conditional bonus', () => {
    const raw = input(), node = raw.arkpassive!.Effects.find(e => e.Description.includes('또 다른 황제'))!;
    node.ToolTip = node.ToolTip!.replace('적에게 주는 피해가', '생명력이 50% 이하일 때 적에게 주는 피해가');
    expect(multiplier(raw).skillDmg).toBeCloseTo(1.8);
  });
  it('keeps gems and Emperor Heart multiplicative for both direct use and the proc', () => {
    for (const card of ['emperor', 'star']) {
      const { build } = buildFromArmory(input());
      build.passiveMods = build.passiveMods.filter(m => isNode(m.source));
      build.passiveMods.push(
        { bucket: 'skillDmg', value: 0.44, filter: { ids: ['card_emperor'] }, source: 'gem control' },
        { bucket: 'skillDmg', value: 0.24, filter: { ids: ['card_emperor'] }, source: 'heart control' },
      );
      build.onCardUse = []; build.onDestiny = []; build.skills = []; build.bluntThorn = undefined;
      build.params.atkBase = 100; build.params.cardDamageCoef = { emperor: 2 }; build.params.cardDamageFlat = { emperor: 30 };
      const sim = new SimState(build, { ...createRng(42), chance: p => p === 0.2 }, cardsFor('emperor'));
      sim.drawCards(1, card); sim.useCardNow(card);
      expect(sim.total).toBeCloseTo(230 * 2.2 * 1.16 * 1.44 * 1.24);
      expect(sim.breakdown.get(card === 'emperor' ? 'card_emperor' : 'card_emperor_proc')?.casts).toBe(1);
    }
  });
  it('retains the unknown base damage and clearly identifies the provisional operation', () => {
    const { build, warnings } = buildFromArmory(input());
    expect(build.params.cardDamageCoef).toEqual({});
    expect(warnings.some(w => w.includes('합연산 후보') && w.includes('실측 미검증'))).toBe(true);
  });
});
