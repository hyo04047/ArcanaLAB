import { describe, expect, it, vi } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function control() {
  const skill: SkillDef = { id: 'control', name: '통제', kind: 'stack', cooldown: 1, castTime: 0.1, hits: 1, directCoef: 0 };
  const build = empressInkomsu440(); build.skills = [skill]; build.passiveMods = []; build.onDestiny = []; build.onRuinAt4 = [];
  build.params.gaugePerHit.stack = 0;
  const rng = createRng(1); return { build, skill, rng };
}
const invalid: unknown[] = [null, '2', -0.1, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, true];
const balance = { id: 'balance', duration: 5, mod: { bucket: 'skillDmg' as const, value: 0, source: '통제' } };
describe('integer target stack grants', () => {
  it.each(invalid.flatMap(value => (['constructor', 'cast', 'hit'] as const).map(entry => ({ value, entry }))))(
    'rejects $value at $entry before damage and RNG', ({ value, entry }) => {
      const { build, skill, rng } = control(), chance = vi.spyOn(rng, 'chance');
      if (entry === 'constructor') {
        skill.stacksGranted = value as number;
        expect(() => new SimState(build, rng, [])).toThrow('부여 스택');
      } else {
        const sim = new SimState(build, rng, []), b = sim.breakdown.get(skill.id)!; skill.stacksGranted = value as number;
        expect(() => entry === 'cast' ? sim.cast(skill, 1) : sim.hit(skill, b)).toThrow('부여 스택');
        expect([sim.now, sim.total, sim.stacks, b.casts, b.direct, sim.readyAt.size]).toEqual([0, 0, 0, 0, 0, 0]);
      }
      expect(chance).not.toHaveBeenCalled();
    });
  it.each([undefined, 0, 1, 2, 4, 5, Number.MAX_SAFE_INTEGER].flatMap(value => [false, true].map(balanced => ({ value, balanced })) ))(
    'preserves $value with balance=$balanced', ({ value, balanced }) => {
      const { build, skill, rng } = control(); skill.stacksGranted = value;
      const sim = new SimState(build, rng, []); if (balanced) sim.applyBuff(balance);
      sim.cast(skill, 1);
      expect(sim.stacks).toBe(value ? Math.min(4, value + (balanced ? 1 : 0)) : 0);
    });
  it('leaves unused values on normal skills outside this check', () => {
    const { build, skill, rng } = control(); skill.kind = 'normal'; skill.stacksGranted = 'unused' as unknown as number;
    const sim = new SimState(build, rng, []); sim.cast(skill, 1); expect(sim.stacks).toBe(0);
  });
  it.each(['2', 1.5])('rejects resolved delayed grant %s before damage', value => {
    const { build, skill, rng } = control(); skill.stacksGranted = 1;
    skill.delayedHits = { duration: 0.1, spawnAt: 0, hits: [{ after: 1, directCoef: 1, directFlat: 0, stacksGranted: value as number }] };
    const sim = new SimState(build, rng, []); sim.cast(skill, 0.1);
    expect(() => sim.advanceTo(1)).toThrow('부여 스택'); expect(sim.total).toBe(0); expect(sim.stacks).toBe(0);
  });
});
