import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { computeMultipliers } from '../damage';
import { cardsFor } from '../presets';
import { simulate } from '../sim';
import { readSettingInput, regenerateSettingInput } from '../../settingFiles';
import { coreTestPassives } from './core-fixture';
import modelId from 'virtual:arcanalab-model';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-evoke-overlap-sources.json', 'utf8')).official.skill;
const prefix = '이보크 중독·피해 보석:';
const notices = (warnings: string[]) => warnings.filter(w => w.startsWith(prefix));
const dir = 'tests/fixtures/audit/2026-10-31-evoke-warning-compatibility/final/inputs';
function input(poison = true, description = ['피해 44.00% 증가', '재사용 대기시간 24.00% 감소'], name = '이보크'): RawArmory {
  const selected = ['빠른 준비', poison ? '마나 중독' : '집속 마법진', '중첩 마법진'];
  return {
    profiles: JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/profiles.json', 'utf8')),
    combatSkills: [{ ...source, Level: 14, Tripods: source.Tripods.map((t: { Name: string }) => ({ ...t, IsSelected: selected.includes(t.Name) })) }],
    arkpassive: coreTestPassives(true), arkgrid: null, engravings: null,
    gems: { Effects: { Skills: [{ Name: name, Description: description }] } },
  };
}

describe('Evoke poison damage gem provisional exclusion notice', () => {
  it('explains the historical limit without changing direct damage, poison scope or cooldown', () => {
    const result = buildFromArmory(input()), warnings = notices(result.warnings);
    expect(warnings).toHaveLength(1);
    for (const part of ['2022년 멸화', '잠정 제외', '2023년 해외', '중독 틱을 구분하지 않아', '현행 적용 여부는 미확인', '기본 공격력 증가·쿨타임 감소는 별도']) expect(warnings[0]).toContain(part);
    const skill = result.build.skills[0]!, mods = result.build.passiveMods.filter(m => m.source === '보석 이보크');
    const multiplier = (component: 'direct' | 'dot') => computeMultipliers({ atkBase: 100 }, mods, { skill, component, stacks: 0 });
    expect(multiplier('direct').skillDmg).toBeCloseTo(1.44);
    expect(multiplier('dot').skillDmg).toBe(1);
    expect(mods.find(m => m.bucket === 'cooldown')!.value).toBe(0.24);
  });

  it.each([
    ['no poison', () => input(false)],
    ['no gems', () => ({ ...input(), gems: null })],
    ['cooldown only', () => input(true, ['재사용 대기시간 24.00% 감소'])],
    ['another skill', () => input(true, ['피해 44.00% 증가'], '체크메이트')],
    ['zero damage', () => input(true, ['피해 0.00% 증가'])],
    ['unknown damage text', () => input(true, ['치명타 적중 시 피해 44.00% 증가'])],
    ['invalid damage', () => input(true, ['피해 101.00% 증가'])],
    ['no equipped Evoke', () => ({ ...input(), combatSkills: [] })],
  ] as const)('does not claim exclusion for %s', (_label, make) => {
    expect(notices(buildFromArmory(make()).warnings)).toEqual([]);
  });

  it('adds the notice once even with repeated parsed damage lines', () => {
    expect(notices(buildFromArmory(input(true, ['피해 44.00% 증가', '피해 44.00% 증가'])).warnings)).toHaveLength(1);
  });

  it.each(['evoke-2-1-split', 'evoke-2-1-overlap', 'manual-3-2'])('preserves old %s and adds only an input notice on regeneration', async name => {
    const text = readFileSync(`${dir}/${name}.json`, 'utf8'), old = JSON.parse(text);
    const loaded = await readSettingInput(text, name, modelId);
    expect(loaded.status).toBe('model-changed'); expect(loaded.text).toBe(text);
    expect(loaded.build).toEqual(old.build); expect(loaded.warnings).toEqual(old.warnings);
    expect(notices(loaded.warnings!)).toEqual([]);
    const regenerated = await regenerateSettingInput(text, name, modelId), next = regenerated.input;
    expect(next.status).toBe('editable'); expect(next.build).toEqual(loaded.build);
    expect(regenerated.warningsRemoved).toEqual([]);
    expect(regenerated.warningsAdded).toEqual(notices(next.warnings!));
    expect(regenerated.warningsAdded).toHaveLength(1);
    expect(next.warnings!.filter(w => !w.startsWith(prefix))).toEqual(loaded.warnings);
    for (const seed of [1, 42, 20261017]) {
      const config = { durationSec: 10, iterations: 2, seed, randomMode: 'partitioned-v1' as const };
      expect(simulate(next.build, cardsFor(next.build.variant, next.build.deckOverrides), config))
        .toEqual(simulate(loaded.build, cardsFor(loaded.build.variant, loaded.build.deckOverrides), config));
    }
    const reopened = await readSettingInput(next.text, name, modelId);
    expect(reopened.text).toBe(next.text); expect(reopened.warnings).toEqual(next.warnings);
    const tampered = JSON.parse(next.text); tampered.warnings = loaded.warnings;
    await expect(readSettingInput(JSON.stringify(tampered), name, modelId)).rejects.toThrow('일치');
  });
});
