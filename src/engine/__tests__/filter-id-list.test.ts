import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier, SkillFilter } from '../types';

function fixture(ids: unknown, target: string, id = 'control') {
  const build = empressInkomsu440(); build.bluntThorn = undefined; build.onRuinAt4 = []; build.onDestiny = [];
  const mod: Modifier = { bucket: target === 'damage' ? 'dmgToEnemy' : 'cooldown', value: target === 'damage' ? 1 : 0.5,
    source: 'ID 조건 통제', filter: { ids: ids as string[] } };
  build.passiveMods = [mod];
  const skill = { id, name: 'ID 조건 통제', kind: 'normal' as const, cooldown: 10, castTime: 0.5, hits: 1, directCoef: 1 };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const state = new SimState(build, createRng(1), []);
  return { state, skill, mod, perform: () => target === 'damage' ? state.hit(skill, state.breakdown.get(id)!) : state.cast(skill, 20) };
}

describe.each(['damage', 'cooldown'])('%s exact skill ID condition', target => {
  it.each(['control-extra', '', null, false, 0, 1, {}, [null], [1], ['control', false]].map(ids => ({ ids })))
    ('rejects non-string-list $ids', ({ ids }) => {
      const { state, perform } = fixture(ids, target);
      expect(perform).toThrow('스킬 ID 조건'); expect(state.total).toBe(0); expect(state.readyAt.size).toBe(0);
    });
  it.each([
    { ids: undefined, matches: true }, { ids: [], matches: false }, { ids: ['control'], matches: true },
    { ids: ['control-extra'], matches: false }, { ids: ['other', 'control'], matches: true },
    { ids: ['__proto__', 'constructor'], matches: false },
  ])('preserves $ids with exact matching', ({ ids, matches }) => {
    const { state, perform } = fixture(ids, target); perform();
    if (target === 'damage') expect(state.total).toBe(matches ? 2 : 1);
    else expect(state.readyAt.get('control')).toBe(matches ? 5 : 10);
  });
  it.each([{ kinds: ['ruin'] }, { excludeKinds: ['normal'] }, { kinds: [] }] satisfies SkillFilter[])
    ('keeps earlier category exclusion %j', filter => {
      const { state, mod, perform } = fixture('control-extra', target); Object.assign(mod.filter!, filter); perform();
      if (target === 'damage') expect(state.total).toBe(1); else expect(state.readyAt.get('control')).toBe(10);
    });
  it('checks IDs changed before the next application', () => {
    const { state, mod, perform } = fixture(['control'], target); perform(); state.advanceTo(11);
    mod.filter!.ids = 'control-extra' as unknown as string[];
    expect(perform).toThrow('스킬 ID 조건');
  });
});

it('checks IDs supplied by an active cooldown buff', () => {
  const { state, mod, perform } = fixture('control-extra', 'cooldown'); state.build.passiveMods = [];
  state.applyBuff({ id: 'bad', duration: 1, mod }); expect(perform).toThrow('스킬 ID 조건');
  expect(state.readyAt.size).toBe(0);
});

it('keeps prototype-like skill IDs as exact string data', () => {
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  for (const id of ['__proto__', 'constructor', 'toString']) for (const target of ['damage', 'cooldown']) {
    const { state, perform } = fixture([id], target, id); perform();
    if (target === 'damage') expect(state.total).toBe(2); else expect(state.readyAt.get(id)).toBe(5);
  }
  expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype);
});
