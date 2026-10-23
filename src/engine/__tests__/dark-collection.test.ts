import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { coreTestPassives, coreTestTooltip } from './core-fixture';
import { tooltipLines } from '../tooltip';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-impact-mate-sources.json', 'utf8'));
const skills = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses['combat-skills'].data;
function input(point = 14): RawArmory {
  const core = structuredClone(source.responses.arkgrid.data.Slots.find((s: { Name: string }) => s.Name.endsWith('다크 콜렉션')));
  core.Point = point; core.Gems = [];
  return { profiles: source.responses.profiles.data, combatSkills: structuredClone(skills.filter((s: { Name: string }) => ['다크 리저렉션', '이보크'].includes(s.Name))),
    arkpassive: coreTestPassives(true), arkgrid: { Slots: [core] }, engravings: null, gems: null };
}
function state(point = 14) {
  const { build } = buildFromArmory(input(point));
  build.passiveMods = build.passiveMods.filter(m => m.source.startsWith('다크 콜렉션'));
  build.params.atkBase = 100; build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  build.params.raidCaptainRatio = 0; build.bluntThorn = undefined;
  for (const skill of build.skills) { skill.mods = []; delete skill.quickDraw; delete skill.hitRune; }
  return new SimState(build, createRng(1), []);
}
const value = (s: SimState, id: string, component: 'direct' | 'dot') => computeMultipliers({ atkBase: 100 }, s.activeMods(),
  { skill: s.skill(id), stacks: 0, component }).skillDmg;

describe('Dark Collection poison scope', () => {
  it.each([13, 14, 17])('applies the 14P increase only to Dark poison at %sP', point => {
    const s = state(point); expect(value(s, 'dark_resurrection', 'dot')).toBeCloseTo(point >= 14 ? 1.7 : 1);
    expect(value(s, 'dark_resurrection', 'direct')).toBeCloseTo(1.06);
    expect(value(s, 'evoke', 'dot')).toBe(1);
    expect(value(s, 'evoke', 'direct')).toBeCloseTo(point >= 17 ? 1.15 : 1);
  });
  it('increases actual poison ticks without increasing the direct hits', () => {
    const before = state(13), after = state(14);
    for (const s of [before, after]) { s.cast(s.skill('dark_resurrection'), 20); s.advanceTo(10); }
    const old = before.breakdown.get('dark_resurrection')!, current = after.breakdown.get('dark_resurrection')!;
    expect(current.direct).toBeCloseTo(old.direct); expect(old.dot).toBeGreaterThan(0);
    expect(current.dot).toBeCloseTo(old.dot! * 1.7);
  });
  it('does not create poison if Fear of Death is not selected', () => {
    const raw = input(); raw.combatSkills.find(s => s.Name === '다크 리저렉션')!.Tripods!.forEach(t => { if (t.Name === '죽음의 공포') t.IsSelected = false; });
    const { build } = buildFromArmory(raw); expect(build.skills.find(s => s.id === 'dark_resurrection')!.fearOfDeath).toBeUndefined();
  });
  it('does not read a new extra condition as an unconditional poison increase', () => {
    const raw = input(), core = raw.arkgrid!.Slots[0]!;
    const options = tooltipLines(core.Tooltip).find(l => l.startsWith('[10P]'))!;
    core.Tooltip = coreTestTooltip(options.replace('70.0% 증가한다.', '70.0% 증가한다. 생명력이 낮을 때'), true);
    const result = buildFromArmory(raw);
    expect(result.build.passiveMods.some(m => m.source === '다크 콜렉션 14P')).toBe(false);
    expect(result.warnings.some(w => w.includes('다크 콜렉션 14P') && w.includes('미반영'))).toBe(true);
  });
  it('requires the dedicated core nodes', () => {
    const raw = input(); raw.arkpassive = coreTestPassives(false);
    expect(buildFromArmory(raw).build.passiveMods.some(m => m.source === '다크 콜렉션 14P')).toBe(false);
  });
});
