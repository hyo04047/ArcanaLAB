import { describe, expect, it } from 'vitest';
import { rollDefenseIgnore } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const effects = ['defense', 'critical', 'keep'] as const;
function fixture(effect: typeof effects[number], base: unknown, bonus: unknown, stacks = 1) {
  const skill: SkillDef = { id: 'control', name: '합산 확률 통제', kind: 'ruin', cooldown: 10, castTime: 1,
    directCoef: 0, hits: 1, tripodChanceBonus: bonus as number };
  if (effect === 'defense') skill.defenseIgnore = { chance: base as number, fraction: 0.8 };
  if (effect === 'critical') skill.procCritDmg = { chancePerStack: base as number, value: 10 };
  if (effect === 'keep') { skill.keepStacksChance = base as number; skill.keepStacksMin = 1; }
  const build = empressInkomsu440(); build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onDestiny = []; build.onRuinAt4 = []; build.params.atkBase = 1; build.params.stackEffectCoefPerStack = 1;
  build.params.gaugePerHit.ruin = 0;
  const checks: number[] = [], rng = createRng(1, 'partitioned-v1'), stream = rng.stream!;
  const selected = effect === 'critical' ? 'procCritDmg' : 'keepStacks';
  rng.stream = key => JSON.parse(key)[0] === selected ? { ...stream(key), chance(p) { checks.push(p); return p >= 0.5; } } : stream(key);
  const state = new SimState(build, rng, []); state.stacks = stacks;
  const run = () => effect === 'defense'
    ? rollDefenseIgnore({ ...rng, chance(p) { checks.push(p); return p >= 0.5; } }, skill)
    : state.hit(skill, state.breakdown.get(skill.id)!);
  return { run, checks, state, skill };
}
describe.each(effects)('%s combined probability operands', effect => {
  it.each(['base', 'bonus'].flatMap(field => ['0.2', 'bad', Infinity, -Infinity, {}, [], true].map(value => ({ field, value }))))
    ('rejects $field=$value before the effect trial', ({ field, value }) => {
      const { run, checks } = fixture(effect, field === 'base' ? value : 0.2, field === 'bonus' ? value : 1);
      expect(run).toThrow('합산 확률'); expect(checks).toEqual([]);
    });
  it.each([undefined, null])('keeps an omitted/null bonus as zero (%s)', bonus => {
    const { run, checks } = fixture(effect, 0.2, bonus); run(); expect(checks).toEqual([0.2]);
  });
  it.each([[0, 0.2], [0.2, 0.4], [1, 1], [-0.1, 0.1]] as const)('keeps bonus %s at probability %s', (bonus, expected) => {
    const { run, checks } = fixture(effect, 0.2, bonus); run(); expect(checks).toEqual([expected]);
  });
});
it('scales per-stack chance before adding the bonus and applying the upper cap', () => {
  const { run, checks } = fixture('critical', 0.2, 0.1, 4); run(); expect(checks).toEqual([0.9]);
});
it.each(['critical', 'keep'] as const)('keeps unused %s settings inactive without stacks', effect => {
  const { run, checks } = fixture(effect, 'bad', 'bad', 0); expect(run).not.toThrow(); expect(checks).toEqual([]);
});
it('keeps zero stack-preservation chance disabled even with a bonus', () => {
  const { run, checks, state } = fixture('keep', 0, 1); run(); expect(checks).toEqual([]); expect(state.stacks).toBe(0);
});
