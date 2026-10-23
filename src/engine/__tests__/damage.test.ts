import { describe, expect, it } from 'vitest';
import { computeMultipliers, expectedMultiplier } from '../damage';
import type { Modifier, SkillDef } from '../types';

const skill: SkillDef = { id: 'x', name: 'x', kind: 'ruin', cooldown: 10, castTime: 0.5, directCoef: 100, hits: 1 };
const ctx = { skill, stacks: 4, component: 'direct' as const };

describe('damage buckets', () => {
  it('additive buckets sum, multiplicative buckets multiply', () => {
    const mods: Modifier[] = [
      { bucket: 'addDmg', value: 0.1, source: 'a' },
      { bucket: 'addDmg', value: 0.2, source: 'b' },
      { bucket: 'dmgToEnemy', value: 0.2, source: 'c' },
      { bucket: 'dmgToEnemy', value: 0.1, source: 'd' },
      { bucket: 'evoDmg', value: 0.5, source: 'e' },
    ];
    const m = computeMultipliers({ atkBase: 1 }, mods, ctx);
    expect(m.addDmg).toBeCloseTo(1.3);
    expect(m.dmgToEnemy).toBeCloseTo(1.2 * 1.1);
    expect(m.evoDmg).toBeCloseTo(1.5);
    expect(m.nonCrit).toBeCloseTo(1.3 * 1.32 * 1.5);
  });

  it('crit expectation: base 200%, critHitDmg only on crit part', () => {
    const mods: Modifier[] = [
      { bucket: 'critRate', value: 0.5, source: 'a' },
      { bucket: 'critDmg', value: 0.5, source: 'b' },
      { bucket: 'critHitDmg', value: 0.12, source: '회심' },
    ];
    const m = computeMultipliers({ atkBase: 1 }, mods, ctx);
    expect(expectedMultiplier(m)).toBeCloseTo(0.5 + 0.5 * 2.5 * 1.12);
  });

  it.each([
    [0.5, 0.5, 0.15], [0.8, 0.8, 0.15], [1, 0.8, 0.45], [1.199, 0.8, 0.7485], [1.2, 0.8, 0.75], [1.5, 0.8, 0.75],
  ])('caps the whole blunt thorn node, not other evolution damage, at raw crit %s', (rawCrit, crit, evo) => {
    const mods: Modifier[] = [{ bucket: 'critRate', value: rawCrit, source: 'a' }, { bucket: 'evoDmg', value: 0.4, source: 'other nodes' }];
    const m = computeMultipliers({ atkBase: 1, bluntThorn: { base: 0.15, ratio: 1.5, cap: 0.75 } }, mods, ctx);
    expect(m.critRate).toBeCloseTo(crit);
    expect(m.evoDmg).toBeCloseTo(1 + 0.4 + evo);
  });

  it('uses the supplied blunt thorn rank values', () => {
    const m = computeMultipliers({ atkBase: 1, bluntThorn: { base: 0.075, ratio: 1.25, cap: 0.525 } }, [{ bucket: 'critRate', value: 1.16, source: 'a' }], ctx);
    expect(m.evoDmg).toBeCloseTo(1.525);
  });

  it('filters: minStacks and component', () => {
    const mods: Modifier[] = [
      { bucket: 'skillDmg', value: 0.26, filter: { kinds: ['ruin'], minStacks: 4 }, source: '연회' },
      { bucket: 'stackEffectDmg', value: 0.8, filter: { minStacks: 4 }, source: '완비' },
    ];
    expect(computeMultipliers({ atkBase: 1 }, mods, { ...ctx, stacks: 3 }).skillDmg).toBe(1);
    expect(computeMultipliers({ atkBase: 1 }, mods, ctx).skillDmg).toBeCloseTo(1.26);
    expect(computeMultipliers({ atkBase: 1 }, mods, { ...ctx, component: 'stack' }).skillDmg).toBeCloseTo(1.26 * 1.8);
  });
});
