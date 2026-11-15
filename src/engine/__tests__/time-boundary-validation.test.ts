import { describe, expect, it, vi } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function control() {
  const skill: SkillDef = { id: 'control', name: '통제', kind: 'normal', cooldown: 10, castTime: 1, hits: 1, directCoef: 1 };
  const build = empressInkomsu440(); build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onDestiny = []; build.onRuinAt4 = []; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0;
  build.rotation = { ruinPriority: [], stackPriority: [], fillers: [] };
  const rng = createRng(1), sim = new SimState(build, rng, []);
  return { sim, skill, rng };
}
const invalid: unknown[] = [null, undefined, '2', -1, 0, 0.5, NaN, Infinity, -Infinity, {}];
describe('finite nondecreasing direct simulation times', () => {
  it.each(invalid.flatMap(value => (['advance', 'cast', 'run'] as const).map(entry => ({ value, entry }))))(
    'rejects $value at $entry without changing state', ({ value, entry }) => {
      const { sim, skill, rng } = control(); sim.advanceTo(1);
      const chance = vi.spyOn(rng, 'chance'), b = sim.breakdown.get(skill.id)!;
      const advance = entry === 'run' ? vi.spyOn(sim, 'advanceTo').mockImplementation(() => { throw new Error('test time budget'); }) : null;
      expect(() => entry === 'advance' ? sim.advanceTo(value as number) : entry === 'cast' ? sim.cast(skill, value as number) : sim.run(value as number)).toThrow('시각');
      expect([sim.now, sim.total, b.casts, b.direct, sim.readyAt.size]).toEqual([1, 0, 0, 0, 0]);
      expect(chance).not.toHaveBeenCalled(); if (advance) expect(advance).not.toHaveBeenCalled();
    });
  it('rejects zero automatic duration at the initial state', () => {
    const { sim } = control(); expect(() => sim.run(0)).toThrow('시각'); expect(sim.now).toBe(0);
  });
  it('preserves equal and fractional forward times without reviving expired effects', () => {
    const { sim } = control(); sim.applyBuff({ id: 'buff', duration: 1.5, mod: { bucket: 'skillDmg', value: 1, source: '통제' } });
    sim.advanceTo(1); sim.advanceTo(1); expect(sim.buffs.has('buff', sim.now)).toBe(true);
    sim.advanceTo(1.5); expect(sim.buffs.has('buff', sim.now)).toBe(false); sim.advanceTo(1.5);
    expect(sim.now).toBe(1.5); expect(sim.buffs.has('buff', sim.now)).toBe(false);
  });
  it('preserves same-time manual cast cutoff at zero without a hit', () => {
    const { sim, skill } = control(); sim.cast(skill, 0);
    expect(sim.now).toBe(0); expect(sim.total).toBe(0); expect(sim.breakdown.get(skill.id)!.casts).toBe(1);
  });
  it('preserves a run ending at the already reached positive time', () => {
    const { sim, skill } = control(); sim.cast(skill, 1);
    expect(sim.run(1).dps).toBe(1); expect(sim.now).toBe(1);
  });
  it('processes a same-time pending hit only once', () => {
    const { sim, skill } = control(); skill.delayedHits = { duration: 1, spawnAt: 0, hits: [{ after: 0.5, directCoef: 1, directFlat: 0 }] };
    sim.cast(skill, 0); sim.advanceTo(0.5); const total = sim.total;
    expect(total).toBe(1); sim.advanceTo(0.5); expect(sim.total).toBe(total);
  });
});
