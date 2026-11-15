import { describe, expect, it, vi } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function control() {
  const skill: SkillDef = { id: 'control', name: '통제', kind: 'normal', cooldown: 10, castTime: 0.1, hits: 1, directCoef: 0 };
  const build = empressInkomsu440();
  build.skills = [skill]; build.passiveMods = []; build.onDestiny = []; build.onRuinAt4 = [];
  build.params.gaugePerHit.normal = 0;
  return { build, skill };
}
const invalid = [null, undefined, '2', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
const cases = invalid.flatMap(value => [
  { field: 'hits', value }, { field: 'attempts', value },
  ...(value === undefined ? [] : [{ field: 'maxCharges', value }]),
]).concat([{ field: 'maxCharges', value: 0 }]);
function set(skill: SkillDef, field: string, value: unknown) {
  if (field === 'attempts') skill.quickDraw = { chance: 0, trigger: 'each', attempts: value as number };
  else Object.assign(skill, { [field]: value });
}

describe('integer skill counts before state or RNG changes', () => {
  it.each(cases)('rejects initial $field = $value', ({ field, value }) => {
    const { build, skill } = control(); set(skill, field, value);
    expect(() => new SimState(build, createRng(1), [])).toThrow('횟수');
  });
  it.each(['cast', 'hit'] as const)('rejects mutated counts before %s changes state', method => {
    for (const field of ['hits', 'attempts', 'maxCharges']) {
      const { build, skill } = control(), rng = createRng(1), chance = vi.spyOn(rng, 'chance');
      const sim = new SimState(build, rng, []), b = sim.breakdown.get(skill.id)!;
      set(skill, field, 1.5);
      expect(() => method === 'cast' ? sim.cast(skill, 1) : sim.hit(skill, b)).toThrow('횟수');
      expect([sim.now, sim.total, sim.deck.gauge, b.casts, b.direct, sim.readyAt.size]).toEqual([0, 0, 0, 0, 0, 0]);
      expect(chance).not.toHaveBeenCalled();
    }
  });
  it('rejects an explicitly null Quick Draw configuration', () => {
    const { build, skill } = control(); Object.assign(skill, { quickDraw: null });
    expect(() => new SimState(build, createRng(1), [])).toThrow('횟수');
  });
  it.each([undefined, 1, 2])('preserves zero hit/trial controls and charge limit %s', maxCharges => {
    const { build, skill } = control(); skill.hits = 0; skill.maxCharges = maxCharges;
    skill.quickDraw = { chance: 1, trigger: 'each', attempts: 0 };
    const sim = new SimState(build, createRng(1), []);
    for (let i = 0; i < (maxCharges ?? 1); i++) { expect(sim.isReady(skill.id)).toBe(true); sim.cast(skill, 1); }
    expect(sim.isReady(skill.id)).toBe(false); expect(sim.cardsDrawn).toBe(0);
    expect(sim.breakdown.get(skill.id)!.casts).toBe(maxCharges ?? 1);
  });
  it('accepts safe integer boundaries without executing the huge counts', () => {
    const { build, skill } = control(); skill.hits = Number.MAX_SAFE_INTEGER; skill.maxCharges = Number.MAX_SAFE_INTEGER;
    skill.quickDraw = { chance: 0, trigger: 'each', attempts: Number.MAX_SAFE_INTEGER };
    expect(() => new SimState(build, createRng(1), [])).not.toThrow();
  });
});
