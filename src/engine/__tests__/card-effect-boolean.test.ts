import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const flags = ['fatalHandCull', 'stackHold', 'ruinFullset'] as const;
function fixture(flag: typeof flags[number], value: unknown) {
  const skill: SkillDef = { id: 'control', name: '연동 효과 통제', kind: 'ruin', cooldown: 1, castTime: 0.1, directCoef: 0, hits: 1 };
  const build = empressInkomsu440(); build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onCardUse = []; build.onDestiny = ['drawCard']; build.onRuinAt4 = []; build.ruinFullset = undefined; build.stackHold = undefined;
  build.params.fatalHandCull = false; build.params.gaugePerHit.ruin = 0;
  if (flag === 'fatalHandCull') build.params.fatalHandCull = value as boolean; else build[flag] = value as boolean;
  const state = new SimState(build, createRng(1), cardsFor('empress'));
  const activate = () => {
    if (flag === 'ruinFullset') for (let i = 0; i < 4; i++) state.hit(skill, state.breakdown.get(skill.id)!);
    else for (let i = 0; i < (flag === 'stackHold' ? 2 : 1); i++) {
      const card = flag === 'fatalHandCull' ? 'cull' : 'star'; state.drawCards(1, card); state.useCardNow(card);
    }
  };
  const bonus = () => state.activeMods().find(mod => mod.source === '도태' && mod.bucket === 'critDmg')?.value;
  return { state, activate, bonus };
}
describe.each(flags)('%s usage flag', flag => {
  it.each(['false', 'true', 0, 1, null, {}, []].map(value => ({ value })))('rejects $value instead of silently enabling/disabling', ({ value }) => {
    const { state, activate, bonus } = fixture(flag, value);
    expect(activate).toThrow('사용 여부'); expect(state.cardDraws.destiny).toBe(0); expect(bonus()).toBeUndefined();
  });
  it.each([false, true, undefined])('preserves %s at the actual effect', value => {
    const { state, activate, bonus } = fixture(flag, value); activate();
    if (flag === 'fatalHandCull') expect(bonus()).toBe(value === true ? 0.7 : 0.5);
    else expect(state.cardDraws.destiny).toBe(value === true ? 1 : 0);
  });
  it('checks a changed value when the effect runs', () => {
    const { state, activate } = fixture(flag, false);
    if (flag === 'fatalHandCull') state.fatalHandCull = 'false' as unknown as boolean;
    else state.build[flag] = 'false' as unknown as boolean;
    expect(activate).toThrow('사용 여부');
  });
});
it('does not inspect the Fatal Hand flag when a different card is used', () => {
  const { state } = fixture('fatalHandCull', 'false'); state.drawCards(1, 'star');
  expect(() => state.useCardNow('star')).not.toThrow();
});
it('does not inspect Stack Hold when no held card is used', () => {
  const { state } = fixture('stackHold', 'false'); expect(() => state.useCardNow('star')).not.toThrow();
});
