import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef, TimedEffect } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-hit-buff-sources.json').official.data;
function input(name: string, tripods: string[]): RawArmory {
  const skill = structuredClone(source.find((s: { Name: string }) => s.Name === name));
  skill.Level = 10; skill.Rune = null;
  skill.Tripods.forEach((t: { Name: string; IsSelected: boolean }) => t.IsSelected = tripods.includes(t.Name));
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [skill], arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
function state(skills: SkillDef[]) {
  const build = empressInkomsu440();
  build.skills = skills; build.passiveMods = [{ bucket: 'critRate', value: 1, source: '통제 치적' }];
  build.bluntThorn = undefined; build.params.atkBase = 100;
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  build.onDestiny = []; build.onRuinAt4 = [];
  return new SimState(build, createRng(1), []);
}
const buff: TimedEffect = { id: 'critical', duration: 5, mod: { bucket: 'critDmg', value: 0.775, source: '통제 적중 치피' } };
const skill = (extra: Partial<SkillDef> = {}): SkillDef => ({ id: 'test', name: '통제', kind: 'normal', cooldown: 0,
  castTime: 1, directCoef: 1, directFlat: 0, hits: 1, ...extra });

describe('hit-triggered critical buffs', () => {
  it.each([['운명의 부름', '어두운 운명', 5], ['리턴', '노출된 어둠', 7], ['스파이럴 엣지', '급소 포착', 5]] as const)(
    'converts %s %s as a shared on-hit effect lasting %s', (name, tripod, duration) => {
      const { build } = buildFromArmory(input(name, [tripod])), s = build.skills[0]!;
      expect(s.onHit).toContainEqual({ id: 'arcana_crit_damage', duration, mod: { bucket: 'critDmg', value: 0.775, source: tripod } });
      expect(s.onCast?.some(e => e.mod.bucket === 'critDmg')).toBe(false);
    });
  it.each(['스크래치 딜러', '리턴'])('converts %s synergy to one shared debuff', name => {
    const { build } = buildFromArmory(input(name, ['급소 노출'])), s = build.skills[0]!;
    expect(s.onHit).toContainEqual({ id: 'arcana_crit_resistance', duration: 10, mod: { bucket: 'critRate', value: 0.1, source: '급소 노출' } });
    expect(s.onCast?.some(e => e.mod.source === '급소 노출')).toBe(false);
  });
  it('keeps Return own critical rate separate from its global hit buff', () => {
    const s = buildFromArmory(input('리턴', ['노출된 어둠'])).build.skills[0]!;
    const own = computeMultipliers({ atkBase: 100 }, s.mods!, { skill: s, stacks: 0, component: 'direct' });
    expect(own.critRate).toBe(0.4); expect(own.critDmg).toBe(2);
    expect(computeMultipliers({ atkBase: 100 }, s.mods!, { skill: skill(), stacks: 0, component: 'direct' }).critRate).toBe(0);
  });
  it('retains Call own 15% direct damage alongside the timed critical buff', () => {
    const s = buildFromArmory(input('운명의 부름', ['어두운 운명'])).build.skills[0]!;
    const own = computeMultipliers({ atkBase: 100 }, s.mods!, { skill: s, stacks: 0, component: 'direct' });
    expect(own.nonCrit).toBe(1.15); expect(own.critDmg).toBe(2);
    expect(computeMultipliers({ atkBase: 100 }, s.mods!, { skill: skill(), stacks: 0, component: 'direct' }).nonCrit).toBe(1);
  });
  it('does not grant a buff if the run ends before impact', () => {
    const s = skill({ onHit: [buff] }), sim = state([s]); sim.cast(s, 0.5);
    expect(sim.total).toBe(0); expect(sim.buffs.has(buff.id, sim.now)).toBe(false);
  });
  it('starts duration at impact after calculating the triggering hit', () => {
    const s = skill({ onHit: [buff] }), sim = state([s]); sim.cast(s, 10);
    expect(sim.total).toBe(200); expect(sim.buffs.remaining(buff.id, sim.now)).toBe(5);
    sim.advanceTo(5.99); expect(sim.buffs.has(buff.id, sim.now)).toBe(true);
    sim.advanceTo(6); expect(sim.buffs.has(buff.id, sim.now)).toBe(false);
  });
  it('refreshes duration at each scheduled hit and affects subsequent damage', () => {
    const s = skill({ onHit: [buff], delayedHits: { duration: 1, spawnAt: 0.5,
      hits: [{ after: 1, directCoef: 1, directFlat: 0 }, { after: 2, directCoef: 1, directFlat: 0 }] } });
    const sim = state([s]); sim.cast(s, 10);
    expect(sim.buffs.has(buff.id, sim.now)).toBe(false);
    sim.advanceTo(1.5); expect(sim.total).toBe(200);
    sim.advanceTo(2.5); expect(sim.total).toBe(477.5); expect(sim.buffs.remaining(buff.id, sim.now)).toBe(5);
  });
  it('replaces identical class critical buffs while retaining Cull as a separate bonus', () => {
    const call = buildFromArmory(input('운명의 부름', ['어두운 운명'])).build.skills[0]!;
    const ret = buildFromArmory(input('리턴', ['노출된 어둠'])).build.skills[0]!;
    const sim = state([call, ret]); sim.cast(ret, 20); sim.cast(call, 20);
    sim.applyBuff({ id: 'cull_damage', duration: 4, mod: { bucket: 'critDmg', value: 0.5, source: '도태' } });
    expect(computeMultipliers({ atkBase: 100 }, sim.activeMods(), { skill: skill(), stacks: 0, component: 'direct' }).critDmg).toBeCloseTo(3.275);
    expect(sim.buffs.remaining('arcana_crit_damage', sim.now)).toBe(5);
  });
  it('does not add Scratch and Return synergy into 20% critical rate', () => {
    const a = buildFromArmory(input('스크래치 딜러', ['급소 노출'])).build.skills[0]!;
    const b = buildFromArmory(input('리턴', ['급소 노출'])).build.skills[0]!;
    const sim = state([a, b]); sim.build.passiveMods = []; sim.cast(a, 20); sim.cast(b, 20);
    expect(computeMultipliers({ atkBase: 100 }, sim.activeMods(), { skill: skill(), stacks: 0, component: 'direct' }).critRate).toBe(0.1);
  });
  it('keeps the Empress finisher policy aware of a missing hit buff', () => {
    const build = empressInkomsu440(), call = build.skills.find(s => s.id === 'call_of_destiny')!;
    const sim = new SimState(build, createRng(1), []); sim.stacks = 4;
    expect(call.onHit?.some(e => e.id === 'arcana_crit_damage')).toBe(true);
    expect(sim.chooseAction()?.id).toBe(call.id);
    sim.cast(call, 10); expect(sim.chooseAction()?.id).toBe('the_devil');
  });
  it.each(['어두운 운명', '급소 노출'])('rejects changed conditional %s text', name => {
    const raw = input(name === '어두운 운명' ? '운명의 부름' : '스크래치 딜러', [name]);
    raw.combatSkills[0]!.Tripods!.find(t => t.Name === name)!.Tooltip = '특정 조건에서 적중 시 5.0초간 적에게 주는 치명타 피해가 77.5% 증가한다.';
    const result = buildFromArmory(raw), s = result.build.skills[0]!;
    expect(s.onHit ?? []).toEqual([]); expect(s.onCast).toEqual([]);
    expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
  });
});
