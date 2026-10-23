import { describe, expect, it } from 'vitest';
import { useCard } from '../cards';
import { computeMultipliers } from '../damage';
import { cardsFor, empressInkomsu440 } from '../presets';
import { SimState } from '../sim';
import { damageWarnings } from '../skilldata';
import { createRng } from '../rng';
import type { SkillDef } from '../types';

function input(effect: 'manaPoison' | 'fearOfDeath') {
  const build = empressInkomsu440();
  build.params.twistedFateZeroChance = 0;
  build.skills = [{ id: 'poison_control', name: '중독 통제', kind: 'normal', usesMana: true,
    cooldown: 10, castTime: 0.5, directCoef: 1, hits: 1,
    [effect]: { coef: 1, flat: 0, duration: 3, firstTick: 0.5, interval: 1, maxStacks: 1 } }];
  return build;
}

describe('card effect scope in poison warnings', () => {
  it.each(['manaPoison', 'fearOfDeath'] as const)('reports the excluded damage cards for %s', effect => {
    const build = input(effect), skill = build.skills[0]!;
    for (const card of ['twisted_fate', 'sovereign']) {
      const state = new SimState(build, createRng(1), cardsFor(build.variant));
      useCard(card, state);
      const mods = state.buffs.modsAt(0);
      expect(computeMultipliers({ atkBase: 100 }, mods, { skill, stacks: 4, component: 'direct' }).skillDmg).toBeGreaterThan(1);
      expect(computeMultipliers({ atkBase: 100 }, mods, { skill, stacks: 4, component: 'dot' }).skillDmg).toBe(1);
    }
    const warning = damageWarnings(build).find(text => text.startsWith('중독의 카드 버프:'));
    expect(warning).toContain('뒤틀린 운명·제후');
    expect(warning).toContain('미확인으로 임시 제외');
  });

  it('still applies the card critical effects to poison under the current model', () => {
    const build = input('fearOfDeath'), state = new SimState(build, createRng(1), cardsFor(build.variant));
    useCard('chancellor', state);
    expect(computeMultipliers({ atkBase: 100 }, state.buffs.modsAt(0), { skill: build.skills[0]!, stacks: 0, component: 'dot' }).critRate).toBe(0.2);
    useCard('cull', state);
    const m = computeMultipliers({ atkBase: 100 }, state.buffs.modsAt(0), { skill: build.skills[0]!, stacks: 0, component: 'dot' });
    expect(m.critRate).toBe(1); expect(m.critDmg).toBe(2.5);
  });

  it('omits poison-only scope guidance when neither poison effect is present', () => {
    const build = input('manaPoison');
    delete (build.skills[0] as SkillDef).manaPoison;
    expect(damageWarnings(build).some(text => text.startsWith('중독의 카드 버프:'))).toBe(false);
  });
});
