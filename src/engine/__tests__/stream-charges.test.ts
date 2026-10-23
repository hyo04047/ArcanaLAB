import { coreTestPassives } from './core-fixture';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { damageWarnings } from '../skilldata';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function input(point = 10): RawArmory {
  const skill = structuredClone(load('tests/fixtures/audit/2026-10-13-hit-buff-sources.json').official.data.find((s: { Name: string }) => s.Name === '스트림 오브 엣지'));
  skill.Rune = null;
  const slot = structuredClone(load('tests/fixtures/audit/2026-10-13-stream-core-sources.json').slot);
  slot.Point = point; slot.Gems = [];
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [skill],
    arkpassive: coreTestPassives(), arkgrid: { Slots: [slot] }, engravings: null, gems: null };
}
function fixture(point = 10, duration = 20) {
  const result = buildFromArmory(input(point)), build = result.build;
  build.passiveMods = []; build.bluntThorn = undefined;
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
  const s = build.skills[0]!; s.onCast = []; s.onHit = []; s.cooldown = duration; s.castTime = 0;
  s.delayedHits = undefined;
  const sim = new SimState(build, createRng(1), cardsFor('empress'));
  return { ...result, s, sim };
}
const cooldownBuff = (sim: SimState, duration: number, value = 0.15) => sim.applyBuff({
  id: 'judgment_rune', duration, mod: { bucket: 'cooldown', value, source: '심판 룬 통제' },
});

describe('Stream stored charges and serial recharge candidate', () => {
  it.each([[9, undefined], [10, 2], [17, 2]])('requires the 10P threshold (%s)', (point, maxCharges) => {
    expect(fixture(point).s.maxCharges).toBe(maxCharges);
  });
  it('does not interpret a changed conditional charge sentence', () => {
    const raw = input(); raw.arkgrid!.Slots![0]!.Tooltip = raw.arkgrid!.Slots![0]!.Tooltip!.replace('최대 ', '특정 조건에서 최대 ');
    const { build, warnings } = buildFromArmory(raw);
    expect(build.skills[0]!.maxCharges).toBeUndefined();
    expect(warnings.some(w => w.includes('10P') && w.includes('미모델'))).toBe(true);
  });
  it('can spend two stored uses but cannot cast a third before recharge', () => {
    const { s, sim } = fixture(); sim.cast(s, 50); expect(sim.isReady(s.id)).toBe(true);
    sim.cast(s, 50); expect(sim.isReady(s.id)).toBe(false);
    expect(() => sim.cast(s, 50)).toThrow('cooldown');
    expect(sim.breakdown.get(s.id)!.casts).toBe(2);
  });
  it('retains the first clock when the second use is spent later', () => {
    const { s, sim } = fixture(); sim.cast(s, 50); sim.advanceTo(7); sim.cast(s, 50);
    expect(sim.readyAt.get(s.id)).toBe(20);
    sim.advanceTo(19.999); expect(sim.isReady(s.id)).toBe(false);
    sim.advanceTo(20); expect(sim.isReady(s.id)).toBe(true);
    sim.cast(s, 50); expect(sim.isReady(s.id)).toBe(false);
    expect(sim.readyAt.get(s.id)).toBe(40);
  });
  it('refills serially, including a jump over more than one recharge', () => {
    const { s, sim } = fixture(); sim.cast(s, 100); sim.cast(s, 100);
    sim.advanceTo(40); sim.cast(s, 100); sim.cast(s, 100);
    expect(sim.isReady(s.id)).toBe(false); expect(sim.readyAt.get(s.id)).toBe(60);
  });
  it('never accumulates a third charge while idle and restarts at the next use', () => {
    const { s, sim } = fixture(); sim.cast(s, 200); sim.advanceTo(100);
    sim.cast(s, 200); sim.cast(s, 200); expect(sim.isReady(s.id)).toBe(false);
    expect(sim.readyAt.get(s.id)).toBe(120);
  });
  it('takes a new cooldown snapshot when each recharge actually begins', () => {
    const { s, sim } = fixture(10, 20); cooldownBuff(sim, 6, 0.5);
    sim.cast(s, 50); sim.advanceTo(1); sim.cast(s, 50);
    expect(sim.readyAt.get(s.id)).toBe(10);
    sim.advanceTo(10); expect(sim.readyAt.get(s.id)).toBe(30);
  });
  it('can apply Judgment started after both uses to the next recharge', () => {
    const { s, sim } = fixture(10, 10); sim.cast(s, 50); sim.cast(s, 50);
    sim.advanceTo(8); cooldownBuff(sim, 6);
    expect(sim.readyAt.get(s.id)).toBe(10);
    sim.advanceTo(10); expect(sim.readyAt.get(s.id)).toBeCloseTo(18.5);
  });
  it('does not use a buff that expires exactly when the next recharge starts', () => {
    const { s, sim } = fixture(10, 10); sim.cast(s, 50); sim.cast(s, 50);
    sim.advanceTo(4); cooldownBuff(sim, 6);
    sim.advanceTo(10); expect(sim.readyAt.get(s.id)).toBe(20);
  });
  it('reduces only the running remaining recharge and preserves the next full period', () => {
    const { s, sim } = fixture(); sim.cast(s, 50); sim.cast(s, 50);
    sim.advanceTo(4); sim.reduceAllCooldowns(0.5);
    expect(sim.readyAt.get(s.id)).toBe(12);
    sim.advanceTo(12); expect(sim.readyAt.get(s.id)).toBe(32);
  });
  it('also reduces recharge while one use remains available', () => {
    const { s, sim } = fixture(); sim.cast(s, 50); sim.advanceTo(4); sim.reduceAllCooldowns(0.5);
    expect(sim.isReady(s.id)).toBe(true); sim.advanceTo(12);
    sim.cast(s, 50); sim.cast(s, 50); expect(sim.isReady(s.id)).toBe(false);
  });
  it('processes a recharge reduced to now before the next input', () => {
    const { s, sim } = fixture(); sim.cast(s, 50); sim.cast(s, 50);
    sim.advanceTo(4); sim.reduceAllCooldowns(1); sim.cast(s, 50);
    expect(sim.isReady(s.id)).toBe(false); expect(sim.readyAt.get(s.id)).toBe(24);
  });
  it('keeps the Wheel assumption to this use and does not reset a previous running recharge', () => {
    const { s, sim } = fixture(); sim.cast(s, 50); sim.advanceTo(4);
    sim.setNextSkillCooldownReset(); sim.cast(s, 50);
    expect(sim.nextSkillCdReset).toBe(false); expect(sim.isReady(s.id)).toBe(true);
    expect(sim.readyAt.get(s.id)).toBe(20); sim.cast(s, 50); expect(sim.isReady(s.id)).toBe(false);
  });
  it('supports zero cooldown without an endless recharge event', () => {
    const { s, sim } = fixture(10, 0); for (let i = 0; i < 5; i++) sim.cast(s, 10);
    sim.advanceTo(10); expect(sim.isReady(s.id)).toBe(true);
  });
  it('keeps an ordinary one-use skill unavailable until its old cooldown ends', () => {
    const { s, sim } = fixture(9); sim.cast(s, 50);
    expect(sim.isReady(s.id)).toBe(false); sim.advanceTo(20); expect(sim.isReady(s.id)).toBe(true);
  });
  it('draws on each actual cast, never on recharge', () => {
    const { build, s } = fixture(); s.tags = ['destiny']; build.onDestiny = ['drawCard'];
    const sim = new SimState(build, createRng(2), cardsFor('empress'));
    sim.cast(s, 50); sim.cast(s, 50); expect(sim.cardDraws.destiny).toBe(2);
    sim.advanceTo(40); expect(sim.cardDraws.destiny).toBe(2);
  });
  it('keeps both persistent-hit instances alive while recharge is independent', () => {
    const { build } = buildFromArmory(input()); build.passiveMods = [];
    build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 };
    const s = build.skills[0]!; s.onCast = []; s.onHit = []; s.mods = []; s.cooldown = 20;
    const sim = new SimState(build, createRng(1), []);
    sim.cast(s, 50); sim.cast(s, 50); sim.advanceTo(7);
    expect(sim.total).toBeCloseTo(2 * (s.directCoef * build.params.atkBase + (s.directFlat ?? 0)), 5);
    expect(sim.readyAt.get(s.id)).toBe(20); expect(sim.isReady(s.id)).toBe(false);
  });
  it('exposes the candidate recharge rules and keeps Stream out of default Wheel targets', () => {
    const build = empressInkomsu440();
    expect(build.skills.find(s => s.id === 'stream_of_edge')!.maxCharges).toBe(2);
    expect(build.rotation.wheelTargets).not.toContain('stream_of_edge');
    expect(damageWarnings(build).some(w => w.includes('순차 충전') && w.includes('미검증'))).toBe(true);
  });
});
