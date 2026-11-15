import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Build, SkillDef } from '../types';

const lists = ['ruinPriority', 'stackPriority', 'cullRuinPriority', 'fishing', 'wheelTargets', 'fillers'] as const;
const singles = ['finisher', 'setupSkill', 'critSetupSkill'] as const;

describe('saved rotation structure and skill references before automatic combat', () => {
  it.each(lists.flatMap(key => [null, 'celestial_rain', [1], ['missing_skill']].map(value => ({ key, value }))))(
    'rejects $key = $value even when its branch would not run', ({ key, value }) => {
      const build = empressInkomsu440();
      build.rotation = { ...build.rotation, [key]: value } as Build['rotation'];
      expect(() => new SimState(build, createRng(1), []).run(0.1)).toThrow('로테이션');
    });

  it.each(singles.flatMap(key => [null, '', ['celestial_rain'], 'missing_skill'].map(value => ({ key, value }))))(
    'rejects scalar reference $key = $value', ({ key, value }) => {
      const build = empressInkomsu440();
      build.rotation = { ...build.rotation, [key]: value } as Build['rotation'];
      expect(() => new SimState(build, createRng(1), []).run(0.1)).toThrow('로테이션');
    });

  it.each(['ruinPriority', 'stackPriority'] as const)('requires %s even for an idle rotation', key => {
    const build = empressInkomsu440();
    build.rotation = { ruinPriority: [], stackPriority: [] };
    delete (build.rotation as Partial<Build['rotation']>)[key];
    expect(() => new SimState(build, createRng(1), []).run(0.1)).toThrow('로테이션');
  });

  it.each([null, 'rotation', [], 1, false, { ruinPriority: [], stackPriority: [], wheelTarget: [] }])(
    'rejects malformed rotation %j before consuming random draws', rotation => {
      const build = empressInkomsu440(), rng = createRng(1);
      build.rotation = rotation as Build['rotation'];
      rng.next = () => { throw new Error('unexpected random draw'); };
      expect(() => new SimState(build, rng, []).run(0.1)).toThrow('로테이션');
    });

  it('keeps an empty skill set and omitted optional fields as a zero-damage control', () => {
    const build = empressInkomsu440();
    build.skills = []; build.rotation = { ruinPriority: [], stackPriority: [] };
    const result = new SimState(build, createRng(1), []).run(0.1);
    expect(result.totalDamage).toBe(0); expect(result.breakdown).toEqual([]);
  });

  it('preserves order, duplicate references and arbitrary registered control IDs without changing the input', () => {
    const build = empressInkomsu440();
    const skill: SkillDef = { id: 'control_a', name: 'control', kind: 'normal', usesMana: true,
      cooldown: 10, castTime: 0.1, hits: 1, directCoef: 1 };
    build.skills = [skill, { ...skill, id: 'control_b' }]; build.variant = 'emperor';
    build.rotation = { ruinPriority: [], stackPriority: [], fillers: ['control_b', 'control_a', 'control_b'],
      wheelTargets: [], fishing: [], cullRuinPriority: [], finisher: 'control_a', setupSkill: 'control_a', critSetupSkill: 'control_b' };
    const before = JSON.stringify(build);
    const result = new SimState(build, createRng(1), []).run(0.1);
    expect(result.breakdown.map(row => [row.id, row.casts])).toEqual([['control_a', 0], ['control_b', 1]]);
    expect(JSON.stringify(build)).toBe(before);
  });
});
