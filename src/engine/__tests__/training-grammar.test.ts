import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { strip } from '../tooltip';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const sources = [
  ['tests/fixtures/audit/2026-10-17-timing-mastery-sources.json', 'FixtureCharacter11'],
  ['tests/fixtures/audit/2026-10-17-timing-mastery-followup-sources.json', 'FixtureCharacter18'],
  ['tests/fixtures/audit/2026-10-17-infighting-sources.json', 'FixtureCharacter27'],
].map(([path, character]) => {
  const record = load(path!).records.find((r: { character: string }) => r.character === character);
  const node = JSON.parse(record.body).Effects.find((e: { Description: string }) => strip(e.Description) === '진화 2티어 최적화 훈련 Lv.2');
  return { character, node };
});
const input = (node: NonNullable<RawArmory['arkpassive']>['Effects'][number]): RawArmory => ({
  profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [], arkpassive: { Effects: [node] }, arkgrid: null, engravings: null, gems: null,
});

describe('Optimized Training official wording without the subject particle', () => {
  it.each(sources)('imports the complete Lv2 effect from $character', ({ node }) => {
    const converted = buildFromArmory(input(node));
    expect(converted.build.passiveMods.filter(m => m.source.startsWith('최적화 훈련'))).toEqual([
      { bucket: 'evoDmg', value: 0.1, source: '최적화 훈련 Lv2' },
      { bucket: 'cooldown', value: 0.08, source: '최적화 훈련 Lv2', filter: { excludeKinds: ['awakening'] }, cooldownGroup: 'nonAwakeningEvolution' },
    ]);
    expect(converted.warnings.some(w => w.startsWith('아크패시브 해석 못함: 최적화 훈련'))).toBe(false);
  });
  it.each(['condition', 'target'])('still rejects an altered %s instead of applying partial values', change => {
    const node = structuredClone(sources[0]!.node);
    const tooltip = JSON.parse(node.ToolTip);
    const value = Object.values(tooltip).find((e: any) => e.type === 'MultiTextBox') as { value: string };
    value.value = change === 'condition' ? value.value + '<BR>체력이 50% 이하일 때만 적용됩니다.'
      : value.value.replace('각성기, 이동 및 기상기를 제외한 스킬', '각성기');
    node.ToolTip = JSON.stringify(tooltip);
    const converted = buildFromArmory(input(node));
    expect(converted.build.passiveMods.some(m => m.source.startsWith('최적화 훈련'))).toBe(false);
    expect(converted.warnings.some(w => w.startsWith('아크패시브 해석 못함: 최적화 훈련'))).toBe(true);
  });
});
