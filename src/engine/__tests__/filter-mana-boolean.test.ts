import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier, SkillFilter } from '../types';

function fixture(flag: unknown, usesMana: boolean | undefined, target: string) {
  const build = empressInkomsu440(); build.bluntThorn = undefined; build.onRuinAt4 = []; build.onDestiny = [];
  const mod: Modifier = { bucket: target === 'damage' ? 'dmgToEnemy' : 'cooldown', value: target === 'damage' ? 1 : 0.5,
    source: '마나 조건 통제', filter: { usesMana: flag as true } };
  build.passiveMods = [mod];
  const skill = { id: 'control', name: '마나 조건 통제', kind: 'normal' as const, usesMana, cooldown: 10, castTime: 0.5, hits: 1, directCoef: 1 };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const state = new SimState(build, createRng(1), []);
  return { state, mod, perform: () => target === 'damage' ? state.hit(skill, state.breakdown.get('control')!) : state.cast(skill, 20) };
}

describe.each(['damage', 'cooldown'])('%s mana filter', target => {
  describe.each([true, false, undefined])('skill mana use: %s', usesMana => {
    it.each(['false', null, 0, {}].map(flag => ({ flag })))('rejects non-boolean $flag', ({ flag }) => {
      const { state, perform } = fixture(flag, usesMana, target);
      expect(perform).toThrow('마나 사용 조건'); expect(state.total).toBe(0); expect(state.readyAt.size).toBe(0);
    });
    it.each([true, false, undefined])('preserves filter flag %s', flag => {
      const { state, perform } = fixture(flag, usesMana, target); perform();
      const matches = flag !== true || usesMana === true;
      if (target === 'damage') expect(state.total).toBe(matches ? 2 : 1);
      else expect(state.readyAt.get('control')).toBe(matches ? 5 : 10);
    });
  });
  it.each([{ kinds: ['ruin'] }, { excludeKinds: ['normal'] }, { ids: ['other'] }] satisfies SkillFilter[])
    ('preserves earlier skill exclusion %j', filter => {
      const { state, mod, perform } = fixture('false', false, target); Object.assign(mod.filter!, filter); perform();
      if (target === 'damage') expect(state.total).toBe(1); else expect(state.readyAt.get('control')).toBe(10);
    });
  it('checks the flag changed before the next application', () => {
    const { state, mod, perform } = fixture(false, false, target); perform(); state.advanceTo(11);
    mod.filter!.usesMana = 'false' as unknown as true; expect(perform).toThrow('마나 사용 조건');
  });
});

it('checks a mana filter supplied by an active cooldown buff', () => {
  const { state, mod, perform } = fixture('false', false, 'cooldown'); state.build.passiveMods = [];
  state.applyBuff({ id: 'bad', duration: 1, mod }); expect(perform).toThrow('마나 사용 조건');
  expect(state.readyAt.size).toBe(0);
});
