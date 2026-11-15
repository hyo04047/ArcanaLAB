import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { captureSettingBaseline, rebuildSettings, type SettingSelections } from '../settings';
import { applyEvolution, evolutionEffects, evolutionAllocation, type EvolutionChoice } from '../evolutionSettings';
import { readSettingInput, saveSettingInput } from '../../settingFiles';
import { modelIdentity } from '../../../scripts/model_identity';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const cases = load('tests/fixtures/audit/2026-10-22-master-rune-inputs.json').cases as { variant: string; inputs: { id: string; raw: RawArmory }[] }[];
const baseRaw: RawArmory = load('tests/fixtures/audit/2026-10-27-setting-files/current-base.json').setting.baseline.raw;
const master: EvolutionChoice[] = [{ nodeId: 'crush', level: 0 }, { nodeId: 'master', level: 1 }];
const normal = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('evolution selections and known point constraints', () => {
  it.each(cases)('$variant master replacement matches the independently saved raw conversion, with and without rune edits', async ({ variant, inputs }) => {
    const raw = inputs.find(input => input.id === 'base')!.raw, original = structuredClone(raw), baseline = await captureSettingBaseline(raw);
    const selected: SettingSelections = { baselineFingerprint: baseline.fingerprint, evolution: master };
    const rebuilt = await rebuildSettings(baseline, selected);
    const expected = buildFromArmory(inputs.find(input => input.id === 'master')!.raw);
    expect(normal(rebuilt.build)).toEqual(normal(expected.build));
    expect(rebuilt.conversionWarnings).toEqual(expected.warnings);
    expect(rebuilt.limitations.join(' ')).toContain('티어 개방·선행 조건 전체');
    const other = variant === 'empress' ? 'scratch_dealer' : 'return';
    selected.runes = [{ targetSkillId: 'call_of_destiny', sourceSkillId: other }, { targetSkillId: other, sourceSkillId: 'call_of_destiny' }];
    const combined = await rebuildSettings(baseline, selected);
    expect(normal(combined.build)).toEqual(normal(buildFromArmory(inputs.find(input => input.id === 'both')!.raw).build));
    expect(await rebuildSettings(baseline, selected)).toEqual(combined);
    const reset = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint });
    expect(reset.build).toEqual(buildFromArmory(raw).build); expect(reset.limitations).toEqual([]);
    expect(raw).toEqual(original);
  });

  it.each(evolutionEffects)('applies stored $nodeId Lv$level without inventing a tooltip or leaving an unparsed selected effect', async choice => {
    const raw = structuredClone(baseRaw); raw.arkpassive = { Effects: [], Points: [{ Name: '진화', Value: 140 }] };
    const baseline = await captureSettingBaseline(raw);
    const result = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, evolution: [{ nodeId: choice.nodeId, level: choice.level }] });
    const expectedRaw = structuredClone(raw); expectedRaw.arkpassive!.Effects = [choice.effect];
    const expected = buildFromArmory(expectedRaw);
    expect(result.build).toEqual(expected.build);
    expect(result.conversionWarnings).toEqual(expected.warnings);
    expect(result.conversionWarnings.some(warning => warning.startsWith('아크패시브 해석 못함'))).toBe(false);
    expect(result.limitations.join(' ')).toContain('원본 공급 140P');
  });

  it('preserves tier-one stats, enlightenment, leap and opaque armory metadata', () => {
    const raw = structuredClone(baseRaw), before = structuredClone(raw);
    const nonEvolution = raw.arkpassive!.Effects.filter(effect => effect.Name !== '진화');
    const tierOne = evolutionAllocation(raw).filter(item => item.node.tier === 1).map(item => item.effect);
    const result = applyEvolution(raw, master);
    expect(result.tiers.map(tier => tier.limit)).toEqual([40, 30, 20, 20, 30]);
    expect(result.spent).toBe(140); expect(result.available).toBe(140);
    expect(raw.arkpassive!.Effects.filter(effect => effect.Name !== '진화')).toEqual(nonEvolution);
    expect(evolutionAllocation(raw).filter(item => item.node.tier === 1).map(item => item.effect)).toEqual(tierOne);
    expect(raw.profiles).toEqual(before.profiles);
    expect({ ...raw.arkpassive, Effects: [] }).toEqual({ ...before.arkpassive, Effects: [] });
  });

  it.each([
    [{ nodeId: 'master', level: 1 }],
    [{ nodeId: 'limit_break', level: 3 }],
    [{ nodeId: 'chariot', level: 2 }],
    [{ nodeId: 'standing_striker', level: 2 }],
  ])('rejects an overloaded final tier without silently replacing another node: %j', async (...choices) => {
    const baseline = await captureSettingBaseline(baseRaw);
    await expect(rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, evolution: choices })).rejects.toThrow('포인트 초과');
  });

  it.each([-1, 0.5, 2, NaN, Infinity])('rejects invalid Master level %s', async level => {
    const baseline = await captureSettingBaseline(baseRaw);
    await expect(rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, evolution: [{ nodeId: 'master', level }] })).rejects.toThrow('레벨 범위');
  });

  it.each([
    [{ nodeId: 'stat_제압', level: 12 }], [{ nodeId: 'unknown', level: 1 }],
    [{ nodeId: 'master', level: 0 }, { nodeId: 'master', level: 1 }],
    [{ nodeId: 'limit_break', level: 2 }], [{ nodeId: 'timing_mastery', level: 1 }],
    [{ nodeId: 'master', level: 1, tooltip: 'forged' }],
  ])('rejects unsupported, duplicate or forged selections: %j', async (...choices) => {
    const baseline = await captureSettingBaseline(baseRaw);
    await expect(rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, evolution: choices })).rejects.toThrow();
  });

  it('checks total supplied points at the exact boundary and distinguishes an absent budget', () => {
    const raw = structuredClone(baseRaw), original = structuredClone(raw);
    raw.arkpassive!.Points = [{ Name: '진화', Value: 139 }];
    expect(() => applyEvolution(raw, master)).toThrow('총 포인트 초과: 140/139P');
    expect(raw.arkpassive!.Effects).toEqual(original.arkpassive!.Effects);
    raw.arkpassive!.Points = [{ Name: '진화', Value: 140 }];
    expect(applyEvolution(raw, master).spent).toBe(140);
    delete raw.arkpassive!.Points;
    expect(applyEvolution(raw, [{ nodeId: 'master', level: 0 }]).available).toBeNull();
  });

  it.each(['unknown node', 'wrong tier', 'duplicate', 'invalid level', 'invalid budget', 'duplicate budget'])('rejects %s in the original rather than counting it as zero', kind => {
    const raw = structuredClone(baseRaw);
    const effect = raw.arkpassive!.Effects.find(item => item.Description.includes('분쇄'))!;
    if (kind === 'unknown node') effect.Description = '진화 4티어 미확인 노드 Lv.1';
    if (kind === 'wrong tier') effect.Description = '진화 3티어 분쇄 Lv.1';
    if (kind === 'duplicate') raw.arkpassive!.Effects.push(structuredClone(effect));
    if (kind === 'invalid level') effect.Description = '진화 4티어 분쇄 Lv.2';
    if (kind === 'invalid budget') raw.arkpassive!.Points = [{ Name: '진화', Value: -1 }];
    if (kind === 'duplicate budget') raw.arkpassive!.Points = [{ Name: '진화', Value: 140 }, { Name: '진화', Value: 140 }];
    expect(() => applyEvolution(raw, master)).toThrow();
  });

  it('saves and validates the combined choices and refuses altered derived input', async () => {
    const baseline = await captureSettingBaseline(baseRaw), modelId = modelIdentity(process.cwd());
    const choices = { baselineFingerprint: baseline.fingerprint, evolution: master,
      cooldownGems: [{ targetIndex: 1, sourceIndex: 9 }, { targetIndex: 9, sourceIndex: 1 }] };
    const text = await saveSettingInput(baseline, choices, modelId);
    const read = await readSettingInput(text, '동시 변경', modelId);
    expect(read.status).toBe('editable'); expect(read.setting!.selections).toEqual(choices);
    const bad = JSON.parse(text); bad.setting.selections.evolution = [];
    await expect(readSettingInput(JSON.stringify(bad), '변조', modelId)).rejects.toThrow('일치하지 않습니다');
  });
});
