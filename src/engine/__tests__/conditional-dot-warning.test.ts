import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { damageWarnings } from '../skilldata';
import type { Modifier } from '../types';

function input() {
  const record = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[0];
  const raw = Object.fromEntries(record.responses.map((r: { endpoint: string; body: string }) =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as unknown as RawArmory;
  return buildFromArmory(raw);
}

describe('conditional damage exclusions in DOT warnings', () => {
  it('reports the real Stack Hold exclusion for the imported poison skill without changing damage', () => {
    const { build, warnings } = input();
    const mods = build.passiveMods.filter(mod => mod.source === '스택 홀드 17P');
    expect(mods).toHaveLength(1);
    const poisons = build.skills.filter(skill => skill.manaPoison || skill.fearOfDeath);
    expect(poisons).toHaveLength(1);
    for (const skill of poisons) {
      const name = skill.manaPoison ? '마나 중독' : '죽음의 공포';
      expect(warnings.some(warning => warning.startsWith(`${name} 적용 미확인`) && warning.includes('스택 홀드 17P'))).toBe(true);
      for (const stacks of [0, 1, 4]) {
        const dot = computeMultipliers({ atkBase: 100 }, mods, { skill, stacks, component: 'dot' });
        const direct = computeMultipliers({ atkBase: 100 }, mods, { skill, stacks, component: 'direct' });
        expect(dot.skillDmg).toBe(1);
        expect(direct.skillDmg).toBe(stacks === 0 ? 1 : 1 + mods[0]!.value);
      }
    }
  });

  it.each([[0, true], [1, true], [4, true], [5, false]] as const)('checks whether stack threshold %s can occur', (minStacks, warned) => {
    const { build } = input();
    build.passiveMods = [{ bucket: 'skillDmg', value: 0.1, source: '조건부 통제', filter: { minStacks } }];
    expect(damageWarnings(build).some(warning => warning.includes('조건부 통제'))).toBe(warned);
  });

  it.each([
    { dotScope: 'include' }, { dotScope: 'exclude' }, { filter: { component: 'dot' } },
    { filter: { component: 'direct' } }, { filter: { ids: ['celestial_rain'] } },
  ] satisfies Partial<Modifier>[])('does not label explicit or unrelated scopes as unknown: %j', scope => {
    const { build } = input();
    build.passiveMods = [{ bucket: 'skillDmg', value: 0.1, source: '범위 통제', ...scope }];
    expect(damageWarnings(build).some(warning => warning.includes('범위 통제'))).toBe(false);
  });
});
