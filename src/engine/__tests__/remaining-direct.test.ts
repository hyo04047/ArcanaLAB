import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers, rollHit } from '../damage';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { resolveSkillDamage, SKILL_BY_ID } from '../skilldata';
import type { SkillDef } from '../types';

const cases = [
  ['quadra_accelerate', '쿼드라 엑셀레이트', 4, [4.216, 5.48, 6.696, 9.28], [254, 1008, 1008, 1008], [191701, 191702]],
  ['back_flush', '백 플러쉬', 1, [3.015, 3.921, 4.791, 6.643], [181, 721, 721, 721], [192301]],
] as const;

describe('remaining basic direct damage candidates', () => {
  for (const [id, name, hits, coefficients, flats, effectIds] of cases) {
    it(`${id} selects the requested level and excludes conditional extra hits`, () => {
      for (const [index, level] of [1, 10, 14, 20].entries()) {
        const damage = resolveSkillDamage(SKILL_BY_ID.get(id)!, level);
        expect(damage.directCoef).toBeCloseTo(coefficients[index]!);
        expect(damage.directFlat).toBe(flats[index]);
        expect(damage.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level, effectIds });
      }
    });
    it(`${id} scales only AP and does not multiply the total by its hit count again`, () => {
      const damage = resolveSkillDamage(SKILL_BY_ID.get(id)!, 10);
      const skill: SkillDef = { id, name, kind: 'stack', cooldown: 1, castTime: 0, hits, ...damage };
      const context = { skill, stacks: 0, component: 'direct' as const };
      for (const atkBase of [0, 10000, 20000]) {
        const expected = flats[1] + coefficients[1] * atkBase;
        expect(rollHit(createRng(1), skill.directCoef, computeMultipliers({ atkBase }, [], context), skill.directFlat).dmg).toBeCloseTo(expected);
        const base = empressInkomsu440();
        const sim = new SimState({ ...base, skills: [skill], passiveMods: [], bluntThorn: undefined, onCardUse: [], onDestiny: [],
          params: { ...base.params, atkBase } }, createRng(1), []);
        sim.cast(skill, 1);
        expect(sim.breakdown.get(id)!.direct).toBeCloseTo(expected);
      }
    });
    it(`${id} retains the explicit fallback outside the candidate array`, () => {
      const damage = resolveSkillDamage(SKILL_BY_ID.get(id)!, 21);
      expect(damage.level).toBe(21);
      expect(damage.damageReference).toEqual({ source: 'codex-tooltip', level: 10 });
    });
    it(`${id} connects level 14 through an actual armory conversion`, () => {
      const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records;
      const raw = Object.fromEntries(records[1].responses.map((r: { endpoint: string; body: string }) =>
        [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
      const skill = raw.combatSkills.find(s => s.Name === name)!;
      skill.Level = 14; skill.Tripods = []; skill.Rune = null;
      const { build, warnings } = buildFromArmory({ ...raw, combatSkills: [skill] });
      expect(build.skills[0]?.directCoef).toBeCloseTo(coefficients[2]);
      expect(build.skills[0]?.directFlat).toBe(flats[2]);
      expect(warnings.some(w => w.includes(name) && w.includes('공개 자료 후보'))).toBe(true);
    });
  }
});
