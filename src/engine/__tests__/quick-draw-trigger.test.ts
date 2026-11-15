import { describe, expect, it, vi } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function fixture() {
  const skill: SkillDef = { id: 'quick', name: '퀵 드로 통제', kind: 'normal', cooldown: 10, castTime: 3,
    directCoef: 0, hits: 3, quickDraw: { chance: 1, trigger: 'each', attempts: 3 } };
  const build = empressInkomsu440(); build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onDestiny = []; build.onRuinAt4 = []; build.params.gaugePerHit.normal = 0;
  return { build, skill };
}
describe.each(['initial', 'cast', 'hit'] as const)('Quick Draw condition at %s', entry => {
  it.each(['firstt', '', undefined, null, 0, {}, [], true].map(trigger => ({ trigger })))
    ('rejects $trigger before state or RNG changes', ({ trigger }) => {
      const { build, skill } = fixture(), rng = createRng(1), chance = vi.spyOn(rng, 'chance'), next = vi.spyOn(rng, 'next');
      if (entry === 'initial') {
        skill.quickDraw!.trigger = trigger as 'each';
        expect(() => new SimState(build, rng, cardsFor('empress'))).toThrow('퀵 드로 적중 조건');
      } else {
        const sim = new SimState(build, rng, cardsFor('empress')), row = sim.breakdown.get(skill.id)!;
        skill.quickDraw!.trigger = trigger as 'each';
        expect(() => entry === 'cast' ? sim.cast(skill, 3) : sim.hit(skill, row)).toThrow('퀵 드로 적중 조건');
        expect([sim.now, sim.total, sim.cardsDrawn, sim.readyAt.size, row.casts, row.direct]).toEqual([0, 0, 0, 0, 0, 0]);
      }
      expect(chance).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
    });
});
it.each(['first', 'last', 'each'] as const)('keeps timed %s eligibility and the two-card cap', trigger => {
  for (const [end, expected] of [[0.5, 0], [1, trigger === 'last' ? 0 : 1], [3, trigger === 'each' ? 2 : 1]] as const) {
    const { build, skill } = fixture(); skill.quickDraw!.trigger = trigger;
    skill.hitSequence = { duration: 3, hits: [1, 2, 3].map(at => ({ at, directCoef: 0, directFlat: 0 })) };
    const sim = new SimState(build, createRng(1), cardsFor('empress')); sim.cast(skill, end);
    expect(sim.cardDraws.quickDraw).toBe(expected);
  }
});
it.each(['first', 'last', 'each'] as const)('keeps %s lumped attempts', trigger => {
  const { build, skill } = fixture(); skill.quickDraw!.trigger = trigger; skill.quickDraw!.attempts = trigger === 'each' ? 3 : 1;
  const sim = new SimState(build, createRng(1), cardsFor('empress')); sim.cast(skill, 3);
  expect(sim.cardDraws.quickDraw).toBe(trigger === 'each' ? 2 : 1);
});
it('does not create a fallback effect for an absent Quick Draw configuration', () => {
  const { build, skill } = fixture(); skill.quickDraw = undefined; skill.tags = ['quickdraw'];
  const sim = new SimState(build, createRng(1), cardsFor('empress')); sim.cast(skill, 3); expect(sim.cardsDrawn).toBe(0);
});
it('keeps zero attempts with an explicit valid condition', () => {
  const { build, skill } = fixture(); skill.quickDraw!.attempts = 0;
  const sim = new SimState(build, createRng(1), cardsFor('empress')); sim.cast(skill, 3); expect(sim.cardsDrawn).toBe(0);
});
