import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { empressInkomsu440 } from '../presets';
import { createRng, type Rng } from '../rng';
import { damageWarnings, resolveSkillDamage, SKILL_BY_ID } from '../skilldata';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const preset = empressInkomsu440();
const dir = resolve(__dirname, '../../../tests/fixtures/armory/FixtureCharacter26');
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, name + '.json'), 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'), arkpassive: null, arkgrid: null, engravings: null, gems: null };
const row = SKILL_BY_ID.get('serendipity')!;
const explosion = 161320;
const spread = 19561;
const fold = 29323.5;

function skill(combo: boolean): SkillDef {
  return { ...preset.skills.find(s => s.id === row.id)!, ...resolveSkillDamage(row, 14, combo),
    mods: [], onCast: [], procCritDmg: undefined, defenseIgnore: undefined, keepStacksChance: undefined };
}
function state(s: SkillDef, rng = createRng(1)) {
  return new SimState({ ...preset, skills: [s], passiveMods: [], bluntThorn: undefined, onRuinAt4: [],
    params: { ...preset.params, atkBase: 10000, gaugeGainBonus: 0, gaugePerHit: { normal: 0, ruin: 0.1, stack: 0, hyper_awakening: 0, awakening: 0 } } }, rng, []);
}
function judgment(s: SimState, duration = 10) {
  s.applyBuff({ id: 'judgment', duration, mod: { bucket: 'critRate', value: 0, source: 'test' } });
}
// Full-sequence damage validation; automatic first-hit usage is tested in serendipity-policy.test.ts.
function cast(s: SimState, end = 10) { s.cast(s.build.skills[0]!, end, 'full'); return s.breakdown.get(row.id)!; }
function controlled(chance: (p: number) => boolean): Rng { return { ...createRng(1), chance }; }

describe('Serendipity per-hit ruin processing', () => {
  it.each([false, true])('explodes once without judgment, combo=%s', combo => {
    const s = state(skill(combo)); s.stacks = 4;
    const b = cast(s);
    expect(b.direct).toBeCloseTo(spread * (combo ? 2 : 1) + fold, 7);
    expect(b.stackEffect).toBe(explosion);
    expect(s.stacks).toBe(0);
    expect([b.casts, s.ruinCasts, s.ruinAt4]).toEqual([1, 1, 1]);
    expect(s.deck.gauge).toBeCloseTo(combo ? 0.3 : 0.2);
    expect(s.now).toBeCloseTo(combo ? 2.867 : 1.8);
  });

  it.each([false, true])('explodes on every hit under judgment, combo=%s', combo => {
    for (let stacks = 0; stacks <= 4; stacks++) {
      const s = state(skill(combo)); s.stacks = stacks; judgment(s);
      const b = cast(s);
      expect(b.stackEffect).toBe(explosion * (combo ? 3 : 2));
      expect([s.stacks, s.ruinCasts, s.ruinAt4]).toEqual([0, 1, 1]);
    }
  });

  it.each([[0.292, 0], [0.293, 0], [0.294, 1], [1.093, 1], [1.094, 2], [2.199, 2], [2.2, 3]])(
    'checks judgment expiration at each hit: duration=%s', (duration, count) => {
      const s = state(skill(true)); judgment(s, duration);
      expect(cast(s).stackEffect).toBe(explosion * count);
    });

  it.each([[0.292, 0, 0], [0.293, 1, spread], [1.093, 2, spread * 2], [2.199, 3, spread * 2 + fold]])(
    'omits hits beyond fight end %s', (end, count, direct) => {
      const s = state(skill(true)); judgment(s);
      const b = cast(s, end);
      expect(b.direct).toBeCloseTo(direct, 7);
      expect(b.stackEffect).toBe(explosion * count);
      expect(s.ruinCasts).toBe(count ? 1 : 0);
      expect(s.deck.gauge).toBeCloseTo(count * 0.1);
      expect(s.now).toBe(end);
    });

  it.each([[false, false, false, 1, 0], [true, false, false, 2, 0], [true, true, false, 3, 0], [true, true, true, 3, 4]])(
    'checks stack preservation after each hit: %s/%s/%s', (a, b, c, count, remaining) => {
      const rolls = [a, b, c]; let checks = 0;
      const s = state({ ...skill(true), keepStacksChance: 0.28, keepStacksMin: 1 }, controlled(p => {
        if (p === 0.28) { checks++; return rolls.shift() as boolean; } return false;
      }));
      s.stacks = 4;
      expect(cast(s).stackEffect).toBe(explosion * (count as number));
      expect(s.stacks).toBe(remaining);
      expect(checks).toBe(count);
    });

  it('preserves actual low stacks without creating stacks from judgment', () => {
    const base = { ...skill(true), keepStacksChance: 1, keepStacksMin: 1 };
    const s = state(base); s.stacks = 2;
    expect(cast(s).stackEffect).toBe(47885.5 * 3);
    expect(s.stacks).toBe(2);
    const j = state(base); judgment(j);
    expect(cast(j).stackEffect).toBe(explosion * 3);
    expect(j.stacks).toBe(0);
  });

  it('uses one 80% proc per explosion and restricts crit damage to stack damage', () => {
    const rolls = [true, false, true]; const probabilities: number[] = [];
    const s = state({ ...skill(true), procCritDmg: { chancePerStack: 0.2, value: 5.04 } }, controlled(p => {
      if (p === 0.8) { probabilities.push(p); return rolls.shift()!; } return p === 1;
    }));
    s.build.passiveMods = [{ bucket: 'critRate', value: 1, source: 'test' }]; judgment(s);
    const b = cast(s);
    expect(probabilities).toEqual([0.8, 0.8, 0.8]);
    expect(b.direct).toBeCloseTo((spread * 2 + fold) * 2, 7);
    expect(b.stackEffect).toBeCloseTo(explosion * (7.04 + 2 + 7.04), 7);
  });

  it('does not roll a ruin proc when no explosion exists', () => {
    const probabilities: number[] = [];
    const s = state({ ...skill(true), procCritDmg: { chancePerStack: 0.2, value: 5.04 } }, controlled(p => { probabilities.push(p); return false; }));
    cast(s);
    expect(probabilities).toEqual([0, 0, 0]); // directly hitting without stacks only rolls direct crits
  });

  it('rolls direct and stack crits separately for each impact', () => {
    const rolls = [true, false, false, true, true, false];
    const s = state(skill(true), controlled(p => p === 0.5 && rolls.shift()!));
    s.build.passiveMods = [{ bucket: 'critRate', value: 0.5, source: 'test' }]; judgment(s);
    const b = cast(s);
    expect(b.direct).toBeCloseTo(spread * 3 + fold * 2, 7);
    expect(b.stackEffect).toBe(explosion * 4);
    expect(rolls).toHaveLength(0);
  });

  it('checks corrosion once per landed impact', () => {
    let checks = 0;
    const s = state(skill(true), controlled(p => { if (p === 0.3) checks++; return false; }));
    s.applyBuff({ id: 'corrosion_window', duration: 10, mod: { bucket: 'critRate', value: 0, source: 'test' } });
    cast(s);
    expect(checks).toBe(3);
  });

  it('applies on-cast effects once and on-ruin effects after each explosion', () => {
    const sk = skill(true);
    sk.runeCdReduce = { chance: 0.123, fraction: 0.2 };
    sk.onCast = [{ id: 'cast-bonus', duration: 10, maxStacks: 3, mod: { bucket: 'skillDmg', value: 0.1, source: 'test' } }];
    let runeChecks = 0;
    const s = state(sk, controlled(p => { if (p === 0.123) runeChecks++; return false; }));
    s.build.onRuinAt4 = [{ id: 'ruin-bonus', duration: 10, mod: { bucket: 'stackEffectDmg', value: 0.5, source: 'test' } }];
    judgment(s);
    const b = cast(s);
    expect(runeChecks).toBe(1);
    expect(b.direct).toBeCloseTo((spread * 2 + fold) * 1.1, 7);
    expect(b.stackEffect).toBeCloseTo(explosion * 1.1 * (1 + 1.5 + 1.5), 7);
  });

  it('scales hit times and recovery together with attack speed', () => {
    const s = state(skill(true)); judgment(s);
    s.build.passiveMods = [{ bucket: 'atkSpeed', value: 0.4, source: 'test' }];
    expect(cast(s, 0.8).stackEffect).toBe(explosion * 2);
    const full = state(skill(true));
    full.build.passiveMods = s.build.passiveMods;
    cast(full); expect(full.now).toBeCloseTo(2.867 / 1.4);
  });

  it('connects three hits and the per-hit direct bonus through preset and character import', () => {
    for (const build of [preset, buildFromArmory(raw).build]) {
      const sk = { ...build.skills.find(s => s.id === row.id)!, procCritDmg: undefined, defenseIgnore: undefined };
      const s = state(sk); judgment(s);
      const b = cast(s);
      expect(sk.hits).toBe(3);
      expect(b.direct).toBeCloseTo(83503.51, 7); // (19561*2+29323.5)*1.22, not rounded total 1.708 twice
      expect(b.stackEffect).toBe(explosion * 3);
      expect(damageWarnings(s.build).some(w => w.includes('세렌디피티') && w.includes('후딜'))).toBe(true);
    }
  });

  it('imports Serendipity eye and intended chance, including their different wording', () => {
    const input = structuredClone(raw);
    const target = input.combatSkills.find(s => s.Name === '세렌디피티')!;
    target.Tripods = [
      { Tier: 1, Slot: 2, Name: '눈속임', IsSelected: true, Tooltip: '스킬 적중 시 28.0% 확률로 스택트를 소모하지 않는다.' },
      { Tier: 2, Slot: 1, Name: '우연한 일격', IsSelected: true, Tooltip: '스택트 중첩당 20.0% 확률로 루인으로 주는 치명타 피해가 504.0% 증가한다.' },
      { Tier: 3, Slot: 2, Name: '의도된 우연', IsSelected: true, Tooltip: '세렌디피티 트라이포드로 증가되는 발동 확률이 스택트의 중첩과 상관없이 20.0% 증가한다.' },
    ];
    const sk = buildFromArmory(input).build.skills.find(s => s.id === row.id)!;
    expect(sk.hits).toBe(2); expect(sk.keepStacksChance).toBe(0.28); expect(sk.keepStacksMin).toBe(1);
    const probabilities: number[] = [];
    const s = state(sk, controlled(p => { probabilities.push(p); return true; })); s.stacks = 4;
    cast(s);
    expect(probabilities.filter(p => p === 1)).toHaveLength(2);
    expect(probabilities.filter(p => Math.abs(p - 0.48) < 1e-9)).toHaveLength(2);
  });

  it('imports accidental slam speed and applies it to the whole combo timeline', () => {
    const input = structuredClone(raw);
    const target = input.combatSkills.find(s => s.Name === '세렌디피티')!;
    target.Tripods!.find(t => t.IsSelected && t.Name === '우연한 일격')!.IsSelected = false;
    target.Tripods!.push({ Tier: 2, Slot: 2, Name: '우연한 강타', IsSelected: true,
      Tooltip: '더 이상 날려버리지 않지만 공격 속도가 42% 증가하고, 스택트 효과 적중 시 추가로 2초간 기절시킨다.' });
    target.Rune = null;
    const sk = buildFromArmory(input).build.skills.find(s => s.id === row.id)!;
    expect(sk.castTime).toBeCloseTo(2.867 / 1.42);
    const s = state({ ...sk, defenseIgnore: undefined }); judgment(s);
    expect(cast(s, 1.093 / 1.42 + 0.000001).stackEffect).toBe(explosion * 2);
  });

  it('keeps three judgment explosions independent of the direct skill level', () => {
    const results = [1, 10, 14].map(level => {
      const s = state({ ...skill(true), ...resolveSkillDamage(row, level, true) }); judgment(s);
      return cast(s);
    });
    expect(results.map(b => b.stackEffect)).toEqual([explosion * 3, explosion * 3, explosion * 3]);
    expect(results[0]!.direct).toBeLessThan(results[1]!.direct);
    expect(results[1]!.direct).toBeLessThan(results[2]!.direct);
  });
});
