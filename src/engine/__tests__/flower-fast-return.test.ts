import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const id = 'dancing_of_spineflower';
function input(): RawArmory {
  const r = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
  return { profiles: r.profiles.data, combatSkills: r['combat-skills'].data, equipment: r.equipment.data,
    arkpassive: r.arkpassive.data, arkgrid: r.arkgrid.data, engravings: r.engravings.data, gems: r.gems.data };
}
const rawFlower = (raw: RawArmory) => raw.combatSkills.find(s => s.Name === '댄싱 오브 스파인플라워')!;
const core = (raw: RawArmory) => raw.arkgrid!.Slots.find(s => s.Name.endsWith('셔플 댄스'))!;
const skill = (raw = input()) => buildFromArmory(raw).build.skills.find(s => s.id === id)!;
function controlled(chance = 1) {
  const build = buildFromArmory(input()).build, flower = skill();
  build.passiveMods = []; build.onDestiny = []; delete build.emperorHeartChance; delete build.bluntThorn;
  build.params.atkBase = 100; build.params.gaugePerHit.normal = 0;
  flower.mods = []; flower.onCast = []; flower.onHit = []; delete flower.runeCdReduce;
  flower.castTime = 1; flower.flowerThornChance = chance; build.skills = [flower];
  const rng = createRng(1), sim = new SimState(build, rng, cardsFor('emperor'));
  return { build, flower, rng, sim };
}

describe('Flower 14P first pair then thorn candidate', () => {
  it.each([9, 10, 13, 14, 20])('requires active 14P at %s points', points => {
    const raw = input(); core(raw).Point = points;
    const s = skill(raw);
    expect(s.hitSequence?.hits.length).toBe(points >= 14 ? 3 : undefined);
    expect(s.flowerThornChance).toBe(points >= 14 ? 0.33 : undefined);
  });
  it.each(Array.from({ length: 20 }, (_, i) => i + 1))('preserves audited damage at level %s', level => {
    const raw = input(); rawFlower(raw).Level = level;
    const expected = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-14-flower-return.json', 'utf8')).rows[level - 1];
    const s = skill(raw), hits = s.hitSequence!.hits;
    expect(hits[0]!.directCoef + hits[1]!.directCoef).toBeCloseTo(expected.firstPairAp);
    expect(s.directCoef).toBeCloseTo(expected.firstPairThenReturnCandidates[1].withCore115Ap);
    expect(s.directFlat).toBeCloseTo(expected.firstPairThenReturnCandidates[1].withCore115Flat);
    expect(s.hits).toBe(3); expect(s.stacksGranted).toBe(0);
  });
  it.each(['tripod', 'core14', 'core10', 'level', 'condition', 'baseFraction'])('does not infer unsupported %s', change => {
    const raw = input(), f = rawFlower(raw), flip = f.Tripods!.find(t => t.Name === '페이크 플립')!;
    if (change === 'tripod') flip.IsSelected = false;
    if (change === 'core14') core(raw).Tooltip = core(raw).Tooltip!.replace('2</FONT>중첩씩', '3</FONT>중첩씩');
    if (change === 'core10') core(raw).Tooltip = core(raw).Tooltip!.replace('적용 시 재사용', '적용 시 치명타 적중 후 재사용');
    if (change === 'level') f.Level = 21;
    if (change === 'condition') raw.arkpassive!.Effects = raw.arkpassive!.Effects.filter(e => !e.Description.includes('또 다른 황제'));
    if (change === 'baseFraction') flip.Tooltip = flip.Tooltip!.replace('40.0%', '50.0%');
    expect(skill(raw).hitSequence).toBeUndefined(); expect(skill(raw).flowerThornChance).toBeUndefined();
  });
  it('keeps thorn-only amplification away from the first pair', () => {
    const raw = input(), before = skill(raw).hitSequence!.hits;
    core(raw).Tooltip = core(raw).Tooltip!.replace('115.0%', '215.0%');
    const after = skill(raw).hitSequence!.hits;
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]!.directCoef / before[2]!.directCoef).toBeCloseTo(3.15 / 2.15);
  });
  it('uses selected tripod stack damage rather than a hard-coded 72%', () => {
    const raw = input(), flip = rawFlower(raw).Tripods!.find(t => t.Name === '페이크 플립')!;
    flip.Tooltip = flip.Tooltip!.replace('72.0%', '36.0%');
    expect(skill(raw).hitSequence!.hits[2]!.directCoef).toBeCloseTo(6.56 * (1 + 0.36 * 4) * 2.15);
  });
  it('rolls each of three hits once and only the thorn can draw', () => {
    const { flower, rng, sim } = controlled();
    const chance = vi.spyOn(rng, 'chance').mockImplementation(p => p === 1);
    const hit = vi.spyOn(sim, 'hit'); sim.cast(flower, 2);
    expect(hit).toHaveBeenCalledTimes(3); expect(chance.mock.calls.filter(([p]) => p === 1)).toHaveLength(1);
    expect(sim.total).toBeCloseTo(flower.directCoef * 100 + flower.directFlat!);
    expect(sim.cardDraws.flowerThorn).toBe(1); expect(sim.cardsUsed).toBe(0); expect(sim.stacks).toBe(0);
    expect(sim.breakdown.get(id)!.casts).toBe(1);
  });
  it.each([0, 1, 2])('honors hand capacity with %s held cards', held => {
    const { flower, sim } = controlled();
    sim.drawCards(held); sim.cast(flower, 2);
    expect(sim.cardDraws.flowerThorn).toBe(held === 2 ? 0 : 1);
    expect(sim.deck.hand).toHaveLength(Math.min(2, held + 1));
  });
  it('does not apply damage or a thorn draw beyond combat end', () => {
    const { flower, sim } = controlled(); sim.cast(flower, 0.999);
    expect(sim.total).toBe(0); expect(sim.cardDraws.flowerThorn).toBe(0);
  });
  it('does not let thorn probability leak to an unrelated last hit', () => {
    const { flower, sim } = controlled();
    const other: SkillDef = { ...flower, id: 'other', hitSequence: undefined };
    sim.hit(other, sim.breakdown.get(id)!);
    expect(sim.cardDraws.flowerThorn).toBe(0);
  });
  it('applies common skill damage to the first pair and thorn once each', () => {
    const { flower, sim } = controlled(0);
    flower.mods = [{ bucket: 'skillDmg', value: 0.5, filter: { ids: [id] }, source: 'probe' }];
    sim.cast(flower, 2);
    expect(sim.total).toBeCloseTo((flower.directCoef * 100 + flower.directFlat!) * 1.5);
    expect(sim.cardDraws.flowerThorn).toBe(0);
  });
  it('rolls critical damage independently for both basic hits and the thorn', () => {
    const { flower, rng, sim } = controlled(0);
    flower.mods = [{ bucket: 'critRate', value: 0.5, source: 'probe' }];
    const results = [true, false, true];
    vi.spyOn(rng, 'chance').mockImplementation(p => p === 0.5 ? results.shift()! : false);
    sim.cast(flower, 2);
    const values = flower.hitSequence!.hits.map(h => h.directCoef * 100 + h.directFlat);
    expect(sim.total).toBeCloseTo(values[0]! * 2 + values[1]! + values[2]! * 2);
    expect(results).toHaveLength(0);
  });
  it('keeps first-cast effects and Emperor Heart separate from the three hits', () => {
    const { build, flower, sim } = controlled(0);
    build.emperorHeartChance = 1;
    const destiny = vi.spyOn(sim, 'triggerDestiny');
    flower.onCast = [{ id: 'cast_probe', duration: 10, maxStacks: 6,
      mod: { bucket: 'atk', value: 0.01, source: 'probe' } }];
    const apply = vi.spyOn(sim, 'applyBuff'); sim.cast(flower, 2);
    expect(destiny).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls.filter(([effect]) => effect.id === 'cast_probe')).toHaveLength(1);
  });
  it('does not use the fast-return model to claim measured timing', () => {
    const result = buildFromArmory(input());
    expect(result.warnings.some(w => w.includes('플라워 14P 빠른 복귀') && w.includes('기존 시전 종료') && w.includes('실측 미검증'))).toBe(true);
  });
});
