import { describe, expect, it } from 'vitest';
import { rollDefenseIgnore } from '../damage';
import { createRng } from '../rng';
import type { SkillDef } from '../types';

const skill: SkillDef = { id: 'control', name: '통제', kind: 'normal', cooldown: 1, castTime: 1, hits: 1, directCoef: 1 };
const invalid: unknown[] = [null, undefined, '0.8', 'bad', NaN, Infinity, -Infinity, -0.1, 1.1, {}, [], true];
describe('defense ignore fraction validity', () => {
  it.each(invalid.flatMap(fraction => [0, 1].map(chance => ({ fraction, chance }))))('rejects $fraction before a $chance roll', ({ fraction, chance }) => {
    const rng = createRng(1), control = createRng(1);
    expect(() => rollDefenseIgnore(rng, { ...skill, defenseIgnore: { chance, fraction: fraction as number } })).toThrow('방어 무시 비율');
    expect(rng.next()).toBe(control.next());
  });
  it.each([0, 0.8, 1].flatMap(fraction => [0, 3250, 13000].map(defense => ({ fraction, defense }))))(
    'preserves fraction $fraction with defense $defense', ({ fraction, defense }) => {
      const rng = createRng(1), control = createRng(1), input = { ...skill, defenseIgnore: { chance: 1, fraction } }, before = structuredClone(input);
      expect(rollDefenseIgnore(rng, input, defense)).toBe((6500 + defense) / (6500 + defense * (1 - fraction)));
      control.next(); expect(rng.next()).toBe(control.next()); expect(input).toEqual(before);
    });
  it('preserves a failed roll and consumes one draw', () => {
    const rng = createRng(1), control = createRng(1);
    expect(rollDefenseIgnore(rng, { ...skill, defenseIgnore: { chance: 0, fraction: 0.8 } })).toBe(1);
    control.next(); expect(rng.next()).toBe(control.next());
  });
  it('preserves omitted effects without consuming a draw', () => {
    const rng = createRng(1), control = createRng(1);
    expect(rollDefenseIgnore(rng, skill)).toBe(1); expect(rng.next()).toBe(control.next());
  });
});
