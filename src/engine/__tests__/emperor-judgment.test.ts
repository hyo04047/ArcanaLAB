import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { damageWarnings } from '../skilldata';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const effects = load('tests/fixtures/audit/2026-10-13-sun-nodes-details.json').official.data.Effects;
const node = effects.find((e: { Description: string }) => e.Description.includes('황제의 심판'));
const another = effects.find((e: { Description: string }) => e.Description.includes('또 다른 황제'));
function input(nodes = [node]): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [],
    arkpassive: { Effects: nodes }, arkgrid: null, engravings: null, gems: null };
}
const probe: SkillDef = { id: 'test', name: '통제 스킬', kind: 'normal', directCoef: 1, hits: 1, cooldown: 0, castTime: 0 };

describe('Emperor Judgment side-node scope', () => {
  it.each([
    ['normal', undefined, 1.02], ['stack', undefined, 1.02], ['ruin', undefined, 0.98],
    ['hyper_awakening', ['normal'], 1.02], ['hyper_awakening', ['ruin'], 0.98],
    ['hyper_awakening', undefined, 1], ['awakening', undefined, 1], ['identity_card', undefined, 1],
  ] as const)('applies the live level 1 tooltip to %s with tags %s', (kind, tags, expected) => {
    const { build, warnings } = buildFromArmory(input());
    const mods = build.passiveMods.filter(m => m.source.startsWith('황제의 심판'));
    expect(mods).toHaveLength(2);
    const skill: SkillDef = { ...probe, kind, tags: tags ? [...tags] : undefined };
    expect(computeMultipliers({ atkBase: 100 }, mods, { skill, stacks: 4, component: 'direct' }).nonCrit).toBeCloseTo(expected);
    expect(warnings.some(w => w.includes('황제의 심판') && w.includes('해석 못함'))).toBe(false);
  });
  it('reduces both direct and stack explosion damage without requiring four stacks', () => {
    const mods = buildFromArmory(input()).build.passiveMods.filter(m => m.source.startsWith('황제의 심판'));
    for (const stacks of [0, 2, 4]) for (const component of ['direct', 'stack'] as const) {
      expect(computeMultipliers({ atkBase: 100 }, mods, { skill: { ...probe, kind: 'ruin' }, stacks, component }).nonCrit).toBe(0.98);
    }
  });
  it('keeps Another Emperor global damage separate and does not duplicate the side node', () => {
    const mods = buildFromArmory(input([node, another])).build.passiveMods.filter(m => /황제의 심판|또 다른 황제/.test(m.source));
    expect(computeMultipliers({ atkBase: 100 }, mods, { skill: probe, stacks: 0, component: 'direct' }).nonCrit).toBeCloseTo(1.02 * 1.16);
    expect(computeMultipliers({ atkBase: 100 }, mods, { skill: { ...probe, kind: 'identity_card' }, stacks: 0, component: 'direct' }).nonCrit).toBe(1.16);
  });
  it('reads independent supplied percentages rather than deriving them from level', () => {
    const n = structuredClone(node);
    n.ToolTip = JSON.stringify({ value: '루인 스킬의 피해량이 3.0% 감소하지만, 스택트 스킬과 일반스킬이 적에게 주는 피해가 7.0% 증가한다.' });
    const mods = buildFromArmory(input([n])).build.passiveMods.filter(m => m.source.startsWith('황제의 심판'));
    expect(computeMultipliers({ atkBase: 100 }, mods, { skill: probe, stacks: 0, component: 'direct' }).nonCrit).toBe(1.07);
    expect(computeMultipliers({ atkBase: 100 }, mods, { skill: { ...probe, kind: 'ruin' }, stacks: 4, component: 'stack' }).nonCrit).toBe(0.97);
  });
  it.each(['', '적중 시 '])('warns for missing or newly conditional effect text %s', condition => {
    const n = structuredClone(node);
    n.ToolTip = condition ? n.ToolTip.replace('루인 스킬의', condition + '루인 스킬의') : undefined;
    const { build, warnings } = buildFromArmory(input([n]));
    expect(build.passiveMods.some(m => m.source.startsWith('황제의 심판'))).toBe(false);
    expect(warnings.some(w => w.includes('황제의 심판') && w.includes('해석 못함'))).toBe(true);
  });
  it('retains the unknown DOT scope warning instead of inferring it from damage wording', () => {
    const build = buildFromArmory(input()).build;
    const skill: SkillDef = { ...probe, id: 'evoke', manaPoison: { coef: 1, flat: 0, duration: 3, maxStacks: 3, firstTick: 0.5, interval: 1 } };
    build.skills = [skill];
    const mods = build.passiveMods.filter(m => m.source.startsWith('황제의 심판'));
    expect(computeMultipliers({ atkBase: 100 }, mods, { skill, stacks: 0, component: 'dot' }).nonCrit).toBe(1);
    expect(damageWarnings(build).some(w => w.includes('마나 중독 적용 미확인') && w.includes('황제의 심판'))).toBe(true);
  });
});
