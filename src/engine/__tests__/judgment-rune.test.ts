import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { damageWarnings } from '../skilldata';
import type { SkillDef } from '../types';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-rune-sources.json', 'utf8')).characters[0].skills as RawArmory['combatSkills'];
const profile = JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8'));
const base = JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/combat-skills.json', 'utf8')).find((s: { Name: string }) => s.Name === '스트림 오브 엣지');
function input(name = '단죄'): RawArmory {
  return { profiles: profile, combatSkills: [{ ...base, Tripods: [], Rune: { ...source.find(s => s.Rune!.Name === name)!.Rune! } }],
    arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
function setup(outcomes: boolean[] = []) {
  const skill = (id: string, extra: Partial<SkillDef> = {}): SkillDef => ({ id, name: id, kind: 'normal',
    cooldown: 20, castTime: 1, directCoef: 1, hits: 1, ...extra });
  const c = skill('c', { hitRune: { kind: 'conviction', chance: 0.4, duration: 3 } });
  const j = skill('j', { hitRune: { kind: 'judgment', chance: 0.4, duration: 6 } });
  const target = skill('target');
  const build = empressInkomsu440();
  build.skills = [c, j, target]; build.passiveMods = []; build.bluntThorn = undefined;
  build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = []; build.params.atkBase = 100;
  build.params.gaugePerHit = { stack: 0, normal: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  const checks: number[] = [];
  const sim = new SimState(build, { ...createRng(1), chance(p) {
    if (p === 0.4) { checks.push(p); return outcomes.shift() ?? true; } return false;
  } }, cardsFor('empress'));
  const impact = (s: SkillDef, at: number) => { sim.advanceTo(at); sim.hit(s, sim.breakdown.get(s.id)!); };
  return { sim, c, j, target, checks, impact, active: () => sim.buffs.has('judgment_rune', sim.now) };
}

describe('official conviction and judgment rune conversion', () => {
  it.each([['단죄', 'conviction', 3], ['심판', 'judgment', 6]])('reads %s chance/duration from the current official tooltip', (name, kind, duration) => {
    const r = buildFromArmory(input(String(name)));
    expect(r.build.skills[0]!.hitRune).toEqual({ kind, chance: 0.4, duration });
    expect(r.warnings.some(w => w.includes('단죄·심판 룬') && w.includes('합산 판정'))).toBe(true);
    expect(r.build.skills[0]!.mods?.some(m => m.bucket === 'critDmg')).toBe(false);
  });
  it.each(['단죄', '심판'])('uses displayed %s values instead of a rarity fallback', name => {
    const raw = input(name); const r = raw.combatSkills[0]!.Rune!;
    r.Tooltip = r.Tooltip!.replace('40%', '17%').replace(name === '단죄' ? '3초간' : '6초간', '2초간');
    expect(buildFromArmory(raw).build.skills[0]!.hitRune).toMatchObject({ chance: 0.17, duration: 2 });
  });
  it.each(['단죄', '심판'])('rejects missing, changed, or invalid %s text without guessing', name => {
    for (const replacement of ['', '새 조건으로 40% 증가', '150%', '0초간']) {
      const raw = input(name); const r = raw.combatSkills[0]!.Rune!;
      r.Tooltip = replacement === '150%' ? r.Tooltip!.replace('40%', replacement)
        : replacement === '0초간' ? r.Tooltip!.replace(/\d초간/, replacement) : replacement;
      const converted = buildFromArmory(raw);
      expect(converted.build.skills[0]!.hitRune).toBeUndefined();
      expect(converted.warnings.some(w => w.includes(`룬 ${name} 해석 못함`))).toBe(true);
    }
  });
  it('does not treat the combination name as a crit-damage rune', () => {
    const raw = input(); raw.combatSkills[0]!.Rune = { Name: '단심', Grade: '전설', Tooltip: '40%' };
    const r = buildFromArmory(raw);
    expect(r.build.skills[0]!.hitRune).toBeUndefined(); expect(r.build.skills[0]!.mods).toEqual([]);
    expect(r.warnings.some(w => w.includes('개별 룬 입력 필요'))).toBe(true);
  });
});

describe('conviction and judgment state transitions', () => {
  it('requires a hit and the correct order; failed judgment preserves conviction', () => {
    const { sim, c, j, impact, checks, active } = setup([true, false, true]);
    impact(j, 0); expect(checks).toHaveLength(0); expect(active()).toBe(false);
    impact(c, 1); impact(j, 2); expect(active()).toBe(false);
    impact(j, 3); expect(active()).toBe(true); expect(checks).toHaveLength(3);
    sim.advanceTo(9); impact(j, 10); expect(active()).toBe(false); expect(checks).toHaveLength(3);
  });
  it.each([[3.999, true], [4, false], [4.001, false]])('expires conviction at the exact boundary (%ss)', (at, expected) => {
    const { c, j, impact, active } = setup(); impact(c, 1); impact(j, Number(at)); expect(active()).toBe(expected);
  });
  it('refreshes conviction on successful later hits before judgment', () => {
    const { c, j, impact, active } = setup(); impact(c, 1); impact(c, 3); impact(j, 5); expect(active()).toBe(true);
  });
  it('starts the shared 30s internal cooldown on judgment rather than conviction', () => {
    const { sim, c, j, target, impact, active, checks } = setup();
    impact(c, 0); impact(j, 2); expect(active()).toBe(true);
    sim.reduceAllCooldowns(1); sim.setNextSkillCooldownReset();
    impact({ ...target, hitRune: c.hitRune }, 31.999); impact(j, 31.999);
    expect(checks).toHaveLength(2); expect(active()).toBe(false);
    impact(c, 32); impact(j, 32); expect(active()).toBe(true); expect(checks).toHaveLength(4);
  });
  it('does not start the internal cooldown if conviction expires or fails', () => {
    const { c, j, impact, active } = setup([false, true, true, true]);
    impact(c, 0); impact(j, 1); expect(active()).toBe(false);
    impact(c, 2); impact(j, 5); expect(active()).toBe(false);
    impact(c, 6); impact(j, 7); expect(active()).toBe(true);
  });
  it('tries each direct hit but does not add a ruin explosion trial', () => {
    const { sim, c, j, impact, checks, active } = setup([false, false, true, false, true]);
    impact({ ...c, kind: 'ruin', hits: 3 }, 1); sim.stacks = 4;
    impact({ ...j, kind: 'ruin', hits: 3 }, 2);
    expect(checks).toHaveLength(5); expect(active()).toBe(true);
  });
  it('does not grant four stacks or alter direct crit damage', () => {
    const { sim, c, j, impact } = setup(); impact(c, 1); impact(j, 2);
    expect(sim.judgmentActive()).toBe(false); expect(sim.stacks).toBe(0);
    expect(computeMultipliers({ atkBase: 100 }, sim.activeMods(), { skill: j, component: 'direct', stacks: 0 }).critDmg).toBe(2);
  });
  it('allows the judgment card and rune to expire independently', () => {
    const { sim, c, j, target, impact } = setup();
    sim.drawCards(1, 'judgment'); sim.useCardNow('judgment');
    expect(sim.judgmentActive()).toBe(true); expect(sim.cooldownMultiplier(target)).toBe(1);
    impact(c, 1); impact(j, 2); sim.advanceTo(6);
    expect(sim.judgmentActive()).toBe(false); expect(sim.cooldownMultiplier(target)).toBe(0.85);
    sim.advanceTo(8); expect(sim.cooldownMultiplier(target)).toBe(1);
  });
});

describe('judgment rune cooldown and delayed-hit integration', () => {
  it('affects only future cooldown starts and multiplies swiftness and gems', () => {
    const { sim, c, j, target } = setup();
    sim.build.passiveMods = [{ bucket: 'cooldown', value: 0.3, source: '신속 통제' },
      { bucket: 'cooldown', value: 0.2, filter: { ids: ['target'] }, source: '보석 통제' }];
    sim.cast(c, 10); sim.cast(j, 10);
    expect(sim.readyAt.get('c')).toBe(14); expect(sim.readyAt.get('j')).toBe(15);
    sim.cast(target, 10); expect(sim.readyAt.get('target')).toBeCloseTo(2 + 20 * 0.7 * 0.8 * 0.85);
    sim.advanceTo(7.999); expect(sim.cooldownMultiplier(target)).toBeCloseTo(0.7 * 0.8 * 0.85);
    sim.advanceTo(8); expect(sim.cooldownMultiplier(target)).toBeCloseTo(0.7 * 0.8);
  });
  it.each(['hyper_awakening', 'awakening'] as const)('applies to %s cooldown starts without confusing T and awakening', kind => {
    const { sim, c, j, target, impact } = setup(); impact(c, 0); impact(j, 0);
    target.kind = kind; sim.cast(target, 5); expect(sim.readyAt.get('target')).toBe(17);
  });
  it('does not proc from a cast cut off before its first hit', () => {
    const { sim, c, checks } = setup(); sim.cast(c, 0.5); expect(checks).toHaveLength(0);
  });
  it('uses projectile impact order even when judgment was cast first', () => {
    const { sim, c, j, active, checks } = setup();
    j.castTime = 0.2; j.delayedHits = { duration: 0.2, spawnAt: 0.1, hits: [{ after: 2, directCoef: 1, directFlat: 0 }] };
    sim.cast(j, 10); expect(checks).toHaveLength(0); sim.cast(c, 10); expect(active()).toBe(false);
    sim.advanceTo(2.1); expect(active()).toBe(true); expect(checks).toHaveLength(2);
    expect(sim.readyAt.get('j')).toBe(20);
  });
  it('does not retrigger from poison ticks', () => {
    const { sim, c, j, checks, impact, active } = setup([true, false, false, false]);
    j.fearOfDeath = { coef: 1, flat: 1, maxStacks: 1, duration: 3, firstTick: 0.5, interval: 1 };
    impact(c, 0); impact(j, 1); sim.advanceTo(5);
    expect(sim.breakdown.get('j')!.dot).toBeGreaterThan(0); expect(checks).toHaveLength(2); expect(active()).toBe(false);
  });
  it('uses an acquired rune buff on Evoke followup, not its first installation', () => {
    const { sim, c, j, target, impact } = setup();
    target.manualEvoke = { duration: 1, placementAt: 0.2, minRecastDelay: 1, lifetime: 10, recastRecovery: 0, hits: [{ after: 0, weight: 1 }] };
    sim.cast(target, 10); expect(sim.readyAt.has('target')).toBe(false);
    impact(c, 1); impact(j, 1); sim.advanceTo(2); sim.cast(target, 10);
    expect(sim.readyAt.get('target')).toBe(19);
  });
  it('warns about missing hit timings without treating the rune as absent', () => {
    const { sim } = setup();
    expect(damageWarnings(sim.build).filter(w => w.includes('단죄·심판 룬') && w.includes('합산 판정'))).toHaveLength(2);
  });
});
