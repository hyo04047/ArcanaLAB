import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory } from '../armory';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

function state(bonuses: number[]) {
  const build = empressInkomsu440();
  build.passiveMods = bonuses.map(value => ({ bucket: 'atkSpeed', value, source: '합성 공속' }));
  build.skills = [{ id: 'control', name: '통제 스킬', kind: 'normal', cooldown: 10, castTime: 1.4, directCoef: 0, hits: 0 }];
  build.onDestiny = []; build.onCardUse = []; build.onRuinAt4 = [];
  return new SimState(build, createRng(1), []);
}

describe('global attack speed cap', () => {
  it.each([0, 0.4])('keeps preset Nimble Movement local to Call at global bonus %s', bonus => {
    const build = empressInkomsu440(), call = build.skills.find(s => s.id === 'call_of_destiny')!;
    build.passiveMods = [{ bucket: 'atkSpeed', value: bonus, source: '통제 공속' }];
    build.params.gaugePerHit.stack = 0;
    const sim = new SimState(build, createRng(1), []);
    sim.cast(call, 10);
    expect(sim.now).toBeCloseTo(0.7 / (1.27 * (1 + bonus)));
    expect(sim.atkSpeed()).toBeCloseTo(bonus);
    const scratch = build.skills.find(s => s.id === 'scratch_dealer')!, start = sim.now;
    scratch.onCast = [];
    sim.cast(scratch, 10);
    expect(sim.now - start).toBeCloseTo(scratch.castTime / (1 + bonus));
    expect(sim.activeMods().some(m => m.source === '날렵한 움직임')).toBe(false);
  });
  it('matches API Nimble Movement cast speed without granting a timed buff', () => {
    const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-stack-skill-sources.json', 'utf8'));
    const skill = structuredClone(source.official.data.find((s: { Name: string }) => s.Name === '운명의 부름'));
    skill.Rune = null;
    const profiles = JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8'));
    const imported = buildFromArmory({ profiles, combatSkills: [skill], arkpassive: null, arkgrid: null, engravings: null, gems: null }).build.skills[0]!;
    const preset = empressInkomsu440().skills.find(s => s.id === 'call_of_destiny')!;
    expect(preset.castTime).toBeCloseTo(imported.castTime);
    expect(preset.onCast?.some(e => e.mod.source === '날렵한 움직임') ?? false).toBe(false);
  });
  it.each([[0, 0], [0.2, 0.2], [0.4, 0.4], [0.55, 0.4], [-0.1, -0.1]])(
    'caps bonus %s at %s without removing a slowdown', (input, expected) => {
      const sim = state([input]);
      expect(sim.atkSpeed()).toBeCloseTo(expected);
      sim.cast(sim.build.skills[0]!, 10);
      expect(sim.now).toBeCloseTo(1.4 / (1 + expected));
      expect(sim.readyAt.get('control')).toBe(10);
    });
  it('adds penalties and bonuses before capping, then reads buff expiration', () => {
    const sim = state([0.45, -0.1]);
    expect(sim.atkSpeed()).toBeCloseTo(0.35);
    sim.applyBuff({ id: 'speed', duration: 2, mod: { bucket: 'atkSpeed', value: 0.15, source: '합성 버프' } });
    expect(sim.atkSpeed()).toBeCloseTo(0.4);
    sim.advanceTo(2); expect(sim.atkSpeed()).toBeCloseTo(0.35);
  });
  it('caps cast-triggered Mayhem stacks without mutating the stored buff', () => {
    const sim = state([0.35]), skill = sim.build.skills[0]!;
    skill.cooldown = 0; skill.castTime = 0;
    sim.applyBuff({ id: 'mayhem_window', duration: 30, mod: { bucket: 'atkSpeed', value: 0, source: '광기' } });
    for (let i = 0; i < 5; i++) sim.cast(skill, 10);
    expect(sim.atkSpeed()).toBeCloseTo(0.4);
    expect(sim.activeMods().find(m => m.source === '광기' && m.value > 0)?.value).toBeCloseTo(0.15);
    sim.advanceTo(4); expect(sim.atkSpeed()).toBeCloseTo(0.35);
  });
  it('keeps Galewind outside the global cap after armory conversion', () => {
    const load = (file: string) => JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/' + file + '.json', 'utf8'));
    const raw = load('combat-skills').find((s: { Name: string }) => s.Name === '셀레스티얼 레인');
    const input = { profiles: load('profiles'), combatSkills: [{ ...raw, Tripods: [], Rune: null }], arkpassive: null, arkgrid: null, engravings: null, gems: null };
    const base = buildFromArmory(input).build.skills[0]!;
    input.combatSkills[0].Rune = { Name: '질풍', Tooltip: JSON.stringify({ value: '스킬 시전 속도가 14% 증가합니다.' }) };
    const fast = buildFromArmory(input).build.skills[0]!;
    expect(fast.castTime).toBeCloseTo(base.castTime / 1.14);
    const sim = state([0.7]);
    const skill: SkillDef = { ...sim.build.skills[0]!, castTime: fast.castTime };
    sim.cast(skill, 10);
    expect(sim.now).toBeCloseTo(base.castTime / (1.4 * 1.14));
  });
});
