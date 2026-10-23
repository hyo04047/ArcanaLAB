import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { strip, tooltipLines } from '../tooltip';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const record = load('tests/fixtures/audit/2026-10-17-leap-lower-sources.json').records
  .find((r: { character: string }) => r.character === 'FixtureCharacter23');
const official = JSON.parse(record.body).Effects.find((e: { Description: string }) => strip(e.Description) === '깨달음 4티어 또 다른 황제 Lv.1');
function input(): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [], arkgrid: null, engravings: null, gems: null,
    arkpassive: { Effects: [structuredClone(official)] } };
}
const nodeMods = (raw: RawArmory) => buildFromArmory(raw).build.passiveMods.filter(m => m.source.startsWith('또 다른 황제'));

describe('Another Emperor official level 1', () => {
  it('reads the complete level 1 sentence without requiring an absent bonus clause', () => {
    const { build, warnings } = buildFromArmory(input());
    expect(nodeMods(input())).toEqual([{ bucket: 'dmgToEnemy', value: 0.02, source: '또 다른 황제 Lv1' }]);
    expect(build.anotherEmperorChance).toBe(0.2);
    expect(warnings.some(w => w.includes('또 다른 황제') && w.includes('해석 못함'))).toBe(false);
    expect(warnings.some(w => w.startsWith('또 다른 황제 Lv1: 추가 카드 피해'))).toBe(false);
  });

  it('reads the provided values instead of supplying values from the level', () => {
    const raw = input(), node = raw.arkpassive!.Effects[0]!;
    node.ToolTip = node.ToolTip!.replace('2.0%', '3.5%').replace('20.0%', '17.0%');
    expect(nodeMods(raw)[0]?.value).toBe(0.035);
    expect(buildFromArmory(raw).build.anotherEmperorChance).toBe(0.17);
  });

  it('rolls once on use while retaining the unknown zero basic card damage', () => {
    const { build } = buildFromArmory(input());
    const chance = vi.fn((p: number) => p === 0.2 || p >= 1);
    const sim = new SimState(build, { ...createRng(42), chance }, cardsFor(build.variant, build.deckOverrides));
    const damage = vi.spyOn(sim, 'dealCardDamage');
    sim.drawCards(1, 'star');
    expect(chance.mock.calls.filter(([p]) => p === 0.2)).toHaveLength(0);
    sim.useCardNow('star');
    expect(chance.mock.calls.filter(([p]) => p === 0.2)).toHaveLength(1);
    expect(damage).toHaveBeenCalledTimes(1);
    expect(damage).toHaveBeenCalledWith('emperor', 0, true);
    expect(build.params.cardDamageCoef).toEqual({});
    expect(sim.total).toBe(0);
  });

  it.each(['level 2', 'level 3', 'wrong tier', 'wrong category', 'missing', 'extra condition',
    'invalid damage', 'invalid probability', 'probability above 100', 'reversed effect', 'truncated', 'acquisition trigger'])(
    'rejects unsupported or incomplete input: %s', change => {
      const raw = input(), node = raw.arkpassive!.Effects[0]!;
      let text = tooltipLines(node.ToolTip).filter(t => !['또 다른 황제', '깨달음'].includes(t) && !/^아크 패시브 레벨/.test(t))
        .join(' ').replace(/\|\|/g, ' ').trim();
      if (change === 'level 2' || change === 'level 3') node.Description = strip(node.Description).replace('Lv.1', `Lv.${change.at(-1)}`);
      if (change === 'wrong tier') node.Description = strip(node.Description).replace('4티어', '3티어');
      if (change === 'wrong category') node.Description = strip(node.Description).replace('깨달음', '도약');
      if (change === 'extra condition') text += ' 생명력이 절반 이상일 때만 적용됩니다.';
      if (change === 'invalid damage') text = text.replace('2.0%', '2.3.4%');
      if (change === 'invalid probability') text = text.replace('20.0%', '2.3.4%');
      if (change === 'probability above 100') text = text.replace('20.0%', '120.0%');
      if (change === 'reversed effect') text = text.replace('증가', '감소');
      if (change === 'truncated') text = text.replace('발생한다.', '발생하며,');
      if (change === 'acquisition trigger') text = text.replace('사용시', '획득시');
      node.ToolTip = change === 'missing' ? undefined : JSON.stringify({ value: text });
      const { build, warnings } = buildFromArmory(raw);
      expect(nodeMods(raw)).toEqual([]);
      expect(build.anotherEmperorChance).toBeUndefined();
      expect(warnings.some(w => w.includes('또 다른 황제') && w.includes('해석 못함'))).toBe(true);
    });
});
