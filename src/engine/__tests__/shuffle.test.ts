import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { resolveSkillDamage, SKILL_BY_ID } from '../skilldata';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-damage-sources.json', 'utf8')).official.data.find((s: { Name: string }) => s.Name === '언리미티드 셔플');
function input(names: string[] = [], level = 14): RawArmory {
  return { profiles: JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8')),
    combatSkills: [{ ...source, Level: level, Rune: null, Tripods: source.Tripods.map((t: { Name: string }) => ({ ...t, IsSelected: names.includes(t.Name) })) }],
    arkpassive: null, arkgrid: null, engravings: null, gems: null };
}
describe('Shuffle base effects and Dark Core', () => {
  it('weights the six barrage hits and keeps flat damage separate', () => {
    const r = buildFromArmory(input()); const s = r.build.skills[0]!;
    expect(s.directCoef).toBeCloseTo(24.143, 12); expect(s.directFlat).toBe(3609.5); expect(s.hits).toBe(8);
    expect(s.damageReference).toMatchObject({ source: 'public-coefficient-candidate', level: 14, effectIds: [191200, 191202, 191201] });
    expect(s.hitSequence).toBeUndefined(); expect(s.delayedHits).toBeUndefined();
    expect(r.warnings.some(w => w.includes('연타 시각·행동 시간은 임시값'))).toBe(true);
  });
  it.each([1, 10, 14, 20])('uses level-specific base coefficients at Lv%s', level => {
    const raw = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-damage-sources.json', 'utf8')).publicRows.skills.data.find((s: { gameSkillId: number }) => s.gameSkillId === 19120);
    const s = resolveSkillDamage(SKILL_BY_ID.get('unlimited_shuffle')!, level);
    const effects: { hits: number; ap_coeff_by_level: number[]; flat_min_by_level: number[]; flat_max_by_level: number[] }[] = raw.damage.tooltip_effects;
    expect(s.directCoef).toBeCloseTo(effects.reduce((sum, e) => sum + e.hits * e.ap_coeff_by_level[level - 1]!, 0), 12);
    expect(s.directFlat).toBe(effects.reduce((sum, e) => sum + e.hits * (e.flat_min_by_level[level - 1]! + e.flat_max_by_level[level - 1]!) / 2, 0));
  });
  it('reads both official bonuses without creating a crit-rate or global crit-damage buff', () => {
    const s = buildFromArmory(input(['어둠의 핵'])).build.skills[0]!;
    const m = computeMultipliers({ atkBase: 100 }, s.mods!, { skill: s, component: 'direct', stacks: 0 });
    expect(m.skillDmg).toBe(1.35); expect(m.critDmg).toBe(2.42); expect(m.critRate).toBe(0); expect(s.onCast).toEqual([]);
    for (const component of ['dot', 'stack'] as const) {
      const m = computeMultipliers({ atkBase: 100 }, s.mods!, { skill: s, component, stacks: 4 });
      expect(m.skillDmg).toBe(1); expect(m.critDmg).toBe(2);
    }
    const other = computeMultipliers({ atkBase: 100 }, s.mods!, { skill: { ...s, id: 'evoke' }, component: 'direct', stacks: 0 });
    expect(other.skillDmg).toBe(1); expect(other.critDmg).toBe(2);
  });
  it('uses displayed tripod values rather than assuming max rank', () => {
    const raw = input(['어둠의 핵']); raw.combatSkills[0]!.Tripods!.find(t => t.Name === '어둠의 핵')!.Tooltip = '[암] 속성으로 변경된다. 적에게 주는 피해가 15.0% 증가하고, 치명타 피해량이 24.0% 증가한다.';
    expect(buildFromArmory(raw).build.skills[0]!.mods!.map(m => m.value)).toEqual([0.15, 0.24]);
  });
  it('rejects old global-buff or changed conditional descriptions', () => {
    const raw = input(['어둠의 핵']); raw.combatSkills[0]!.Tripods!.find(t => t.Name === '어둠의 핵')!.Tooltip = '[암] 속성으로 변경되고, 치명타 적중률이 15.0% 증가한다. 공격 적중 시 3.0초간 적에게 주는 치명타 피해가 77.5% 증가한다.';
    const r = buildFromArmory(raw); expect(r.build.skills[0]!.mods).toEqual([]); expect(r.build.skills[0]!.onCast).toEqual([]);
    expect(r.warnings.some(w => w.includes('어둠의 핵 해석 못함'))).toBe(true);
  });
  it.each(['파멸의 셔플', '얼티밋 셔플', '예견된 죽음', '파멸의 폭풍'])('does not turn unresolved %s damage into a global multiplier', name => {
    const r = buildFromArmory(input([name])); const base = buildFromArmory(input()).build.skills[0]!;
    expect(r.build.skills[0]!.directCoef).toBe(base.directCoef); expect(r.build.skills[0]!.mods).toEqual([]);
    expect(r.warnings.some(w => w.includes(name) && w.includes('변형 피해·타수·모션 미반영'))).toBe(true);
  });
  it.each([0, 1])('computes the base + Dark Core control with crit rate %s', critRate => {
    const { build } = buildFromArmory(input(['어둠의 핵']));
    build.passiveMods = [{ bucket: 'critRate', value: critRate, source: 'control' }]; build.bluntThorn = undefined;
    build.params.atkBase = 100; build.params.gaugePerHit.normal = 0;
    const sim = new SimState(build, createRng(1), []); sim.cast(build.skills[0]!, 10);
    expect(sim.total).toBeCloseTo((3609.5 + 24.143 * 100) * 1.35 * (critRate ? 2.42 : 1), 8);
  });
  it('retains Quick Draw last-hit and quick preparation parsing', () => {
    expect(buildFromArmory(input(['퀵 드로'])).build.skills[0]!.quickDraw).toEqual({ chance: 0.3, trigger: 'last', attempts: 1 });
    const baseCooldown = buildFromArmory(input()).build.skills[0]!.cooldown;
    expect(buildFromArmory(input(['빠른 준비'])).build.skills[0]!.cooldown).toBe(baseCooldown - 5);
  });
  it('labels unsupported levels as fallback rather than clamping to a candidate', () => {
    expect(buildFromArmory(input([], 21)).build.skills[0]!.damageReference).toMatchObject({ source: 'codex-tooltip', level: 10 });
  });
});
