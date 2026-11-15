import { describe, expect, it } from 'vitest';
import { computeMultipliers } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Bucket, Modifier, SkillDef } from '../types';

function fixture(bucket: unknown, placement: string) {
  const build = empressInkomsu440(); build.bluntThorn = undefined; build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = [];
  const mod: Modifier = { bucket: bucket as Bucket, value: 0.25, source: '계산 분류 통제' };
  const skill: SkillDef = { id: 'control', name: '통제', kind: 'normal', cooldown: 10, castTime: 0.5, directCoef: 1, hits: 1 };
  build.passiveMods = placement === 'passive' ? [mod] : [];
  if (placement === 'skill') skill.mods = [mod];
  if (placement === 'buff') skill.onCast = [{ id: 'control-buff', duration: 2, mod }];
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  const state = new SimState(build, createRng(1), []);
  return { state, skill, mod, perform: () => state.cast(skill, 20) };
}

describe.each(['passive', 'skill', 'buff'])('%s modifier bucket', placement => {
  it.each(['dmgToenEmy', undefined, null, false, 0, '', {}, []].map(bucket => ({ bucket })))('rejects $bucket', ({ bucket }) => {
    const { state, perform } = fixture(bucket, placement);
    expect(perform).toThrow('수정치 계산 분류'); expect(state.total).toBe(0);
  });
  it('checks a modifier changed after a completed cast', () => {
    const { state, mod, perform } = fixture('dmgToEnemy', placement); perform();
    expect(state.total).toBe(1.25); state.advanceTo(11); mod.bucket = 'bad' as Bucket;
    expect(perform).toThrow('수정치 계산 분류'); expect(state.total).toBe(1.25);
  });
});

it.each(['direct', 'stack', 'dot'] as const)('rejects an unknown bucket in the %s damage helper', component => {
  const { skill, mod } = fixture('skillDamage', 'skill'); mod.dotScope = 'exclude';
  expect(() => computeMultipliers({ atkBase: 1 }, [mod], { skill, stacks: 4, component })).toThrow('수정치 계산 분류');
});

it.each(['atk', 'atkFlat', 'addDmg', 'dmgToEnemy', 'evoDmg', 'critRate', 'critDmg', 'critHitDmg',
  'skillDmg', 'emperorCardDmg', 'stackEffectDmg', 'atkSpeed', 'moveSpeed', 'cooldown'] as const)(
  'accepts the supported %s bucket without rewriting the modifier', bucket => {
    const { state, skill, mod } = fixture(bucket, 'passive'), before = structuredClone(mod);
    const result = computeMultipliers({ atkBase: 1 }, [mod], { skill, stacks: 4, component: 'stack' });
    expect(Object.values(result).every(Number.isFinite)).toBe(true);
    expect(state.activeMods()).toEqual([before]); expect(mod).toEqual(before);
  });

it.each(['__proto__', 'constructor', 'toString'])('rejects the inherited object name %s', bucket => {
  expect(fixture(bucket, 'passive').perform).toThrow('수정치 계산 분류');
});

it('leaves an expired unknown buff unused', () => {
  const { state, skill, mod, perform } = fixture('bad', 'buff'); skill.onCast = [];
  state.applyBuff({ id: 'expired', duration: 0.1, mod }); state.advanceTo(1); perform();
  expect(state.total).toBe(1); expect(state.readyAt.get('control')).toBe(11);
});

it('leaves untriggered card buffs and unused skill modifiers untouched', () => {
  const { state, skill, mod, perform } = fixture('bad', 'skill'); skill.mods = [];
  state.build.onCardUse = [{ id: 'unused', duration: 1, mod }];
  state.build.skills.push({ ...skill, id: 'unused', mods: [mod] }); perform();
  expect(state.total).toBe(1);
});

it('does not inspect an excluded value in a known damage bucket', () => {
  const { state, mod, perform } = fixture('dmgToEnemy', 'passive');
  mod.filter = { ids: ['other'] }; mod.value = 'bad' as unknown as number; perform();
  expect(state.total).toBe(1);
});

it('preserves the dot exclusion of a known bucket before its value is used', () => {
  const { skill, mod } = fixture('skillDmg', 'skill'); mod.value = 'bad' as unknown as number;
  const result = computeMultipliers({ atkBase: 1 }, [mod], { skill, stacks: 0, component: 'dot' });
  expect(result.nonCrit).toBe(1);
});
