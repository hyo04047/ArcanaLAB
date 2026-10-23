import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor, empressInkomsu440 } from '../presets';
import { createRng, type Rng } from '../rng';
import { damageWarnings } from '../skilldata';
import { SimState } from '../sim';
import type { SkillDef } from '../types';

const base = empressInkomsu440();
function state(extra: Partial<SkillDef> = {}, rng: Rng = createRng(1)) {
  const sk = { ...base.skills.find(s => s.id === 'serendipity')!, mods: [], onCast: [], procCritDmg: undefined,
    defenseIgnore: undefined, ...extra };
  return new SimState({ ...base, skills: [sk], passiveMods: [], bluntThorn: undefined, onRuinAt4: [], cardDurationBonus: {},
    rotation: { ruinPriority: [sk.id], stackPriority: [] },
    params: { ...base.params, atkBase: 10000, gaugeGainBonus: 0, gaugePerHit: { normal: 0, stack: 0, ruin: 0.1, hyper_awakening: 0, awakening: 0 } } }, rng, cardsFor('empress'));
}
function cast(s: SimState) { s.cast(s.build.skills[0]!, 10); return s.breakdown.get('serendipity')!; }
function judgment(s: SimState, duration = 4) { s.applyBuff({ id: 'judgment', duration, mod: { bucket: 'critRate', value: 0, source: 'test' } }); }
const rng = (fn: (p: number) => boolean): Rng => ({ ...createRng(1), chance: fn });

describe('Serendipity normal first-hit / judgment full-combo policy', () => {
  it('uses only one impact, explosion and gauge gain in normal play', () => {
    const s = state(); s.stacks = 4;
    const b = cast(s);
    expect(b.direct).toBe(19561); expect(b.stackEffect).toBe(161320);
    expect(s.deck.gauge).toBeCloseTo(0.1);
    expect(s.now).toBe(1.8); // unknown cancel timing uses first-motion end, never hit time
    expect(s.build.skills[0]!.hitSequence!.hits).toHaveLength(3);
    expect(damageWarnings(s.build).some(w => w.includes('1타') && w.includes('미확인'))).toBe(true);
  });
  it('does not turn cull or a preserved stack into a full combo', () => {
    const s = state({ keepStacksChance: 1, keepStacksMin: 1 }); s.stacks = 4;
    s.drawCards(1, 'cull'); s.useCardNow('cull');
    const b = cast(s);
    expect(b.direct).toBeGreaterThan(19561);
    expect(s.deck.gauge).toBeCloseTo(0.1); expect(s.stacks).toBe(4);
    expect(s.ruinCasts).toBe(1);
  });
  it('uses three impacts in judgment and rechecks expiration for explosions', () => {
    const s = state(); judgment(s, 1.093);
    const b = cast(s);
    expect(b.direct).toBe(68445.5); expect(b.stackEffect).toBe(161320);
    expect(s.now).toBe(2.867);
  });
  it('checks the policy after held judgment is played by the rotation', () => {
    const s = state(); s.drawCards(1, 'judgment');
    const r = s.run(2.867);
    expect(r.breakdown[0]!.direct).toBe(68445.5);
    expect(r.breakdown[0]!.stackEffect).toBe(161320 * 3);
    expect(r.ruinCasts).toBe(1);
  });
  it('does not count canceled follow-up preservation or corrosion procs', () => {
    const calls: number[] = [];
    const s = state({ keepStacksChance: 0.28, keepStacksMin: 1 }, rng(p => { calls.push(p); return p === 0.28; })); s.stacks = 4;
    s.applyBuff({ id: 'corrosion_window', duration: 10, mod: { bucket: 'critRate', value: 0, source: 'test' } });
    cast(s);
    expect(calls.filter(p => p === 0.28)).toHaveLength(1);
    expect(calls.filter(p => p === 0.3)).toHaveLength(1);
  });
});

describe('Serendipity piercing strike defense ignore', () => {
  it('imports the selected chance and ignore fraction through both build paths', () => {
    const dir = resolve(__dirname, '../../../tests/fixtures/armory/FixtureCharacter26');
    const read = (name: string) => JSON.parse(readFileSync(resolve(dir, name + '.json'), 'utf8'));
    const raw: RawArmory = { profiles: read('profiles'), combatSkills: read('combat-skills'), arkpassive: null, arkgrid: null, engravings: null, gems: null };
    for (const b of [base, buildFromArmory(raw).build]) expect(b.skills.find(s => s.id === 'serendipity')!.defenseIgnore).toEqual({ chance: 0.5, fraction: 0.8 });
    const input = structuredClone(raw);
    input.combatSkills.find(s => s.Name === '세렌디피티')!.Tripods!.find(t => t.Name === '꿰뚫는 일격')!.Tooltip = '스킬 및 스택트 효과 적중 시 50.0% 확률로 적의 모든 방어력을 73.0% 무시한다.';
    expect(buildFromArmory(input).build.skills.find(s => s.id === 'serendipity')!.defenseIgnore).toEqual({ chance: 0.5, fraction: 0.73 });
  });
  it.each([true, false])('rolls direct and explosion separately: direct success=%s', directSuccess => {
    const outcomes = [directSuccess, !directSuccess]; let count = 0;
    const s = state({ defenseIgnore: { chance: 0.5, fraction: 0.8 } }, rng(p => { if (p === 0.5) { count++; return outcomes.shift()!; } return false; }));
    s.stacks = 4; const b = cast(s);
    expect(count).toBe(2);
    expect(b.direct).toBeCloseTo(19561 * (directSuccess ? 5 / 3 : 1), 7);
    expect(b.stackEffect).toBeCloseTo(161320 * (directSuccess ? 1 : 5 / 3), 7);
  });
  it('uses six independent rolls for three direct hits plus three judgment explosions', () => {
    let count = 0;
    const s = state({ defenseIgnore: { chance: 0.5, fraction: 0.8 } }, rng(p => { if (p === 0.5) { count++; return true; } return false; })); judgment(s);
    const b = cast(s);
    expect(count).toBe(6); expect(b.direct).toBeCloseTo(68445.5 * 5 / 3, 7);
    expect(b.stackEffect).toBeCloseTo(161320 * 5, 7);
  });
  it('adds intended chance as percentage points without changing the ignore fraction', () => {
    const chances: number[] = [];
    const s = state({ defenseIgnore: { chance: 0.5, fraction: 0.8 }, tripodChanceBonus: 0.2 }, rng(p => { if (p > 0) chances.push(p); return false; })); s.stacks = 4;
    cast(s); expect(chances).toEqual([0.7, 0.7]);
  });
  it('does not roll a nonexistent explosion or keep an ignore buff after damage', () => {
    let count = 0;
    const s = state({ defenseIgnore: { chance: 0.5, fraction: 0.8 } }, rng(p => { if (p === 0.5) count++; return true; }));
    cast(s); expect(count).toBe(1); expect(s.activeMods()).toEqual([]);
  });
  it.each([0, 3250, 13000])('uses the supplied target defense %s instead of a fixed damage bonus', defense => {
    const s = state({ defenseIgnore: { chance: 1, fraction: 0.8 } }); s.stacks = 4;
    s.build.params.targetDefense = defense;
    const expected = (6500 + defense) / (6500 + 0.2 * defense);
    const b = cast(s);
    expect(b.direct).toBeCloseTo(19561 * expected, 7);
    expect(b.stackEffect).toBeCloseTo(161320 * expected, 7);
  });
});
