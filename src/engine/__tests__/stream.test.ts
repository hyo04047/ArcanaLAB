import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { damageWarnings } from '../skilldata';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const source = load('tests/fixtures/audit/2026-10-13-hit-buff-sources.json').official.data.find((s: { Name: string }) => s.Name === '스트림 오브 엣지');
function input(tripods = ['카드 증가', '다크니스 엣지', '퍼펙트 스트림']): RawArmory {
  const s = structuredClone(source); s.Rune = null;
  s.Tripods.forEach((t: { Name: string; IsSelected: boolean }) => t.IsSelected = tripods.includes(t.Name));
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [s], arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
function fixture() {
  const { build } = buildFromArmory(input()), s = build.skills[0]!;
  build.passiveMods = []; build.bluntThorn = undefined; build.onDestiny = []; build.onRuinAt4 = [];
  build.params.atkBase = 100; build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  return { sim: new SimState(build, createRng(1), []), s };
}
const rate = (sim: SimState) => sim.buffs.modsAt(sim.now).filter(m => m.source === '다크니스 엣지').reduce((sum, m) => sum + m.value, 0);

describe('Stream 132 persistent hit candidate', () => {
  it('splits total damage into 15 hits and only grants stacks on hits 5, 10, 15', () => {
    const { s } = fixture();
    expect(s.delayedHits?.hits).toHaveLength(15);
    expect(s.castTime).toBe(1.133);
    expect(s.delayedHits?.hits.filter(h => h.stacksGranted).map(h => [h.after, h.stacksGranted])).toEqual([[1.5, 1], [3, 1], [4.5, 1]]);
    expect(s.delayedHits?.hits.reduce((sum, h) => sum + h.directCoef, 0)).toBeCloseTo(s.directCoef, 12);
    expect(s.delayedHits?.hits.reduce((sum, h) => sum + h.directFlat, 0)).toBeCloseTo(s.directFlat!, 12);
  });
  it('starts without critical rate before the first hit', () => {
    const { s, sim } = fixture(); sim.cast(s, 0.598);
    expect(sim.total).toBe(0); expect(rate(sim)).toBe(0); expect(sim.stacks).toBe(0);
  });
  it('ramps critical rate and refreshes until three seconds after the last hit', () => {
    const { s, sim } = fixture(); sim.cast(s, 0.599);
    expect(rate(sim)).toBeCloseTo(0.0552); expect(sim.stacks).toBe(0);
    sim.advanceTo(0.9); expect(rate(sim)).toBeCloseTo(0.1104);
    sim.advanceTo(1.8); expect(rate(sim)).toBeCloseTo(0.276);
    sim.advanceTo(4.8); expect(rate(sim)).toBeCloseTo(0.276);
    sim.advanceTo(7.798); expect(rate(sim)).toBeCloseTo(0.276);
    sim.advanceTo(7.8); expect(rate(sim)).toBe(0);
  });
  it('grants three separated stacks, with no stack from ordinary damage ticks', () => {
    const { s, sim } = fixture(); sim.cast(s, 20);
    expect(sim.stacks).toBe(0);
    sim.advanceTo(1.798); expect(sim.stacks).toBe(0);
    sim.advanceTo(1.8); expect(sim.stacks).toBe(1);
    sim.advanceTo(3.298); expect(sim.stacks).toBe(1);
    sim.advanceTo(3.3); expect(sim.stacks).toBe(2);
    sim.advanceTo(4.8); expect(sim.stacks).toBe(3);
  });
  it('continues filling stacks after an intervening four-stack ruin', () => {
    const { s, sim } = fixture(); sim.cast(s, 20); sim.advanceTo(1.8); sim.stacks = 4;
    const ruin: SkillDef = { id: 'test_ruin', name: '통제 루인', kind: 'ruin', cooldown: 0, castTime: 0, directCoef: 0, hits: 1 };
    sim.hit(ruin, { id: ruin.id, name: ruin.name, casts: 1, direct: 0, stackEffect: 0 });
    expect(sim.stacks).toBe(0);
    sim.advanceTo(3.3); expect(sim.stacks).toBe(1);
    sim.advanceTo(4.8); expect(sim.stacks).toBe(2);
  });
  it('checks Balance on each real stack grant, including expiry between grants', () => {
    const { s, sim } = fixture(); sim.cast(s, 20);
    sim.applyBuff({ id: 'balance', duration: 2, mod: { bucket: 'skillDmg', value: 0, source: '균형 통제' } });
    sim.advanceTo(1.8); expect(sim.stacks).toBe(2); sim.stacks = 0;
    sim.advanceTo(3.3); expect(sim.stacks).toBe(1); sim.stacks = 0;
    sim.advanceTo(4.8); expect(sim.stacks).toBe(1);
  });
  it('speeds up placement but preserves the installed tick interval', () => {
    const { s, sim } = fixture();
    sim.build.passiveMods = [{ bucket: 'atkSpeed', value: 0.4, source: '통제 공속' }];
    sim.cast(s, 20); expect(sim.now).toBeCloseTo(1.133 / 1.4);
    sim.advanceTo(0.299 / 1.4 + 1.499); expect(sim.stacks).toBe(0);
    sim.advanceTo(0.299 / 1.4 + 1.501); expect(sim.stacks).toBe(1);
    sim.advanceTo(0.299 / 1.4 + 3.001); expect(sim.stacks).toBe(2);
  });
  it('keeps the complete deterministic damage sum equal to the original coefficient', () => {
    const { s, sim } = fixture(); delete s.onHit;
    sim.cast(s, 20); sim.advanceTo(6);
    expect(sim.total).toBeCloseTo(100 * s.directCoef + s.directFlat!, 9);
  });
  it('counts only landed hits if the run ends during the installed attack', () => {
    const { s, sim } = fixture(); delete s.onHit;
    sim.cast(s, 0.9);
    expect(sim.total).toBeCloseTo((100 * s.directCoef + s.directFlat!) * 2 / 15, 9);
    expect(sim.stacks).toBe(0);
  });
  it.each([[0.598, false], [0.6, true], [7.798, true], [7.8, false]])('allows Judgment at %s only while a landed Conviction is active', (at, active) => {
    const { s, sim } = fixture(); s.hitRune = { kind: 'conviction', chance: 1, duration: 3 };
    sim.cast(s, Number(at)); sim.advanceTo(Number(at));
    const judgment: SkillDef = { id: 'test_judgment', name: '통제 심판', kind: 'normal', cooldown: 0, castTime: 0,
      directCoef: 0, hits: 1, hitRune: { kind: 'judgment', chance: 1, duration: 6 } };
    sim.hit(judgment, { id: judgment.id, name: judgment.name, casts: 1, direct: 0, stackEffect: 0 });
    expect(sim.buffs.has('judgment_rune', sim.now)).toBe(active);
  });
  it('connects the same hit profile and stacking buff to the preset', () => {
    const s = empressInkomsu440().skills.find(s => s.id === 'stream_of_edge')!;
    expect(s.delayedHits?.hits).toHaveLength(15); expect(s.hits).toBe(15);
    expect(s.onCast?.some(e => e.mod.source === '다크니스 엣지')).toBe(false);
    expect(s.onHit?.find(e => e.mod.source === '다크니스 엣지')?.maxStacks).toBe(5);
  });
  it.each([['엣지 밤', '다크니스 엣지', '퍼펙트 스트림'], ['카드 증가', '데스 휠', '퍼펙트 스트림'], ['카드 증가', '다크니스 엣지', '스트림 웨이브']])(
    'does not silently apply the 132 timing to a different combination %j', (...names) => {
      const result = buildFromArmory(input(names));
      expect(result.build.skills[0]!.delayedHits).toBeUndefined();
      expect(result.warnings.some(w => w.includes('스트림') && w.includes('조합'))).toBe(true);
    });
  it('reads acceleration as a four-second movement buff without changing damage', () => {
    const { build } = buildFromArmory(input(['가속 스트림', '다크니스 엣지', '퍼펙트 스트림']));
    expect(build.skills[0]!.onCast).toContainEqual({ id: 'stream_acceleration', duration: 4,
      mod: { bucket: 'moveSpeed', value: 0.3, source: '가속 스트림' } });
  });
  it('warns about candidate timing instead of claiming measured live frames', () => {
    const { sim } = fixture();
    expect(damageWarnings(sim.build).some(w => w.includes('스트림') && w.includes('0.3') && w.includes('미검증'))).toBe(true);
  });
});
