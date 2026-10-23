import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { strip, tooltipLines } from '../tooltip';
import type { SkillDef } from '../types';

type Effect = NonNullable<RawArmory['arkpassive']>['Effects'][number];
const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-common-passive-sources.json', 'utf8')).records as { body: string }[];
const names = ['한계 돌파', '예리한 감각', '혼신의 강타'];
const nodes = records.flatMap(r => (JSON.parse(r.body).Effects as Effect[])
  .filter(e => names.some(name => e.Description.includes(name))));
const profile = JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8'));
const input = (effects: Effect[]): RawArmory => ({ profiles: profile, combatSkills: [], arkpassive: { Effects: effects },
  arkgrid: null, engravings: null, gems: null });
const skill: SkillDef = { id: 'control', name: 'control', kind: 'normal', cooldown: 1, castTime: 1, directCoef: 1, hits: 1 };

describe('official common evolution passives', () => {
  it.each(nodes.map((node, i) => [i, node] as const))('reads official sample %s as additive evolution damage and critical chance', (_, node) => {
    const { build, warnings } = buildFromArmory(input([node]));
    const name = strip(node.Description).match(/티어 (.+) Lv/)![1]!;
    const mods = build.passiveMods.filter(m => m.source.startsWith(name));
    const expected = name === '한계 돌파' ? [0.1, 0] : name === '예리한 감각' ? [0.1, 0.08] : [0.04, 0.24];
    for (const component of ['direct', 'stack', 'dot'] as const) {
      const actual = computeMultipliers({ atkBase: 1 }, [...mods, { bucket: 'evoDmg', value: 0.5, source: 'control' }],
        { skill, stacks: 4, component });
      expect(actual.evoDmg).toBeCloseTo(1.5 + expected[0]!);
      expect(actual.critRate).toBe(expected[1]);
    }
    expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(false);
  });

  it('feeds the supplied critical chance into the existing Blunt Thorn cap and conversion', () => {
    const chosen = names.slice(1).map(name => nodes.find(e => e.Description.includes(name))!);
    const { build } = buildFromArmory(input(chosen));
    const mods = build.passiveMods.filter(m => names.some(name => m.source.startsWith(name)));
    mods.push({ bucket: 'critRate', value: 0.75, source: 'control' });
    const actual = computeMultipliers({ atkBase: 1, bluntThorn: { base: 0.15, ratio: 1.5, cap: 0.75 } }, mods,
      { skill, stacks: 4, component: 'direct' });
    expect(actual.critRate).toBe(0.8);
    expect(actual.evoDmg).toBeCloseTo(1 + 0.1 + 0.04 + 0.15 + 0.27 * 1.5);
  });

  describe.each(names)('%s input boundary', name => {
    it.each(['prefix', 'suffix', 'separate condition', 'target', 'category', 'tier', 'zero level', 'unsupported level', 'invalid number', 'missing description'])(
      'excludes unsupported %s without a partial effect', change => {
        const node = structuredClone(nodes.find(e => e.Description.includes(name))!);
        node.Description = strip(node.Description);
        const text = tooltipLines(node.ToolTip).find(t => t.startsWith('진화형 피해가') || t.startsWith('치명타 적중률이'))!.replace(/\|\|/g, ' ').trim();
        if (change === 'prefix') node.ToolTip = JSON.stringify({ value: '카드 사용 후 5초 동안 ' + text });
        if (change === 'suffix') node.ToolTip = JSON.stringify({ value: text + ' 마나가 절반 이상일 때만 적용됩니다.' });
        if (change === 'separate condition') node.ToolTip = JSON.stringify({ value: text, condition: '마나가 절반 이상일 때만 적용됩니다.' });
        if (change === 'target') node.ToolTip = JSON.stringify({ value: '일반 스킬의 ' + text });
        if (change === 'category') node.Description = node.Description.replace('진화', '깨달음');
        if (change === 'tier') node.Description = node.Description.replace(/\d티어/, '5티어');
        if (change === 'zero level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.0');
        if (change === 'unsupported level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.9');
        if (change === 'invalid number') node.ToolTip = JSON.stringify({ value: text.replace(/[\d.]+%/, '1.2.3%') });
        if (change === 'missing description') node.ToolTip = '';
        const { build, warnings } = buildFromArmory(input([node]));
        expect(build.passiveMods.filter(m => m.source.startsWith(name))).toEqual([]);
        expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
      });
  });
});
