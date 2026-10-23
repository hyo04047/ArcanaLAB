import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { strip, tooltipLines } from '../tooltip';
import type { SkillDef } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
type Effect = NonNullable<RawArmory['arkpassive']>['Effects'][number];
const nodes: Effect[] = load('tests/fixtures/audit/2026-10-17-chariot-sources.json').records.map((r: { body: string }) =>
  JSON.parse(r.body).Effects.find((e: Effect) => e.Description.includes('파괴 전차')));
function input(node: Effect): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [], arkgrid: null, engravings: null, gems: null,
    arkpassive: { Effects: [structuredClone(node)] } };
}
const skill: SkillDef = { id: 'control', name: 'control', kind: 'normal', cooldown: 10, castTime: 1.4, directCoef: 1, hits: 1 };

describe.each(nodes.map((node, i) => [i + 1, node] as const))('Chariot official level %s', (level, node) => {
  it('uses both official values and adds evolution damage to the existing bucket', () => {
    const { build, warnings } = buildFromArmory(input(node));
    const mods = build.passiveMods.filter(m => m.source.startsWith('파괴 전차'));
    expect(mods.map(m => [m.bucket, m.value])).toEqual([['evoDmg', level * 0.12], ['atkSpeed', level * 0.04]]);
    const result = computeMultipliers({ atkBase: 1 }, [...mods, { bucket: 'evoDmg', value: 0.5, source: 'control' }],
      { skill, stacks: 0, component: 'direct' });
    expect(result.evoDmg).toBeCloseTo(1.5 + level * 0.12);
    expect(warnings.some(w => w.includes('파괴 전차') && w.includes('해석 못함'))).toBe(false);
  });

  it.each([0, 0.39])('feeds global cast speed and the existing cap at other bonus %s', other => {
    const { build } = buildFromArmory(input(node));
    build.passiveMods = [...build.passiveMods.filter(m => m.source.startsWith('파괴 전차')),
      { bucket: 'atkSpeed', value: other, source: 'control' }];
    build.skills = [{ ...skill, directCoef: 0, hits: 0 }];
    const sim = new SimState(build, createRng(1), []), speed = Math.min(0.4, other + level * 0.04);
    expect(sim.atkSpeed()).toBeCloseTo(speed);
    sim.cast(build.skills[0]!, 10);
    expect(sim.now).toBeCloseTo(1.4 / (1 + speed));
    expect(sim.readyAt.get('control')).toBe(10);
  });

  it.each(['condition', 'separate condition', 'target', 'damage only', 'speed only', 'category', 'tier', 'zero level',
    'unsupported level', 'invalid damage', 'invalid speed', 'missing', 'reversed damage', 'reversed speed'])(
    'rejects %s without applying either effect', change => {
      const raw = input(node), effect = raw.arkpassive!.Effects[0]!;
      effect.Description = strip(effect.Description);
      let text = tooltipLines(effect.ToolTip).find(t => t.startsWith('진화형 피해가'))!.replace(/\|\|/g, '').trim();
      if (change === 'condition') text = '카드 사용 후 5초 동안 ' + text;
      if (change === 'target') text = '일반 스킬의 ' + text;
      if (change === 'damage only') text = text.split(' 증가하고,')[0] + ' 증가합니다.';
      if (change === 'speed only') text = text.split('증가하고, ')[1]!;
      if (change === 'category') effect.Description = effect.Description.replace('진화', '깨달음');
      if (change === 'tier') effect.Description = effect.Description.replace('3티어', '2티어');
      if (change === 'zero level') effect.Description = effect.Description.replace(/Lv\.\d+/, 'Lv.0');
      if (change === 'unsupported level') effect.Description = effect.Description.replace(/Lv\.\d+/, 'Lv.3');
      if (change === 'invalid damage') text = text.replace(/[\d.]+%/, '1.2.3%');
      if (change === 'invalid speed') text = text.replace(/속도가 [\d.]+%/, '속도가 1.2.3%');
      if (change === 'reversed damage') text = text.replace('증가하고', '감소하고');
      if (change === 'reversed speed') text = text.replace('증가합니다', '감소합니다');
      effect.ToolTip = change === 'missing' ? undefined : JSON.stringify({ value: text,
        ...(change === 'separate condition' ? { condition: '생명력이 절반 이상일 때만 적용됩니다.' } : {}) });
      const { build, warnings } = buildFromArmory(raw);
      expect(build.passiveMods.filter(m => m.source.startsWith('파괴 전차'))).toEqual([]);
      expect(warnings.some(w => w.includes('파괴 전차') && w.includes('해석 못함'))).toBe(true);
    });
});

it('uses supplied Chariot values instead of multiplying its level', () => {
  const raw = input(nodes[0]!), node = raw.arkpassive!.Effects[0]!;
  node.ToolTip = node.ToolTip!.replace('12.0%', '11.5%').replace('4.0%', '3.5%');
  expect(buildFromArmory(raw).build.passiveMods.filter(m => m.source.startsWith('파괴 전차')).map(m => m.value)).toEqual([0.115, 0.035]);
});
