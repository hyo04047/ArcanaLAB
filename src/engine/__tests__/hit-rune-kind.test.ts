import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function fixture(kind: unknown, chance = 1) {
  const skill: SkillDef = { id: 'rune', name: '룬 종류 통제', kind: 'normal', cooldown: 20, castTime: 1,
    directCoef: 0, hits: 1, hitRune: { kind: kind as 'judgment', chance, duration: 3 } };
  const build = empressInkomsu440();
  build.skills = [skill]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = [];
  build.params.gaugePerHit = { stack: 0, normal: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  let runeChecks = 0;
  const rng = createRng(1, 'partitioned-v1'), stream = rng.stream!;
  rng.stream = key => {
    const child = stream(key);
    return JSON.parse(key)[0] === 'hitRune' ? { ...child, chance(p) { runeChecks++; return child.chance(p); } } : child;
  };
  const state = new SimState(build, rng, []);
  const hit = (time = 1) => { state.advanceTo(time); state.hit(skill, state.breakdown.get(skill.id)!); };
  return { state, skill, hit, active: () => state.buffs.has('judgment_rune', state.now), checks: () => runeChecks };
}

describe.each([0, 1])('unknown rune kind at chance %s', chance => {
  it.each(['judgemnt', '', undefined, null, 0, {}, [], true].map(kind => ({ kind })))
    ('rejects $kind before rune RNG and preserves a corrected activation', ({ kind }) => {
      const { state, skill, hit, active, checks } = fixture(kind, chance);
      expect(() => hit()).toThrow('룬 종류'); expect(checks()).toBe(0); expect(active()).toBe(false);
      skill.hitRune = { kind: 'conviction', chance: 1, duration: 3 }; hit();
      skill.hitRune.kind = 'judgment'; hit();
      expect(active()).toBe(true); expect(checks()).toBe(2); expect(state.cooldownMultiplier(skill)).toBe(0.85);
    });
});
it('keeps judgment inactive without conviction and without a rune RNG draw', () => {
  const { state, skill, hit, active, checks } = fixture('judgment');
  hit(); expect(active()).toBe(false); expect(checks()).toBe(0); expect(state.cooldownMultiplier(skill)).toBe(1);
});
it('keeps conviction followed by judgment, including a failed roll', () => {
  const { skill, hit, active, checks } = fixture('conviction');
  hit(); expect(active()).toBe(false); skill.hitRune!.kind = 'judgment'; skill.hitRune!.chance = 0;
  hit(2); expect(active()).toBe(false); skill.hitRune!.chance = 1;
  hit(3); expect(active()).toBe(true); expect(checks()).toBe(3);
});
it.each(['absent', 'no-hit', 'internal-cooldown'])('preserves the inactive %s path', mode => {
  const { skill, hit, active, checks } = fixture('conviction');
  if (mode === 'internal-cooldown') { hit(0); skill.hitRune!.kind = 'judgment'; hit(0); }
  skill.hitRune!.kind = 'unknown' as 'judgment';
  if (mode === 'absent') skill.hitRune = undefined;
  if (mode === 'no-hit') skill.hits = 0;
  expect(() => hit(1)).not.toThrow();
  expect(active()).toBe(mode === 'internal-cooldown'); expect(checks()).toBe(mode === 'internal-cooldown' ? 2 : 0);
});
