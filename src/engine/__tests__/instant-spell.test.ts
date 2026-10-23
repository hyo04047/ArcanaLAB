import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { damageWarnings } from '../skilldata';
import type { SkillBreakdown, SkillDef } from '../types';

const basePath = 'tests/fixtures/armory/FixtureCharacter26/';
const load = (name: string) => JSON.parse(readFileSync(basePath + name + '.json', 'utf8'));
function input(variant = 'empress', speed = 12, level = 3): RawArmory {
  const raw: RawArmory = { profiles: load('profiles'), combatSkills: load('combat-skills'), arkpassive: { Effects: [] },
    arkgrid: null, engravings: null, gems: null };
  if (variant === 'emperor') raw.arkpassive!.Effects.push({ Name: '깨달음', Description: '깨달음 1티어 황제의 칙령 Lv.3' });
  if (level >= 0) raw.arkpassive!.Effects.push({ Name: '도약', Description: `도약 1티어 즉각적인 주문 Lv.${level}`,
    ToolTip: JSON.stringify({ value: `초각성 스킬의 시전 속도가 ${speed}.0% 증가하고, 마나 소모량이 90.0% 감소한다.` }) });
  for (const skill of raw.combatSkills) skill.Rune = null;
  return raw;
}
function tSkill(raw: RawArmory) { return buildFromArmory(raw).build.skills.find(s => s.kind === 'hyper_awakening')!; }
class HitTrace extends SimState {
  readonly times: number[] = [];
  override hit(s: SkillDef, b: SkillBreakdown, first = true, last = true) {
    this.times.push(this.now); super.hit(s, b, first, last);
  }
}

describe('Instant Spell T-only cast-speed candidate', () => {
  it.each(['empress', 'emperor'])('applies the actual 12 percent tooltip once to %s', variant => {
    const base = tSkill(input(variant, 12, -1)), changed = tSkill(input(variant));
    expect(changed.castTime).toBeCloseTo(base.castTime / 1.12, 12);
    expect(changed.cooldown).toBe(base.cooldown); expect(changed.directCoef).toBe(base.directCoef);
  });
  it.each([[1, 4], [2, 8], [3, 12]])('reads level %s supplied percentage %s', (level, speed) => {
    expect(tSkill(input('empress', speed, level)).castTime).toBeCloseTo(tSkill(input('empress', 12, -1)).castTime / (1 + speed / 100), 12);
  });
  it('does not alter ordinary skills or passive damage/cooldown modifiers', () => {
    const base = buildFromArmory(input('empress', 12, -1)).build, changed = buildFromArmory(input()).build;
    expect(changed.skills.filter(s => s.kind !== 'hyper_awakening')).toEqual(base.skills.filter(s => s.kind !== 'hyper_awakening'));
    expect(changed.passiveMods).toEqual(base.passiveMods);
  });
  it('does not infer an active effect from a level zero node', () => {
    expect(tSkill(input('empress', 12, 0)).castTime).toBe(tSkill(input('empress', 12, -1)).castTime);
  });
  it.each(['condition', 'wrong target', 'missing clause', 'wrong tier'])('rejects unsupported wording: %s', kind => {
    const raw = input(), effect = raw.arkpassive!.Effects.at(-1)!;
    if (kind === 'condition') effect.ToolTip = effect.ToolTip!.replace('초각성 스킬의', '마나가 50% 이상일 때 초각성 스킬의');
    if (kind === 'wrong target') effect.ToolTip = effect.ToolTip!.replace('초각성 스킬의', '초각성기의');
    if (kind === 'missing clause') effect.ToolTip = effect.ToolTip!.replace(' 증가하고, 마나 소모량이 90.0% 감소한다.', ' 증가한다.');
    if (kind === 'wrong tier') effect.Description = effect.Description.replace('1티어', '2티어');
    const converted = buildFromArmory(raw);
    expect(converted.build.skills.find(s => s.kind === 'hyper_awakening')!.castTime).toBe(tSkill(input('empress', 12, -1)).castTime);
    expect(converted.warnings.some(w => w.includes('즉각적인 주문') && w.includes('아크패시브 해석 못함'))).toBe(true);
  });
  it('separates the general speed cap and Galewind from the T-only candidate', () => {
    const raw = input(); raw.combatSkills.find(s => s.Name === '더 데빌')!.Rune = { Name: '질풍', Grade: '전설',
      Tooltip: JSON.stringify({ value: '스킬 시전 속도가 14% 증가합니다.' }) };
    const { build } = buildFromArmory(raw); build.passiveMods = [{ bucket: 'atkSpeed', value: 0.8, source: '통제' }];
    const s = new SimState(build, createRng(1), []); s.stacks = 4; s.cast(s.skill('the_devil'), 10);
    expect(s.atkSpeed()).toBe(0.4);
    expect(s.now).toBeCloseTo(tSkill(input('empress', 12, -1)).castTime / (1.14 * 1.12 * 1.4), 12);
  });
  it('advances Sun launch without scaling its projectile intervals', () => {
    const { build } = buildFromArmory(input('emperor')); build.passiveMods = []; build.onCardUse = []; build.onDestiny = [];
    const sun = build.skills.find(s => s.id === 'the_sun')!, profile = sun.delayedHits!;
    const s = new HitTrace(build, createRng(1), []); s.cast(sun, 10); s.advanceTo(10);
    expect(s.times).toHaveLength(profile.hits.length);
    for (const [i, hit] of profile.hits.entries()) expect(s.times[i]).toBeCloseTo(profile.spawnAt / 1.12 + hit.after, 12);
    expect(s.times[1]! - s.times[0]!).toBeCloseTo(profile.hits[1]!.after - profile.hits[0]!.after, 12);
  });
  it('keeps unmodeled mana and empirical timing uncertainty visible', () => {
    const warnings = buildFromArmory(input()).warnings;
    expect(warnings.some(w => w.includes('즉각적인 주문') && w.includes('마나') && w.includes('미모델'))).toBe(true);
    expect(warnings.some(w => w.includes('즉각적인 주문') && w.includes('후보') && w.includes('미검증'))).toBe(true);
  });
  it('applies the reference preset level three once', () => {
    expect(empressInkomsu440().skills.find(s => s.id === 'the_devil')!.castTime).toBeCloseTo(1.5 / 1.12, 12);
    expect(damageWarnings(empressInkomsu440()).some(w => w.includes('즉각적인 주문') && w.includes('후보') && w.includes('미검증'))).toBe(true);
  });
});
