import { describe, expect, it } from 'vitest';
import { computeMultipliers } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier, SkillDef } from '../types';

function fixture(filter: unknown, target: string) {
  const build = empressInkomsu440(); build.bluntThorn = undefined; build.onRuinAt4 = []; build.onDestiny = [];
  const mod: Modifier = { bucket: target === 'damage' ? 'dmgToEnemy' : 'cooldown', value: target === 'damage' ? 1 : 0.5,
    source: '조건 객체 통제', filter: filter as Modifier['filter'] };
  const skill: SkillDef = { id: 'control', name: '통제', kind: 'normal', cooldown: 10, castTime: 0.5, hits: 1, directCoef: 1 };
  build.passiveMods = [mod]; build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const state = new SimState(build, createRng(1), []);
  return { state, skill, mod, perform: () => target === 'damage' ? state.hit(skill, state.breakdown.get('control')!) : state.cast(skill, 20) };
}

describe.each(['damage', 'cooldown'])('%s filter object', target => {
  it.each([null, false, true, 0, 2, '', 'normal', []].map(filter => ({ filter })))('rejects $filter', ({ filter }) => {
    const { state, perform } = fixture(filter, target);
    expect(perform).toThrow('스킬 조건'); expect(state.total).toBe(0); expect(state.readyAt.size).toBe(0);
  });
  it.each([
    { filter: undefined, matches: true }, { filter: {}, matches: true },
    { filter: { ids: ['control'] }, matches: true }, { filter: { ids: ['other'] }, matches: false },
    { filter: { futureProperty: true }, matches: true },
  ])('preserves $filter', ({ filter, matches }) => {
    const { state, perform } = fixture(filter, target); perform();
    if (target === 'damage') expect(state.total).toBe(matches ? 2 : 1);
    else expect(state.readyAt.get('control')).toBe(matches ? 5 : 10);
  });
  it('checks the filter replaced after an earlier application', () => {
    const { state, mod, perform } = fixture({}, target); perform(); state.advanceTo(11);
    mod.filter = false as unknown as Modifier['filter']; expect(perform).toThrow('스킬 조건');
  });
  it('checks an active buff filter', () => {
    const { state, mod, perform } = fixture(null, target); state.build.passiveMods = [];
    state.applyBuff({ id: 'bad', duration: 1, mod }); expect(perform).toThrow('스킬 조건');
    expect(state.total).toBe(0); expect(state.readyAt.size).toBe(0);
  });
});

it('keeps a filter unused after the dot scope excludes the modifier', () => {
  const { skill, mod } = fixture(null, 'damage'); mod.dotScope = 'exclude';
  expect(computeMultipliers({ atkBase: 1 }, [mod], { skill, stacks: 0, component: 'dot' }).nonCrit).toBe(1);
});

it('preserves the attack speed path that does not use a skill filter', () => {
  const { state, mod, perform } = fixture(null, 'cooldown'); mod.bucket = 'atkSpeed'; mod.value = 0.25; perform();
  expect(state.now).toBe(0.4); expect(state.total).toBe(1);
});

it('does not inspect a cooldown filter in a direct damage calculation', () => {
  const { state, skill, mod } = fixture(null, 'cooldown');
  state.hit(skill, state.breakdown.get('control')!); expect(state.total).toBe(1);
  expect(mod.filter).toBeNull();
});

it('does not inspect a filter from an expired buff', () => {
  const { state, mod, perform } = fixture(null, 'damage'); state.build.passiveMods = [];
  state.applyBuff({ id: 'expired', duration: 1, mod }); state.advanceTo(1); perform();
  expect(state.total).toBe(1);
});
