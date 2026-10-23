import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { tooltipLines } from '../tooltip';
import { coreTestPassives, coreTestTooltip } from './core-fixture';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-high-tempo-sources.json', 'utf8'));
function input(point = 17): RawArmory {
  const core = structuredClone(source.core); core.Point = point; core.Gems = [];
  return { profiles: source.responses.profiles.data, combatSkills: [], arkpassive: coreTestPassives(true),
    arkgrid: { Slots: [core] }, engravings: null, gems: null };
}
function state(point = 17) {
  const { build } = buildFromArmory(input(point));
  build.passiveMods = []; build.params.atkBase = 100; build.bluntThorn = undefined;
  build.params.gaugePerHit = { normal: 0, stack: 0, ruin: 0, awakening: 0, hyper_awakening: 0 };
  build.skills = (['normal', 'the_sun', 'awakening', 'identity_card', 'unknown'] as const).map(id => ({
    id, name: id, kind: id === 'the_sun' ? 'hyper_awakening' : id === 'unknown' ? 'normal' : id,
    usesMana: id === 'unknown' ? undefined : id === 'normal' || id === 'the_sun',
    castTime: 0, cooldown: 20, hits: 1, directCoef: 0,
  }));
  return new SimState(build, createRng(1), []);
}
const value = (s: SimState, id = 'normal') => computeMultipliers({ atkBase: 100 }, s.activeMods(),
  { skill: s.skill(id), stacks: 0, component: 'direct' }).skillDmg;
const options = (raw: RawArmory) => tooltipLines(raw.arkgrid!.Slots[0]!.Tooltip).find(l => l.startsWith('[10P]'))!;

describe('High Tempo future cooldown window', () => {
  it.each([[13, 1, 1], [14, 0.92, 1], [16, 0.92, 1], [17, 0.92, 1.04]])('honors %sP', (point, cd, damage) => {
    const s = state(point); expect(s.cooldownMultiplier(s.skill('normal'))).toBe(1); expect(value(s)).toBe(1);
    s.triggerDestiny(); expect(s.cooldownMultiplier(s.skill('normal'))).toBeCloseTo(cd); expect(value(s)).toBeCloseTo(damage);
  });
  it('does not shorten running cooldowns on destiny or lengthen them on expiry', () => {
    const s = state(); s.cast(s.skill('normal'), 100); s.advanceTo(5); s.triggerDestiny();
    expect(s.readyAt.get('normal')).toBe(20);
    s.cast(s.skill('the_sun'), 100); expect(s.readyAt.get('the_sun')).toBeCloseTo(23.4);
    s.advanceTo(20); expect(s.cooldownMultiplier(s.skill('the_sun'))).toBe(1);
    expect(s.readyAt.get('the_sun')).toBeCloseTo(23.4);
  });
  it('only changes confirmed mana skills, including T and excluding cards, awakening and unknown', () => {
    const s = state(); s.triggerDestiny();
    for (const id of ['normal', 'the_sun']) { expect(value(s, id)).toBeCloseTo(1.04); expect(s.cooldownMultiplier(s.skill(id))).toBeCloseTo(0.92); }
    for (const id of ['awakening', 'identity_card', 'unknown']) { expect(value(s, id)).toBe(1); expect(s.cooldownMultiplier(s.skill(id))).toBe(1); }
  });
  it('refreshes both effects to 15 seconds without stacking', () => {
    const s = state(); s.triggerDestiny(); s.advanceTo(10); s.triggerDestiny();
    s.advanceTo(24.999); expect(value(s)).toBeCloseTo(1.04); expect(s.cooldownMultiplier(s.skill('normal'))).toBeCloseTo(0.92);
    s.advanceTo(25); expect(value(s)).toBe(1); expect(s.cooldownMultiplier(s.skill('normal'))).toBe(1);
  });
  it('multiplies future cooldown with other valid reductions instead of adding it', () => {
    const s = state(); s.build.passiveMods = [{ bucket: 'cooldown', value: 0.2, source: '통제' }]; s.triggerDestiny();
    s.cast(s.skill('normal'), 100); expect(s.readyAt.get('normal')).toBeCloseTo(20 * 0.8 * 0.92);
  });
  it('snapshots each serial charge recovery when that recovery begins', () => {
    const build = state().build; build.skills[0]!.maxCharges = 2;
    const s = new SimState(build, createRng(1), []), skill = s.skill('normal');
    s.triggerDestiny(); s.cast(skill, 100); s.cast(skill, 100);
    expect(s.readyAt.get(skill.id)).toBeCloseTo(18.4);
    s.advanceTo(s.readyAt.get(skill.id)!); expect(s.isReady(skill.id)).toBe(true); expect(s.readyAt.get(skill.id)).toBeCloseTo(38.4);
    s.triggerDestiny(); expect(s.readyAt.get(skill.id)).toBeCloseTo(38.4);
  });
  it('checks the Evoke recast cooldown at recast time, not placement time', () => {
    const s = state(), evoke = s.skill('normal');
    evoke.splitEvoke = { duration: 1, placementAt: 0, delay: 2, window: 3 }; evoke.castTime = 1;
    s.cast(evoke, 100); s.triggerDestiny(); s.cast(evoke, 100);
    expect(s.readyAt.get(evoke.id)).toBeCloseTo(1 + 20 * 0.92);
  });
  it('reads the ancient 5% value from a synthetic tooltip, preserving the cooldown', () => {
    const raw = input(); raw.arkgrid!.Slots[0]!.Tooltip = raw.arkgrid!.Slots[0]!.Tooltip!.replace('4.0%', '5.0%');
    const effects = buildFromArmory(raw).build.onDestiny!;
    expect(effects).toHaveLength(2); expect(effects[0]).toMatchObject({ mod: { value: 0.08 } });
    expect(effects[1]).toMatchObject({ duration: 15, mod: { value: 0.05 } });
  });
  it('keeps the permanent 10P damage outside the timed 17P effect', () => {
    const { build } = buildFromArmory(input());
    expect(build.passiveMods.filter(m => m.source.startsWith('하이 템포'))).toEqual([
      { bucket: 'skillDmg', value: 0.02, filter: { usesMana: true }, source: '하이 템포 10P' },
    ]);
  });
  it('does not create a timed damage effect without its 14P definition', () => {
    const raw = input(); raw.arkgrid!.Slots[0]!.Tooltip = coreTestTooltip(options(raw).replace(/\[14P\][\s\S]*?(?=\[17P\])/, ''), true);
    expect(buildFromArmory(raw).build.onDestiny).toEqual([]);
  });
  it('rejects a new condition in the buff definition', () => {
    const raw = input(); raw.arkgrid!.Slots[0]!.Tooltip = coreTestTooltip(options(raw).replace('효과를 획득한다.', '효과를 획득한다. 생명력이 낮을 때'), true);
    expect(buildFromArmory(raw).build.onDestiny).toEqual([]);
  });
  it('keeps a recognized 14P when the 17P addition is unknown', () => {
    const raw = input(); raw.arkgrid!.Slots[0]!.Tooltip = coreTestTooltip(options(raw).replace('효과를 추가한다.', '효과를 추가한다. 생명력이 낮을 때'), true);
    const result = buildFromArmory(raw); expect(result.build.onDestiny).toHaveLength(1);
    expect(result.warnings.some(w => w.includes('하이 템포 17P') && w.includes('미반영'))).toBe(true);
  });
  it('excludes effects if the required Emperor nodes are missing', () => {
    const raw = input(); raw.arkpassive = coreTestPassives(false); expect(buildFromArmory(raw).build.onDestiny).toEqual([]);
  });
});
