import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { damageWarnings } from '../skilldata';
import { strip } from '../tooltip';
import type { SkillDef } from '../types';

const raw: RawArmory = { profiles: JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8')),
  combatSkills: [], arkpassive: null, arkgrid: null, engravings: null, gems: null };
type Engraving = NonNullable<NonNullable<RawArmory['engravings']>['ArkPassiveEffects']>[number];
const sources = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-remaining-engraving-sources.json', 'utf8'));
const samples: { character: string; effect: Engraving }[] = sources.records.flatMap((r: { character: string; body: string }) =>
  JSON.parse(r.body).ArkPassiveEffects.filter((e: Engraving) => ['예리한 둔기', '마나 효율 증가'].includes(e.Name))
    .map((effect: Engraving) => ({ character: r.character, effect })));
const convert = (effect: Engraving) => buildFromArmory({ ...raw, engravings: { ArkPassiveEffects: [effect] } });

describe.each(samples)('$character $effect.Name official description', ({ effect }) => {
  it('applies the official value and explicitly identifies unverified mechanics', () => {
    const { build, warnings } = convert(effect);
    const mods = build.passiveMods.filter(m => m.source.startsWith(effect.Name));
    expect(mods.map(m => [m.bucket, m.value])).toEqual(effect.Name === '마나 효율 증가'
      ? [['skillDmg', 0.1975]] : [['critDmg', effect.AbilityStoneLevel === 2 ? 0.614 : 0.52], ['dmgToEnemy', -0.02]]);
    expect(warnings.some(w => w.includes(effect.Name) && w.includes('각인 해석 못함'))).toBe(false);
    if (effect.Name === '예리한 둔기') {
      expect(warnings.some(w => w.includes('예리한 둔기') && w.includes('10% 가정'))).toBe(true);
      expect(damageWarnings(build).some(w => w.includes('예리한 둔기') && w.includes('10% 가정'))).toBe(true);
    }
  });

  it.each(['missing', 'prefix', 'suffix', 'missing clause', 'invalid number', 'reversed'])(
    'rejects %s without adding a partial bonus or penalty', change => {
      const value = structuredClone(effect), text = strip(effect.Description);
      if (change === 'missing') value.Description = '';
      if (change === 'prefix') value.Description = '생명력이 절반 이상일 때 ' + text;
      if (change === 'suffix') value.Description = text + ' 추가 조건을 만족해야 한다.';
      if (change === 'missing clause') value.Description = text.split(', ')[1]!;
      if (change === 'invalid number') value.Description = text.replace(/[\d.]+%/, '1.2.3%');
      if (change === 'reversed') value.Description = text.replace('증가', '감소');
      const { build, warnings } = convert(value);
      expect(build.passiveMods.some(m => m.source.startsWith(effect.Name))).toBe(false);
      expect(warnings.some(w => w.includes(effect.Name) && w.includes('각인 해석 못함'))).toBe(true);
    });
});

it('keeps MP Efficiency limited to skills confirmed to use mana', () => {
  const { build } = convert(samples.find(s => s.effect.Name === '마나 효율 증가')!.effect);
  const skill: SkillDef = { id: 'synthetic', name: '통제 스킬', kind: 'normal', cooldown: 1, castTime: 0,
    hits: 1, directCoef: 1 };
  for (const usesMana of [true, false, undefined]) {
    const mult = computeMultipliers({ atkBase: 100 }, build.passiveMods.filter(m => m.source.startsWith('마나 효율 증가')),
      { skill: { ...skill, usesMana }, component: 'direct', stacks: 0 });
    expect(mult.skillDmg).toBe(usesMana ? 1.1975 : 1);
  }
});

it('does not keep a fixed two-percent penalty for a different unsupported penalty amount', () => {
  const value = structuredClone(samples.find(s => s.effect.Name === '예리한 둔기')!.effect);
  value.Description = strip(value.Description).replace('20.00% 감소', '30.00% 감소');
  expect(convert(value).build.passiveMods.some(m => m.source.startsWith('예리한 둔기'))).toBe(false);
});
