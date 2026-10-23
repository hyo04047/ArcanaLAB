import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor } from '../presets';
import { strip, tooltipLines } from '../tooltip';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const refs = load('tests/fixtures/audit/2026-10-13-knight-passive-sources.json').refs;
const effects: NonNullable<RawArmory['arkpassive']>['Effects'] = refs[0].data.Effects;
const raw: RawArmory = { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [],
  arkpassive: { Effects: [effects.find(e => e.Description.includes('황제의 칙령'))!] },
  arkgrid: null, engravings: null, gems: null };
const baseline = buildFromArmory(raw).build;
const baseCards = cardsFor(baseline.variant, baseline.deckOverrides);
function input(name: string) {
  return { ...raw, arkpassive: { Effects: [...raw.arkpassive!.Effects,
    structuredClone(effects.find(e => e.Description.includes(name))!)] } };
}

describe.each(['황후의 기사', '황제의 하사품'])('%s deck mutation boundary', name => {
  it('preserves the official deck change', () => {
    const { build } = buildFromArmory(input(name));
    const ids = cardsFor(build.variant, build.deckOverrides).map(c => c.id);
    expect(ids).toHaveLength(name === '황후의 기사' ? 16 : 15);
    if (name === '황후의 기사') {
      expect(ids).toContain('empress_knight');
      expect(build.passiveMods.find(m => m.source.startsWith(name))!.value).toBe(4);
    } else {
      expect(ids).toContain('chancellor'); expect(ids).toContain('sovereign');
      expect(ids).not.toContain('balance'); expect(ids).not.toContain('judgment');
    }
  });

  it.each(['missing text', 'separate condition', 'prefix condition', 'category', 'tier', 'level zero', 'unsupported level'])(
    'preserves the original deck for %s', change => {
      const value = input(name), node = value.arkpassive.Effects.at(-1)!;
      node.Description = strip(node.Description);
      const text = tooltipLines(node.ToolTip).filter(t => ![name, '깨달음'].includes(t) && !/^아크 패시브 레벨/.test(t))
        .join(' ').replace(/\|\|/g, ' ').trim();
      if (change === 'missing text') node.ToolTip = undefined;
      if (change === 'separate condition') node.ToolTip = JSON.stringify({ value: text, condition: '마나가 절반 이상일 때만 적용됩니다.' });
      if (change === 'prefix condition') node.ToolTip = JSON.stringify({ value: '마나가 절반 이상일 때 ' + text });
      if (change === 'category') node.Description = node.Description.replace('깨달음', '진화');
      if (change === 'tier') node.Description = node.Description.replace(/\d티어/, '5티어');
      if (change === 'level zero') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.0');
      if (change === 'unsupported level') node.Description = node.Description.replace(/Lv\.\d+/, 'Lv.9');
      const { build, warnings } = buildFromArmory(value);
      expect(build).toEqual(baseline);
      expect(cardsFor(build.variant, build.deckOverrides)).toEqual(baseCards);
      expect(warnings.some(w => w.includes(name) && w.includes('해석 못함'))).toBe(true);
    });
});

it('does not partially replace cards for a level two Gift missing its second clause', () => {
  const value = input('황제의 하사품');
  value.arkpassive.Effects.at(-1)!.ToolTip = JSON.stringify({ value: '카드덱의 균형 카드가 재상 카드로 교체된다.' });
  expect(buildFromArmory(value).build).toEqual(baseline);
});

it('does not add Knight or inject NaN damage from a malformed percentage', () => {
  const value = input('황후의 기사'), node = value.arkpassive.Effects.at(-1)!;
  node.ToolTip = node.ToolTip!.replace('400.0%', '1.2.3%');
  expect(buildFromArmory(value).build).toEqual(baseline);
});
