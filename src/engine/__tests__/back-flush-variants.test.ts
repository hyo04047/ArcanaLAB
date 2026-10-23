import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { defaultRotation } from '../rotation';
import { SimState } from '../sim';
import { strip } from '../tooltip';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records as
  { responses: { endpoint: string; body: string }[] }[];
function convert(name: string, description?: string, index = 1, selected = true) {
  const raw = Object.fromEntries(records[index]!.responses.map(r =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === '백 플러쉬')!;
  const tripod = skill.Tripods!.find(t => t.Name === name)!;
  skill.Level = 10; skill.Rune = null;
  skill.Tripods = [{ ...tripod, IsSelected: selected, Tooltip: description ?? tripod.Tooltip }];
  const result = buildFromArmory({ ...raw, combatSkills: [skill], arkpassive: null, arkgrid: null,
    engravings: null, gems: null, equipment: null, cards: null });
  return { ...result, text: strip(tripod.Tooltip) };
}

describe('Back Flush variants', () => {
  it.each(['emperor', 'empress'] as const)('keeps normal Back Flush reachable for %s', variant => {
    const skill = convert('페이크 플립').build.skills[0]!;
    const rotation = defaultRotation(variant, [skill]);
    expect(rotation.fillers).toContain(skill.id);
    expect(rotation.stackPriority).not.toContain(skill.id);
  });
  it.each([0, 1])('converts official Fake Flip %s to normal with no stack generation', index => {
    const { build } = convert('페이크 플립', undefined, index), skill = build.skills[0]!;
    expect(skill.kind).toBe('normal'); expect(skill.stacksGranted).toBe(0);
    expect(build.rotation.stackPriority).not.toContain(skill.id);
    expect(build.rotation.fillers).toContain(skill.id);
    expect(computeMultipliers({ atkBase: 100 }, skill.mods!, { skill, component: 'direct', stacks: 0 }).nonCrit).toBe(1.45);
  });
  it('uses normal filters and gauge without generating stacks', () => {
    const { build } = convert('페이크 플립'), skill = build.skills[0]!;
    build.passiveMods = [{ bucket: 'skillDmg', value: 0.5, filter: { kinds: ['normal'] }, source: 'scope control' }];
    build.params.gaugeGainBonus = 0; build.params.normalGaugePenalty = 0;
    build.params.gaugePerHit = { normal: 0.1, stack: 0.01, ruin: 0, awakening: 0, hyper_awakening: 0 };
    expect(computeMultipliers({ atkBase: 100 }, build.passiveMods, { skill, component: 'direct', stacks: 0 }).nonCrit).toBe(1.5);
    const sim = new SimState(build, createRng(42), cardsFor('emperor'));
    sim.cast(skill, 100);
    expect(sim.stacks).toBe(0); expect(sim.deck.gauge).toBeCloseTo(skill.hits * 0.1);
  });
  it.each([0, 1])('stores two uses in official Double Flush %s', index => {
    const result = convert('더블 플러쉬', undefined, index), skill = result.build.skills[0]!;
    expect(skill.maxCharges).toBe(2);
    expect(result.warnings.some(w => w.includes('백 플러쉬 더블 플러쉬') && w.includes('실측 미검증'))).toBe(true);
    const sim = new SimState(result.build, createRng(42), cardsFor('empress'));
    sim.cast(skill, 100); const firstReady = sim.readyAt.get(skill.id)!;
    expect(sim.isReady(skill.id)).toBe(true);
    sim.cast(skill, 100);
    expect(sim.isReady(skill.id)).toBe(false); expect(sim.readyAt.get(skill.id)).toBe(firstReady);
    sim.advanceTo(firstReady);
    expect(sim.isReady(skill.id)).toBe(true);
    sim.cast(skill, 100);
    expect(sim.isReady(skill.id)).toBe(false);
  });
  for (const name of ['페이크 플립', '더블 플러쉬']) {
    const text = convert(name).text;
    const base = convert(name, undefined, 1, false).build.skills[0]!;
    it(`${name} leaves unselected effects disabled`, () => {
      expect(base.kind).toBe('stack'); expect(base.maxCharges).toBeUndefined();
      expect(base.mods!.some(m => m.source === name)).toBe(false);
    });
    it.each([
      '', '특정 버프가 있을 때만 ' + text, text + ' 마나가 50% 이상인 경우에만 적용된다.',
      name === '페이크 플립' ? text.replace('[일반 스킬]', '[루인 스킬]') : text.replace('2회', '3회'),
    ])(`${name} rejects altered conditions: %s`, changed => {
      const result = convert(name, changed);
      expect(result.build.skills[0]).toEqual(base);
      expect(result.warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
  }
  it.each(['1.2.3', '9'.repeat(400), '-1'])('rejects invalid Fake Flip damage %s', invalid => {
    const result = convert('페이크 플립', convert('페이크 플립').text.replace('45.0', invalid));
    expect(result.build.skills[0]).toEqual(convert('페이크 플립', undefined, 1, false).build.skills[0]);
  });
  it('allows a damage increase over 100 percent', () => {
    const skill = convert('페이크 플립', convert('페이크 플립').text.replace('45.0', '150')).build.skills[0]!;
    expect(skill.kind).toBe('normal'); expect(skill.mods!.some(m => m.source === '페이크 플립' && m.value === 1.5)).toBe(true);
  });
});
