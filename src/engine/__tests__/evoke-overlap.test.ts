import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { runOnce, SimState, simulate } from '../sim';
import type { SkillBreakdown, SkillDef } from '../types';
import candidate from '../../../data/evoke_effects.json';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-evoke-overlap-sources.json', 'utf8')).official.skill;
function input(selected = ['퀵 드로', '마나 중독', '중첩 마법진'], level = 14): RawArmory {
  return { profiles: JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8')),
    combatSkills: [{ ...source, Level: level, Tripods: source.Tripods.map((t: { Name: string }) => ({ ...t, IsSelected: selected.includes(t.Name) })) }],
    arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
describe('manual Evoke and poison conversion', () => {
  it('reads the official overlap ratios and separates AP/flat damage at Lv14', () => {
    const s = buildFromArmory(input()).build.skills[0]!;
    expect(s.splitEvoke).toBeUndefined();
    expect(s.manualEvoke).toEqual({ duration: 1.3, placementAt: 0.338, minRecastDelay: 1, lifetime: 10, recastRecovery: 0,
      hits: [{ after: 0, weight: 1 }, { after: 0.5, weight: 0.5 }, { after: 1, weight: 0.25 }] });
    expect(s.directCoef).toBe(24.234); expect(s.directFlat).toBe(3633.5);
    expect(s.manaPoison!.coef).toBeCloseTo(3.635 * 1.72); expect(s.manaPoison!.flat).toBeCloseTo(548 * 1.72);
    expect(s.manaPoison).toMatchObject({ duration: 3, maxStacks: 3, firstTick: 0.5, interval: 1 });
    expect(s.quickDraw).toMatchObject({ chance: 0.2, attempts: 3 });
  });
  it('ignores the character-specific poison damage display', () => {
    const a = input(); const b = input();
    const t = b.combatSkills[0]!.Tripods!.find(t => t.Name === '마나 중독')!;
    t.Tooltip = t.Tooltip!.replace(/(<FONT COLOR='#00ccff'>)[\d,]+/i, '$1999,999,999');
    expect(buildFromArmory(a).build.skills[0]!.manaPoison).toEqual(buildFromArmory(b).build.skills[0]!.manaPoison);
  });
  it.each([1, 10, 14, 20])('uses the separate candidate arrays for skill level %s', level => {
    const s = buildFromArmory(input(undefined, level)).build.skills[0]!;
    expect(s.directCoef).toBe(candidate.direct.apByLevel[level - 1]);
    expect(s.manaPoison!.coef).toBeCloseTo(candidate.poison.apByLevel[level - 1]! * 1.72);
  });
  it('does not invent poison coefficients outside the supported level array', () => {
    const r = buildFromArmory(input(undefined, 21));
    expect(r.build.skills[0]!.manaPoison).toBeUndefined(); expect(r.warnings.some(w => w.includes('지원 레벨'))).toBe(true);
  });
  it('uses a single manual explosion without a selected third-tier tripod', () => {
    const s = buildFromArmory(input(['퀵 드로'])).build.skills[0]!;
    expect(s.manualEvoke!.placementAt).toBe(0.321); expect(s.manualEvoke!.hits).toEqual([{ after: 0, weight: 1 }]);
    expect(s.manaPoison).toBeUndefined();
  });
  it('attaches the same independent poison effect to split Evoke', () => {
    const s = buildFromArmory(input(['마나 중독', '분할 마법진'])).build.skills[0]!;
    expect(s.splitEvoke).toBeDefined(); expect(s.manualEvoke).toBeUndefined(); expect(s.manaPoison).toBeDefined();
  });
  it.each(['중첩 마법진', '마나 중독'])('leaves unrecognized %s tooltip unsupported', name => {
    const raw = input(); raw.combatSkills[0]!.Tripods!.find(t => t.Name === name)!.Tooltip = '알 수 없는 새 조건';
    const r = buildFromArmory(raw);
    if (name === '중첩 마법진') expect(r.build.skills[0]!.manualEvoke).toBeUndefined();
    expect(r.build.skills[0]!.manaPoison).toBeUndefined(); expect(r.warnings.some(w => w.includes('미반영'))).toBe(true);
  });
});

class Trace extends SimState {
  impacts: { at: number; damage: number }[] = [];
  override hit(s: SkillDef, b: SkillBreakdown, first = true, last = true): void {
    const before = this.total; super.hit(s, b, first, last);
    if (s.id === 'evoke') this.impacts.push({ at: this.now, damage: this.total - before });
  }
}
// 합성 입력으로 이벤트 경계를 검증합니다. 공격력·시간의 게임 실측값이 아닙니다.
function state(poison = true) {
  const skill: SkillDef = { id: 'evoke', name: '이보크', kind: 'normal', level: 14, usesMana: true,
    cooldown: 10, castTime: 1, directCoef: 1, directFlat: 20, hits: 1,
    manualEvoke: { duration: 1, placementAt: 0.25, minRecastDelay: 1, lifetime: 10, recastRecovery: 0,
      hits: [{ after: 0, weight: 1 }, { after: 0.5, weight: 0.5 }, { after: 1, weight: 0.25 }] },
    ...(poison ? { manaPoison: { coef: 0.1, flat: 2, duration: 3, maxStacks: 3, firstTick: 0.5, interval: 1 } } : {}),
    quickDraw: { chance: 0.2, trigger: 'each', attempts: 3 } };
  const other: SkillDef = { id: 'other', name: 'other', kind: 'normal', cooldown: 10, castTime: 5, directCoef: 0, hits: 1 };
  const base = empressInkomsu440();
  const build = { ...base, skills: [skill, other], passiveMods: [], bluntThorn: undefined, onCardUse: [], onRuinAt4: [], onDestiny: [],
    rotation: { ruinPriority: [], stackPriority: [], fillers: ['evoke'], wheelTargets: [] },
    params: { ...base.params, atkBase: 100, gaugeGainBonus: 0, normalGaugePenalty: 0,
      gaugePerHit: { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 } } };
  const checks: number[] = [];
  const sim = new Trace(build, { ...createRng(1), chance(p) { checks.push(p); return p === 1; } }, []);
  return { sim, skill, other, checks, b: () => sim.breakdown.get('evoke')! };
}
function detonate(sim: Trace, skill: SkillDef) { sim.cast(skill, 100); sim.advanceTo(1.25); sim.cast(skill, 100); }

describe('manual detonation events', () => {
  it('waits for a real second input and never gives installation damage', () => {
    const { sim, skill, b } = state(false); sim.cast(skill, 100);
    expect(sim.total).toBe(0); expect(sim.isReady('evoke')).toBe(false);
    expect(() => sim.cast(skill, 100)).toThrow('cooldown');
    sim.advanceTo(1.25); expect(sim.isReady('evoke')).toBe(true); expect(sim.total).toBe(0);
    sim.cast(skill, 100); expect(sim.now).toBe(1.25); expect(sim.total).toBe(120);
    sim.advanceTo(2.25); expect(sim.impacts).toEqual([{ at: 1.25, damage: 120 }, { at: 1.75, damage: 60 }, { at: 2.25, damage: 30 }]);
    expect(b().casts).toBe(1); expect(sim.readyAt.get('evoke')).toBe(11.25);
  });
  it('allows delaying detonation while another action is performed', () => {
    const { sim, skill, other } = state(false); sim.cast(skill, 100); sim.cast(other, 100);
    expect(sim.impacts).toHaveLength(0); sim.cast(skill, 100); sim.advanceTo(7);
    expect(sim.impacts.map(h => h.at)).toEqual([6, 6.5, 7]);
  });
  it('expires without automatic explosion and starts cooldown', () => {
    const { sim, skill } = state(); sim.cast(skill, 100); sim.advanceTo(10.25);
    expect(sim.total).toBe(0); expect(sim.readyAt.get('evoke')).toBe(20.25); expect(sim.isReady('evoke')).toBe(false);
  });
  it('does not register a manual chain before placement is reached', () => {
    const { sim, skill } = state(); sim.cast(skill, 0.249); sim.advanceTo(11);
    expect(sim.total).toBe(0); expect(sim.readyAt.has('evoke')).toBe(false);
  });
  it('does not scale arming delay, lifetime or explosion intervals with attack speed', () => {
    const { sim, skill } = state(false); sim.build.passiveMods.push({ bucket: 'atkSpeed', value: 0.4, source: 'test' });
    const armed = 0.25 / 1.4 + 1;
    sim.cast(skill, 100); expect(sim.now).toBeCloseTo(1 / 1.4); sim.advanceTo(armed - 0.001); expect(sim.isReady('evoke')).toBe(false);
    sim.advanceTo(armed); sim.cast(skill, 100); sim.advanceTo(3);
    sim.impacts.forEach((h, i) => expect(h.at).toBeCloseTo(armed + i * 0.5));
    expect(sim.impacts).toHaveLength(3);
  });
  it('keeps pending explosions when a reset permits another installation', () => {
    const { sim, skill } = state(false); sim.setNextSkillCooldownReset(); detonate(sim, skill);
    sim.cast(skill, 100); expect(sim.impacts.map(h => h.at)).toEqual([1.25, 1.75, 2.25]);
    sim.advanceTo(2.5); sim.cast(skill, 100); sim.advanceTo(3.5); expect(sim.impacts).toHaveLength(6);
  });
  it.each([[1.249, 0, 0], [1.251, 1, 0], [1.75, 2, 24], [2.25, 3, 24], [4.75, 3, 132], [5.25, 3, 132]])(
    'omits events after fight end %s', (end, hits, dot) => {
      const { sim, b, checks } = state(); sim.run(end);
      expect(sim.impacts).toHaveLength(hits); expect(b().dot ?? 0).toBe(dot);
      expect(checks.filter(p => p === 0.2)).toHaveLength(hits); expect(sim.now).toBe(end);
    });
});

describe('independent poison stacking, expiration and damage', () => {
  it('refreshes duration while keeping the existing tick clock', () => {
    const { sim, skill, b } = state(); detonate(sim, skill);
    sim.advanceTo(1.75); expect(b().dot).toBe(24);
    sim.advanceTo(2.75); expect(b().dot).toBe(60);
    sim.advanceTo(3.75); expect(b().dot).toBe(96);
    sim.advanceTo(4.75); expect(b().dot).toBe(132);
    sim.advanceTo(10); expect(b().dot).toBe(132); expect(b().direct).toBe(210); expect(sim.total).toBe(342);
  });
  it('treats the first-tick phase as a candidate, not a fixed 11x damage bonus', () => {
    const { sim, skill, b } = state(); skill.manaPoison!.firstTick = 1;
    detonate(sim, skill); sim.advanceTo(6); expect(b().dot).toBe(108); // 3 + 3 + 3 units
  });
  it('applies the poison coefficient at full strength after reduced second and third explosions', () => {
    const { sim, skill, b } = state();
    skill.mods = [{ bucket: 'skillDmg', value: -0.3, filter: { component: 'direct' }, source: '마나 중독' }];
    detonate(sim, skill); sim.advanceTo(6);
    expect(b().direct).toBeCloseTo(147); expect(b().dot).toBe(132);
  });
  it('caps at three stacks and refreshes even at the cap', () => {
    const { sim, skill, b } = state(); detonate(sim, skill); sim.advanceTo(4);
    sim.hit(skill, b()); sim.advanceTo(6.75);
    expect(b().dot).toBe(204); // 2 + 3 + 3 + 3 + 3 + 3
    sim.advanceTo(7); expect(b().dot).toBe(204);
  });
  it('starts a new one-stack poison when reapplied exactly on expiration', () => {
    const { sim, skill, b } = state(); detonate(sim, skill); sim.advanceTo(5.25);
    sim.hit(skill, b()); sim.advanceTo(5.75); expect(b().dot).toBe(144);
    sim.advanceTo(8.25); expect(b().dot).toBe(168);
  });
  it('keeps full poison strength on split explosions too', () => {
    const { sim, skill, b } = state(); delete skill.manualEvoke;
    skill.splitEvoke = { duration: 1, placementAt: 0.25, delay: 2, window: 3 };
    sim.cast(skill, 100); sim.cast(skill, 100); sim.advanceTo(6.25);
    expect(sim.impacts.map(h => h.at)).toEqual([2.25, 3.25]);
    expect(b().dot).toBe(84); // 1 + 2 + 2 + 2
  });
  it('excludes normal skill damage and gems, but permits explicit poison damage effects', () => {
    const { sim, skill, b } = state();
    sim.build.passiveMods.push({ bucket: 'skillDmg', value: 1, filter: { ids: ['evoke'] }, source: '보석' },
      { bucket: 'skillDmg', value: 1, filter: { kinds: ['normal'] }, source: '일반 스킬' },
      { bucket: 'skillDmg', value: 0.5, filter: { ids: ['evoke'], component: 'dot' }, source: '도트 전용 통제' });
    detonate(sim, skill); sim.advanceTo(6);
    expect(b().direct).toBe(840); expect(b().dot).toBe(198);
  });
  it('uses attack, damage and critical buffs at each tick', () => {
    const { sim, skill, b } = state(); detonate(sim, skill); sim.advanceTo(2.25);
    expect(b().dot).toBe(24);
    sim.applyBuff({ id: 'late', duration: 1, mod: { bucket: 'atk', value: 1, source: 'test' } });
    sim.applyBuff({ id: 'crit', duration: 1, mod: { bucket: 'critRate', value: 1, source: 'test' } });
    sim.advanceTo(2.75); expect(b().dot).toBe(24 + (2 + 0.1 * 200) * 3 * 2);
    sim.advanceTo(3.75); expect(b().dot).toBe(24 + 132 + 36);
  });
  it('does not draw, grant gauge, proc corrosion or reapply itself on poison ticks', () => {
    const { sim, skill, b, checks } = state(); sim.build.params.gaugePerHit.normal = 0.1;
    sim.applyBuff({ id: 'corrosion_window', duration: 10, mod: { bucket: 'atk', value: 0, source: 'test' } });
    detonate(sim, skill); sim.advanceTo(6);
    expect(sim.deck.gauge).toBeCloseTo(0.3);
    expect(checks.filter(p => p === 0.2)).toHaveLength(3); expect(checks.filter(p => p === 0.3)).toHaveLength(3);
    expect(b().dot).toBe(132); expect(sim.cardsDrawn).toBe(0);
  });
  it('keeps damage totals and iteration averages consistent with the DOT breakdown', () => {
    const { sim } = state(); const cfg = { seed: 1, iterations: 3, durationSec: 8 };
    const result = simulate(sim.build, [], cfg);
    const runs = [0, 1, 2].map(i => runOnce(sim.build, [], cfg.seed + i * 7919, cfg.durationSec));
    const dot = runs.reduce((sum, r) => sum + r.breakdown.reduce((s, b) => s + (b.dot ?? 0), 0), 0) / 3;
    expect(result.breakdown[0]!.dot).toBeCloseTo(dot);
    expect(result.breakdown.reduce((sum, b) => sum + b.direct + b.stackEffect + (b.dot ?? 0), 0)).toBeCloseTo(result.dps.mean * 8);
  });
});
