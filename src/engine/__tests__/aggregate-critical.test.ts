import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { damageWarnings } from '../skilldata';
import type { SkillDef } from '../types';

const skill: SkillDef = { id: 'aggregate-control', name: '합산 통제', kind: 'normal', cooldown: 10,
  castTime: 1, hits: 4, directCoef: 4, directFlat: 40 };
function input(skills = [skill]) {
  const preset = empressInkomsu440();
  return { ...preset, skills, bluntThorn: undefined, passiveMods: [{ bucket: 'critRate' as const, value: 0.5, source: '통제' }],
    onCardUse: [], onDestiny: [], onRuinAt4: [],
    params: { ...preset.params, atkBase: 10, raidCaptainRatio: 0, gaugePerHit: { ...preset.params.gaugePerHit, normal: 0 } } };
}
const warning = (skills = [skill]) => damageWarnings(input(skills)).filter(value => value.startsWith('합산 직접 피해의 치명 판정'));

describe('aggregate direct critical roll boundary', () => {
  it('observes one critical roll for aggregate four hits and four for a timed profile', () => {
    const timed: SkillDef = { ...skill, hitSequence: { duration: 1,
      hits: [0.1, 0.3, 0.5, 0.7].map(at => ({ at, directCoef: 1, directFlat: 10 })) } };
    for (const [current, expected] of [[skill, 1], [timed, 4]] as const) {
      const rng = createRng(1), calls: number[] = [];
      rng.chance = probability => { calls.push(probability); return false; };
      const sim = new SimState(input([current]), rng, []);
      sim.cast(current, 2);
      expect(calls.filter(probability => probability === 0.5)).toHaveLength(expected);
      expect(sim.breakdown.get(current.id)!.direct).toBe(80);
      expect(warning([current])).toHaveLength(expected === 1 ? 1 : 0);
    }
  });
  it('names only the aggregate multi-hit skills in a mixed build', () => {
    const single = { ...skill, id: 'single', name: '단타 통제', hits: 1 };
    expect(warning([skill, single])).toHaveLength(1);
    expect(warning([skill, single])[0]).toContain('합산 통제');
    expect(warning([skill, single])[0]).not.toContain('단타 통제');
  });
  it.each([
    { ...skill, hits: 1 },
    { ...skill, directCoef: 0, directFlat: 0 },
    { ...skill, delayedHits: { duration: 1, spawnAt: 0.2, hits: [{ after: 0.1, directCoef: 4, directFlat: 40 }] } },
    { ...skill, splitEvoke: { duration: 1, placementAt: 0.2, delay: 2, window: 3 } },
    { ...skill, manualEvoke: { duration: 1, placementAt: 0.2, minRecastDelay: 0.1, lifetime: 5,
      recastRecovery: 0.5, hits: [{ after: 0, weight: 1 }] } },
  ])('does not add an aggregate warning for a single, zero-damage or separate profile', current => {
    expect(warning([current])).toEqual([]);
  });
});
