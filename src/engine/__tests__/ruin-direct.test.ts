import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { damageWarnings, resolveSkillDamage, SKILL_BY_ID } from '../skilldata';
import { SimState } from '../sim';
import type { Build, SkillDef } from '../types';

const dir = resolve(__dirname, '../../../tests/fixtures/armory/FixtureCharacter26');
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, name + '.json'), 'utf8'));
const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'), arkpassive: load('arkpassive'), arkgrid: load('arkgrid'), engravings: load('engravings'), gems: load('gems') };
const builds = [empressInkomsu440(), buildFromArmory(raw).build];
const cases = [
  ['secret_garden', 1, 75.5, 1.26, 12675.5], ['secret_garden', 10, 299, 1.636, 16659], ['secret_garden', 14, 299, 2, 20299],
  ['four_of_a_kind', 1, 160, 2.67, 26860], ['four_of_a_kind', 10, 636.5, 3.472, 35356.5], ['four_of_a_kind', 14, 636.5, 4.243, 43066.5],
  ['serendipity', 1, 182.5, 3.03, 30482.5], ['serendipity', 10, 724.5, 3.941, 40134.5], ['serendipity', 14, 724.5, 4.816, 48884.5],
  ['the_devil', 1, 4215.5, 70.245, 706665.5],
] as const;

function clean(build: Build, id: string): SkillDef {
  const source = build.skills.find(s => s.id === id)!;
  return { ...source, ...resolveSkillDamage(SKILL_BY_ID.get(id)!, source.level!), mods: [], onCast: [], procCritDmg: undefined, defenseIgnore: undefined };
}
function hit(build: Build, skill: SkillDef, attackPower = 10000, stacks = 0) {
  const s = new SimState({ ...build, skills: [skill], passiveMods: [], bluntThorn: undefined, onRuinAt4: [],
    params: { ...build.params, atkBase: attackPower } }, createRng(1), []);
  s.stacks = stacks;
  s.cast(skill, 10, 'full');
  return s.breakdown.get(skill.id)!;
}

describe('four ruin base direct damage candidates', () => {
  it.each(cases)('selects and casts %s at skill level %s', (id, level, flat, coef, expected) => {
    const selected = resolveSkillDamage(SKILL_BY_ID.get(id)!, level);
    expect(selected.directFlat).toBe(flat);
    expect(selected.directCoef).toBeCloseTo(coef, 10);
    expect(selected.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level });
    const skill = { ...clean(builds[0]!, id), ...selected };
    expect(hit(builds[0]!, skill).direct).toBeCloseTo(expected, 7);
    expect(hit(builds[0]!, skill, 0).direct).toBe(flat);
    expect(hit(builds[0]!, skill).stackEffect).toBe(0);
  });

  it.each([
    ['secret_garden', 20299], ['four_of_a_kind', 43066.5], ['serendipity', 48884.5], ['the_devil', 706665.5],
  ] as const)('connects %s through preset and armory without changing stack damage', (id, expected) => {
    for (const b of builds) {
      const skill = clean(b, id);
      expect(hit(b, skill).direct).toBeCloseTo(expected, 7);
      const at4 = hit(b, skill, 10000, 4);
      expect(at4.direct).toBeCloseTo(expected, 7);
      expect(at4.stackEffect).toBeCloseTo(id === 'the_devil' ? 2376266.5 : 161320, 7);
    }
  });

  it('retains both Serendipity effect IDs and does not multiply its summed damage by hit count', () => {
    for (const b of builds) {
      const skill = clean(b, 'serendipity');
      expect(skill.damageReference).toMatchObject({ effectIds: [192400, 192401] });
      expect(hit(b, { ...skill, hits: 3 }).direct).toBeCloseTo(48884.5, 7);
    }
  });

  it.each([
    ['secret_garden', 20299, 1], ['four_of_a_kind', 43066.5, 1.75 * 1.36], ['serendipity', 68445.5, 1.22],
  ] as const)('applies equipped direct damage tripods once for %s', (id, base, multiplier) => {
    for (const b of builds) {
      const skill = { ...clean(b, id), ...resolveSkillDamage(SKILL_BY_ID.get(id)!, 14, id === 'serendipity'), mods: b.skills.find(s => s.id === id)!.mods?.filter(m => m.bucket !== 'critRate') };
      expect(hit(b, skill, 10000, 4).direct).toBeCloseTo(base * multiplier, 7);
    }
  });

  it('keeps Devil at actual Lv1 and selects the array row instead of the Lv14 summary', () => {
    for (const b of builds) {
      const skill = clean(b, 'the_devil');
      expect(skill.level).toBe(1);
      expect(skill.directCoef).toBe(70.245);
      expect(skill.directFlat).toBe(4215.5);
      expect(skill.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level: 1, effectIds: [193501] });
    }
  });

  it('uses base Serendipity effects when the total-damage tripod is removed', () => {
    const input = structuredClone(raw);
    input.combatSkills.find(s => s.Name === '세렌디피티')!.Tripods!.forEach(t => { if (t.Name === '연속된 어둠') t.IsSelected = false; });
    const b = buildFromArmory(input).build;
    const skill = b.skills.find(s => s.id === 'serendipity')!;
    expect(skill.mods?.some(m => m.source === '연속된 어둠')).toBe(false);
    expect(hit(b, { ...skill, procCritDmg: undefined, defenseIgnore: undefined }).direct).toBeCloseTo(48884.5, 7);
  });

  it.each([0, 1.5, 21])('retains explicit tooltip fallback at unsupported level %s', level => {
    const selected = resolveSkillDamage(SKILL_BY_ID.get('serendipity')!, level);
    expect(selected.directFlat).toBe(0);
    expect(selected.directCoef).toBe(724);
    expect(selected.damageReference).toEqual({ source: 'codex-tooltip', level: 10 });
  });

  it('keeps candidate warnings and removes obsolete tooltip warnings for the four skills', () => {
    for (const b of builds) {
      const warnings = damageWarnings(b);
      for (const name of ['시크릿 가든', '포 카드', '세렌디피티', '더 데빌']) {
        expect(warnings.some(w => w.startsWith(name) && w.includes('후보') && w.includes('실측'))).toBe(true);
        expect(warnings.some(w => w.startsWith(name) && /대체값|위키 툴팁/.test(w))).toBe(false);
      }
    }
  });
});
