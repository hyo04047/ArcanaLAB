import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers, rollHit } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { resolveSkillDamage, SKILL_BY_ID } from '../skilldata';
import type { SkillDef } from '../types';

const reference = [
  ['return', 1005.5, [5.481, 6.696, 9.286]],
  ['mysterious_stampede', 1042.5, [5.673, 6.932, 9.614]],
  ['dancing_of_spineflower', 2458.5, [13.42, 16.406, 22.754]],
] as const;
describe('Emperor basic damage normalization', () => {
  it.each(reference)('keeps flat damage separate while choosing AP levels: %s', (id, flat, coefficients) => {
    for (const [index, level] of [10, 14, 20].entries()) {
      const d = resolveSkillDamage(SKILL_BY_ID.get(id)!, level);
      expect(d.directFlat).toBe(flat); expect(d.directCoef).toBeCloseTo(coefficients[index]!);
      expect(d.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level });
    }
  });
  it.each(reference)('scales only the AP term and applies total damage once: %s', (id, flat, coefficients) => {
    const d = resolveSkillDamage(SKILL_BY_ID.get(id)!, 14);
    const skill: SkillDef = { id, name: id, kind: 'normal', cooldown: 1, castTime: 0, hits: id === 'dancing_of_spineflower' ? 7 : 2, ...d };
    const context = { skill, stacks: 0, component: 'direct' as const };
    const hit = (ap: number) => rollHit(createRng(1), d.directCoef, computeMultipliers({ atkBase: ap }, [], context), d.directFlat).dmg;
    expect(hit(0)).toBe(flat); expect(hit(20000) - hit(10000)).toBeCloseTo(coefficients[1] * 10000);
    const base = empressInkomsu440();
    const sim = new SimState({ ...base, skills: [skill], passiveMods: [], bluntThorn: undefined, onCardUse: [], onDestiny: [],
      params: { ...base.params, atkBase: 10000 } }, createRng(1), []);
    sim.cast(skill, 1); expect(sim.breakdown.get(id)!.direct).toBeCloseTo(flat + coefficients[1] * 10000);
  });
  it('does not include conditional third attacks or the teleport thorn in the basic sum', () => {
    expect(resolveSkillDamage(SKILL_BY_ID.get('return')!, 10).damageReference).toMatchObject({ source: 'public-coefficient-candidate', effectIds: [192600, 192601] });
    expect(resolveSkillDamage(SKILL_BY_ID.get('mysterious_stampede')!, 10).damageReference).toMatchObject({ source: 'public-coefficient-candidate', effectIds: [192101, 192103] });
    expect(resolveSkillDamage(SKILL_BY_ID.get('dancing_of_spineflower')!, 10).damageReference).toMatchObject({ source: 'public-coefficient-candidate', effectIds: [192000, 192007, 192008, 192009] });
  });
  it('uses actual API skill levels and keeps Fake Flip without 14P explicitly unresolved', () => {
    const r = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
    const raw: RawArmory = { profiles: r.profiles.data, combatSkills: r['combat-skills'].data, arkpassive: r.arkpassive.data,
      arkgrid: r.arkgrid.data, engravings: r.engravings.data, gems: r.gems.data };
    raw.arkgrid!.Slots.find(s => s.Name.endsWith('셔플 댄스'))!.Point = 13;
    const { build, warnings } = buildFromArmory(raw);
    expect(build.skills.find(s => s.id === 'return')?.directCoef).toBeCloseTo(2.576); // 검색 운용은 시너지용 첫 입력입니다.
    expect(build.skills.find(s => s.id === 'mysterious_stampede')?.directCoef).toBeCloseTo(5.673);
    expect(build.skills.find(s => s.id === 'dancing_of_spineflower')?.directCoef).toBeCloseTo(16.406);
    expect(warnings.some(w => w.includes('페이크 플립') && w.includes('가시') && w.includes('미반영'))).toBe(true);
    expect(warnings.some(w => w.includes('플라워 Lv14') && w.includes('Lv10 대체'))).toBe(false);
  });
});
