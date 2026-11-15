import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function fixture() {
  const c: SkillDef = { id: 'c', name: '단죄 통제', kind: 'normal', cooldown: 20, castTime: 1, directCoef: 0, hits: 1,
    hitRune: { kind: 'conviction', chance: 1, duration: 3 } };
  const j: SkillDef = { ...c, id: 'j', name: '심판 통제', hitRune: { kind: 'judgment', chance: 1, duration: 6 } };
  const build = empressInkomsu440();
  build.skills = [c, j]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = [];
  build.params.gaugePerHit = { stack: 0, normal: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  const state = new SimState(build, createRng(1), []);
  const hit = (skill: SkillDef, time: number) => { state.advanceTo(time); state.hit(skill, state.breakdown.get(skill.id)!); };
  return { state, c, j, hit, active: () => state.buffs.has('judgment_rune', state.now) };
}

describe.each(['conviction', 'judgment'] as const)('%s duration at successful activation', kind => {
  it.each([-1, NaN, Infinity, -Infinity, '3', 'bad', null, undefined, {}, []].map(duration => ({ duration })))
    ('rejects $duration and preserves the rune state for a corrected retry', ({ duration }) => {
      const { state, c, j, hit, active } = fixture();
      hit(c, 1);
      const skill = kind === 'conviction' ? c : j;
      skill.hitRune!.duration = duration as number;
      expect(() => hit(skill, 2)).toThrow('룬 지속시간');
      expect(active()).toBe(false);
      j.hitRune!.duration = 6; hit(j, 2);
      expect(active()).toBe(true);
      expect(state.buffs.remaining('judgment_rune', 2)).toBe(6);
    });

  it('rejects a nonfinite expiration without starting the shared cooldown', () => {
    const { c, j, hit, active } = fixture();
    const time = Number.MAX_VALUE / 2;
    c.hitRune!.duration = time; hit(c, time);
    const skill = kind === 'conviction' ? c : j; skill.hitRune!.duration = Number.MAX_VALUE;
    expect(() => hit(skill, time)).toThrow('룬 지속시간');
    j.hitRune!.duration = time; hit(j, time); expect(active()).toBe(true);
  });
});

it.each([0, 0.25, 3])('preserves conviction duration %s and its exact expiry', duration => {
  for (const [offset, expected] of [[0, duration > 0], [duration, false]] as const) {
    const { c, j, hit, active } = fixture(); c.hitRune!.duration = duration;
    hit(c, 1); hit(j, 1 + offset); expect(active()).toBe(expected);
  }
});
it.each([0, 0.25, 6])('preserves judgment duration %s and its exact expiry', duration => {
  const { state, c, j, hit, active } = fixture(); j.hitRune!.duration = duration;
  hit(c, 1); hit(j, 2); expect(active()).toBe(duration > 0);
  expect(state.buffs.remaining('judgment_rune', 2)).toBe(duration);
  state.advanceTo(2 + duration); expect(active()).toBe(false);
});
it('preserves fractional refresh of conviction', () => {
  const { c, j, hit, active } = fixture(); c.hitRune!.duration = 0.5;
  hit(c, 1); hit(c, 1.25); hit(j, 1.5); expect(active()).toBe(true);
});
it.each(['no-hit', 'chance-failed', 'no-conviction', 'internal-cooldown'])('does not activate an unused duration: %s', mode => {
  const { c, j, hit, active } = fixture();
  if (mode === 'internal-cooldown') { hit(c, 0); hit(j, 0); }
  const skill = mode === 'no-conviction' ? j : c; skill.hitRune!.duration = NaN;
  if (mode === 'no-hit') skill.hits = 0;
  if (mode === 'chance-failed') skill.hitRune!.chance = 0;
  expect(() => hit(skill, 1)).not.toThrow();
  expect(active()).toBe(mode === 'internal-cooldown');
});
