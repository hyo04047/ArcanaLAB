import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import type { SkillDef } from '../types';
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const node = load('tests/fixtures/audit/2026-10-13-sun-nodes-sources.json').official.data.Effects.find((e: { Description: string }) => e.Description.includes('황제의 칙령'));
function input(n = node): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [], arkpassive: { Effects: [n] }, arkgrid: null, engravings: null, gems: null };
}
describe('Emperor Edict damage scope', () => {
  it('uses live level 3 80 percent only for Emperor and leaves missing base damage zero', () => {
    const { build } = buildFromArmory(input());
    const mods = build.passiveMods.filter(m => m.source.startsWith('황제의 칙령'));
    expect(mods).toHaveLength(1);
    for (const id of ['card_emperor', 'card_empress_knight', 'the_sun', 'evoke']) {
      const skill: SkillDef = { id, name: id, kind: 'identity_card', directCoef: 1, hits: 1, cooldown: 0, castTime: 0 };
      expect(computeMultipliers({ atkBase: 100 }, mods, { skill, stacks: 0, component: 'direct' }).skillDmg).toBe(id === 'card_emperor' ? 1.8 : 1);
    }
    expect(build.params.cardDamageCoef).toEqual({});
  });
  it.each([0, 40, 73])('reads supplied percent %s instead of inferring from node level', value => {
    const n = structuredClone(node); n.ToolTip = n.ToolTip.replace('80.0%', `${value}.0%`);
    const { build } = buildFromArmory(input(n));
    expect(build.passiveMods.find(m => m.source.startsWith('황제의 칙령'))!.value).toBe(value / 100);
  });
  it('recognizes the card-addition-only tooltip without inventing damage', () => {
    const n = structuredClone(node); n.ToolTip = JSON.stringify({ value: '카드덱에 황제 카드가 추가된다.' });
    const { build, warnings } = buildFromArmory(input(n));
    expect(build.passiveMods.some(m => m.source.startsWith('황제의 칙령'))).toBe(false);
    expect(warnings.some(w => w.includes('피해 증가 문구 미확인'))).toBe(false);
  });
  it('warns about a missing effect description instead of guessing level 3 damage', () => {
    const n = structuredClone(node); delete n.ToolTip;
    const { build, warnings } = buildFromArmory(input(n));
    expect(build.passiveMods.some(m => m.source.startsWith('황제의 칙령'))).toBe(false);
    expect(warnings.some(w => w.includes('피해 증가 문구 미확인'))).toBe(true);
  });
});
