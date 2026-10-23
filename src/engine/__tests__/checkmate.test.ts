import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { resolveSkillDamage, SKILL_BY_ID } from '../skilldata';
import { createRng } from '../rng';
import { SimState } from '../sim';
const evidence = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-damage-sources.json', 'utf8'));
const source = evidence.official.data.find((s: { Name: string }) => s.Name === '체크메이트');
function input(names: string[] = []): RawArmory {
  return { profiles: JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8')),
    combatSkills: [{ ...source, Level: 14, Rune: null, Tripods: source.Tripods.map((t: { Name: string }) => ({ ...t, IsSelected: names.includes(t.Name) })) }],
    arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
describe('Checkmate basic damage and unresolved holding tripods', () => {
  it('sums the four three-hit groups without treating tooltip damage as an AP coefficient', () => {
    const r = buildFromArmory(input()); const s = r.build.skills[0]!;
    expect(s.directCoef).toBeCloseTo(28.596, 12); expect(s.directFlat).toBe(4242); expect(s.hits).toBe(12);
    expect(s.kind).toBe('stack'); expect(s.stacksGranted).toBe(3);
    expect(s.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level: 14, effectIds: [190401, 190411, 190413, 190415] });
    expect(s.hitSequence).toBeUndefined(); expect(s.delayedHits).toBeUndefined();
    expect(r.warnings.some(w => w.includes('홀딩·해제·후딜'))).toBe(true);
    expect(r.warnings.some(w => w.includes('시전 시작에 쿨을 등록') && w.includes('홀딩 중 환희 적용은 미검증'))).toBe(true);
  });
  it.each([1, 10, 14, 20])('preserves actual level %s and weights both base terms', level => {
    const s = resolveSkillDamage(SKILL_BY_ID.get('checkmate')!, level);
    const e = evidence.publicRows.skills.data.find((s: { gameSkillId: number }) => s.gameSkillId === 19040).damage.tooltip_effects[0];
    expect(s.directCoef).toBeCloseTo(e.ap_coeff_by_level[level - 1] * 12, 12);
    expect(s.directFlat).toBe((e.flat_min_by_level[level - 1] + e.flat_max_by_level[level - 1]) / 2 * 12);
  });
  it.each(['꿰뚫는 일격', '집중된 어둠', '썬더 메이트', '데드라인', '카드의 파도'])('does not apply unresolved %s as a flat full-skill bonus', name => {
    const r = buildFromArmory(input([name])); const s = r.build.skills[0]!;
    expect(s.mods).toEqual([]); expect(s.defenseIgnore).toBeUndefined(); expect(s.hits).toBe(12);
    expect(s.directCoef).toBeCloseTo(28.596, 12);
    expect(r.warnings.some(w => w.includes(name) && w.includes('미반영'))).toBe(true);
  });
  it('retains isolated crit rate and boss damage conversion', () => {
    const s = buildFromArmory(input(['급소 타격', '약점 포착'])).build.skills[0]!;
    const m = computeMultipliers({ atkBase: 100 }, s.mods!, { skill: s, stacks: 0, component: 'direct' });
    expect(m.critRate).toBeCloseTo(0.4, 12); expect(m.skillDmg).toBeCloseTo(1.8, 12);
  });
  it('parses the official 3-to-4 card increase with the 로 suffix', () => {
    const { build, warnings } = buildFromArmory(input(['카드 증가']));
    expect(build.skills[0]!.stacksGranted).toBe(4);
    expect(warnings.some(w => w.includes('카드 증가') && w.includes('해석 못함'))).toBe(false);
  });
  it.each([0, 100, 1000])('keeps fixed damage independent of attack %s', atk => {
    const { build } = buildFromArmory(input()); build.passiveMods = []; build.bluntThorn = undefined;
    build.params.atkBase = atk; build.params.gaugePerHit.stack = 0;
    const sim = new SimState(build, createRng(1), []); sim.cast(build.skills[0]!, 10);
    expect(sim.total).toBeCloseTo(4242 + 28.596 * atk, 8); expect(sim.stacks).toBe(3);
  });
  it('labels unsupported levels as fallback rather than reusing Lv20', () => {
    expect(resolveSkillDamage(SKILL_BY_ID.get('checkmate')!, 21).damageReference).toMatchObject({ source: 'codex-tooltip', level: 10 });
  });
});
