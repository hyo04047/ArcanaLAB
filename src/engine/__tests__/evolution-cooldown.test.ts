import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { damageWarnings } from '../skilldata';
import type { Modifier, SkillDef } from '../types';

type Grouped = Modifier & { cooldownGroup: 'manaEvolution' | 'nonAwakeningEvolution' };
const mana = (value: number): Grouped => ({ bucket: 'cooldown', value, filter: { usesMana: true },
  cooldownGroup: 'manaEvolution', source: 'mana test' });
const ordinary = (value: number): Grouped => ({ bucket: 'cooldown', value, filter: { excludeKinds: ['awakening'] },
  cooldownGroup: 'nonAwakeningEvolution', source: 'ordinary test' });
const target: SkillDef = { id: 'test', name: '통제', kind: 'normal', usesMana: true, cooldown: 100,
  castTime: 0, hits: 1, directCoef: 0 };
function state(mods: Modifier[], skill = target) {
  const build = empressInkomsu440();
  return new SimState({ ...build, skills: [skill], passiveMods: mods, onCardUse: [], onDestiny: [], onRuinAt4: [] }, createRng(1), []);
}
const load = (name: string) => JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/' + name + '.json', 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'), arkpassive: load('arkpassive'),
  arkgrid: null, engravings: null, gems: null };

describe('Evolution cooldown groups', () => {
  it.each([[0.07, 0.07], [0.07, 0.14], [0.14, 0.14]])('adds mana nodes %s and %s', (a, b) => {
    expect(state([mana(a), mana(b)]).cooldownMultiplier(target)).toBeCloseTo(1 - a - b);
  });
  it.each([[0.04, 0.05], [0.08, 0.1]])('adds non-awakening nodes %s and %s', (a, b) => {
    expect(state([ordinary(a), ordinary(b)]).cooldownMultiplier(target)).toBeCloseTo(1 - a - b);
  });
  it('multiplies the two groups and independent reductions', () => {
    const mods = [mana(0.14), mana(0.14), ordinary(0.08), ordinary(0.1),
      { bucket: 'cooldown', value: 0.2, source: 'swift control' } as Modifier,
      { bucket: 'cooldown', value: 0.15, source: 'judgment control' } as Modifier];
    expect(state(mods).cooldownMultiplier(target)).toBeCloseTo(0.72 * 0.82 * 0.8 * 0.85);
    expect(state([...mods].reverse()).cooldownMultiplier(target)).toBeCloseTo(0.72 * 0.82 * 0.8 * 0.85);
  });
  it.each([false, undefined])('filters mana use %s before aggregation', usesMana => {
    expect(state([mana(0.14), mana(0.14), ordinary(0.04)]).cooldownMultiplier({ ...target, usesMana })).toBeCloseTo(0.96);
  });
  it('excludes awakening and includes a confirmed mana T skill', () => {
    const s = state([mana(0.14), mana(0.14), ordinary(0.04)]);
    expect(s.cooldownMultiplier({ ...target, kind: 'awakening', usesMana: false })).toBe(1);
    expect(s.cooldownMultiplier({ ...target, kind: 'hyper_awakening', tags: ['normal'] })).toBeCloseTo(0.72 * 0.96);
  });
  it('honors IDs even for a grouped modifier', () => {
    const second = mana(0.14); second.filter = { ids: ['other'], usesMana: true };
    expect(state([mana(0.14), second]).cooldownMultiplier(target)).toBeCloseTo(0.86);
  });
  it('keeps old ungrouped modifiers multiplicative without inferring groups from names', () => {
    expect(state([{ bucket: 'cooldown', value: 0.14, source: '끝없는 마나 Lv2' },
      { bucket: 'cooldown', value: 0.14, source: '무한한 마력 Lv2' }]).cooldownMultiplier(target)).toBeCloseTo(0.86 * 0.86);
  });
  it('sets explicit groups in imported and reference inputs', () => {
    for (const build of [buildFromArmory(raw).build, empressInkomsu440()]) {
      const mods = build.passiveMods.filter(m => m.bucket === 'cooldown' && /^(끝없는 마나|무한한 마력|최적화 훈련)/.test(m.source));
      expect(mods).toHaveLength(3);
      expect(state(mods).cooldownMultiplier(target)).toBeCloseTo(0.72 * 0.96);
    }
  });
  it('groups imported timing mastery with optimized training', () => {
    const input = structuredClone(raw);
    input.arkpassive!.Effects = input.arkpassive!.Effects.filter(e => e.Description.includes('최적화 훈련'));
    input.arkpassive!.Effects.push({ Name: '진화', Description: '진화 3티어 타이밍 지배 Lv.2', ToolTip: JSON.stringify({value:
      '각성기, 이동 및 기상기를 제외한 스킬의 재사용 대기시간이 10.0% 감소하고, 진화형 피해가 16.0% 증가합니다.' }) });
    const mods = buildFromArmory(input).build.passiveMods.filter(m => m.bucket === 'cooldown' && /^(최적화 훈련|타이밍 지배)/.test(m.source));
    expect(state(mods).cooldownMultiplier(target)).toBeCloseTo(0.86);
  });
  it('starts ordinary cooldown with the grouped result then reduces only remaining time', () => {
    const s = state([mana(0.14), mana(0.14), ordinary(0.04)]); s.cast(target, 200);
    expect(s.readyAt.get('test')).toBeCloseTo(69.12);
    s.advanceTo(10); s.reduceAllCooldowns(0.5);
    expect(s.readyAt.get('test')).toBeCloseTo(39.56);
  });
  it('uses the grouped result for serial charge recharge', () => {
    const skill = { ...target, maxCharges: 2 }, s = state([mana(0.14), mana(0.14)], skill);
    s.cast(skill, 200); s.cast(skill, 200); expect(s.readyAt.get('test')).toBeCloseTo(72);
    s.advanceTo(72); expect(s.readyAt.get('test')).toBeCloseTo(144);
  });
  it('reads grouped modifiers at Evoke followup without moving the cooldown start', () => {
    const skill = { ...target, id: 'evoke', castTime: 1, splitEvoke: { duration: 1, placementAt: 0.25, delay: 2, window: 3 } };
    const s = state([mana(0.14), mana(0.14)], skill); s.cast(skill, 200);
    expect(s.readyAt.has('evoke')).toBe(false); s.advanceTo(2); s.cast(skill, 200);
    expect(s.readyAt.get('evoke')).toBeCloseTo(74);
  });
  it('keeps candidate and legacy-input limitations visible', () => {
    const b = buildFromArmory(raw).build;
    expect(damageWarnings(b).some(w => w.includes('진화 쿨감') && w.includes('실측 미검증'))).toBe(true);
    const old = structuredClone(b);
    for (const mod of old.passiveMods) delete (mod as Partial<Grouped>).cooldownGroup;
    expect(damageWarnings(old).some(w => w.includes('진화 쿨감') && w.includes('기존 곱연산'))).toBe(true);
  });
});
