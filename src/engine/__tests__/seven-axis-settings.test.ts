import { describe, expect, it } from 'vitest';
import { buildFromArmory } from '../armory';
import { captureSettingBaseline, rebuildSettings, type SettingSelections } from '../settings';
import { readSettingInput, saveSettingInput } from '../../settingFiles';
import { caseIds, sevenAxisCase, independentRaw, representativeSubsets, selectAxes, normal } from '../../../scripts/seven_axis_cases';
import modelId from 'virtual:arcanalab-model';

describe.each(caseIds)('representative concurrent settings: %s', id => {
  const scenario = sevenAxisCase(id);
  it.each(representativeSubsets(scenario.availableAxes).map(selected => [selected.join('+') || 'baseline', selected] as const))('%s matches independent raw effects', async (_, selected) => {
    const raw = structuredClone(scenario.raw), before = structuredClone(raw), edits = selectAxes(scenario.edits, selected);
    const baseline = await captureSettingBaseline(raw), selections = { baselineFingerprint: baseline.fingerprint, ...edits };
    const actual = await rebuildSettings(baseline, selections), expected = buildFromArmory(independentRaw(raw, edits));
    expect(normal(actual.build)).toEqual(normal(expected.build));
    expect(actual.conversionWarnings).toEqual(expected.warnings);
    expect(actual.equipmentLegality).toBe('unverified'); expect(actual.build.variant).toBe(scenario.variant);
    expect(raw).toEqual(before); expect(baseline.raw).toEqual(before);
    const reordered = Object.fromEntries(Object.entries(selections).reverse().map(([key, value]) => [key, Array.isArray(value) ? [...value].reverse() : value])) as unknown as SettingSelections;
    expect(await rebuildSettings(baseline, reordered)).toEqual(actual);
  });

  it('keeps inclusive stat totals, changed rotation, core and gem attack separate', async () => {
    const baseline = await captureSettingBaseline(scenario.raw);
    const result = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...scenario.edits });
    expect(result.build.stats.crit).toBe(700);
    const oldSwift = Number(scenario.raw.profiles.Stats.find(s => s.Type === '신속')!.Value);
    expect(result.build.stats.swift).toBe(oldSwift - 50);
    const call = result.build.skills.find(s => s.id === 'call_of_destiny')!;
    if (scenario.variant === 'emperor') {
      expect(call.kind).toBe('stack'); expect(call.stacksGranted).toBe(2);
      expect(result.build.rotation.fillers).not.toContain('call_of_destiny');
      expect(result.build.emperorHeartChance).toBe(0.18); expect(result.build.stackHold).toBeUndefined();
      expect(result.build.params.atkBase).toBe(222811 * 112 / 112.4);
      expect(result.build.passiveMods.find(m => m.source === '보석 황제')!.value).toBe(0.36);
    } else {
      expect(call.kind).toBe('normal'); expect(call.hits).toBe(3); expect(result.build.rotation.finisher).toBeUndefined();
    }
    const withoutGems = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint,
      ...selectAxes(scenario.edits, scenario.availableAxes.filter(axis => axis !== 'gems')) });
    expect(result.build.passiveMods.filter(m => m.bucket === 'atk' || m.bucket === 'atkFlat'))
      .toEqual(withoutGems.build.passiveMods.filter(m => m.bucket === 'atk' || m.bucket === 'atkFlat'));
    expect(result.limitations.join(' ')).toContain('사용 포인트 미확인');
    expect(result.limitations.join(' ')).toContain('최종 총합');
    if (scenario.edits.gems) {
      expect(result.limitations.join(' ')).toContain('비율 환산 근사');
      expect(result.limitations.join(' ')).not.toContain('프로필의 기본 공격력은 유지');
    }
  });

  it('round-trips the complete selection and rejects stale calculation and forged legality', async () => {
    const baseline = await captureSettingBaseline(scenario.raw), selections = { baselineFingerprint: baseline.fingerprint, ...scenario.edits };
    const text = await saveSettingInput(baseline, selections, modelId, scenario.source);
    const read = await readSettingInput(text, id, modelId), saved = JSON.parse(text);
    expect(read.status).toBe('editable'); expect(saved.setting.selections).toEqual(selections);
    expect(saved.setting.source).toEqual(scenario.source);
    const stale = structuredClone(saved); stale.build.stats.crit = 750;
    await expect(readSettingInput(JSON.stringify(stale), '중복 특성', modelId)).rejects.toThrow('일치하지');
    saved.setting.checks.equipmentLegality = 'verified';
    await expect(readSettingInput(JSON.stringify(saved), '장착 인증 위조', modelId)).rejects.toThrow('형식');
    const original = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint });
    expect(normal(original.build)).toEqual(normal(buildFromArmory(scenario.raw).build));
  });
});

describe('concurrent equipment boundary and rollback', () => {
  const scenario = sevenAxisCase('emperor');
  it.each(['rune-copy', 'tier-budget', 'stat-contribution', 'main-path', 'core-family', 'core-mode', 'tripod-duplicate', 'gem-mode', 'gem-late-invalid', 'mixed-gems'])('rejects %s without touching the baseline and recovers', async kind => {
    const baseline = await captureSettingBaseline(scenario.raw), before = structuredClone(baseline);
    const valid = { baselineFingerprint: baseline.fingerprint, ...structuredClone(scenario.edits) };
    const invalid = structuredClone(valid);
    if (kind === 'rune-copy') invalid.runes!.pop();
    if (kind === 'tier-budget') invalid.evolution!.find(c => c.nodeId === 'stat_치명')!.level = 30;
    if (kind === 'stat-contribution') invalid.stats!.crit = 549;
    if (kind === 'main-path') invalid.enlightenment = [{ nodeId: 'emperor_decree', level: 1 }];
    if (kind === 'core-family') invalid.cores = sevenAxisCase('empress').edits.cores;
    if (kind === 'core-mode') delete invalid.coreGemMode;
    if (kind === 'tripod-duplicate') invalid.tripods!.push(structuredClone(invalid.tripods![0]!));
    if (kind === 'gem-mode') delete invalid.gemAttackMode;
    if (kind === 'gem-late-invalid') invalid.gems![0]!.choiceId = 'unknown';
    if (kind === 'mixed-gems') invalid.cooldownGems = [{ targetIndex: 1, sourceIndex: 1 }];
    await expect(rebuildSettings(baseline, invalid)).rejects.toThrow();
    expect(baseline).toEqual(before);
    const recovered = await rebuildSettings(baseline, valid);
    expect(normal(recovered.build)).toEqual(normal(buildFromArmory(independentRaw(scenario.raw, scenario.edits)).build));
  });

  it('does not certify missing budgets or unsupported current-game equipment rules', async () => {
    const raw = structuredClone(scenario.raw);
    raw.arkpassive!.Points = [];
    const baseline = await captureSettingBaseline(raw);
    const result = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...scenario.edits });
    expect(result.equipmentLegality).toBe('unverified');
    expect(result.limitations.join(' ')).toContain('원본 공급 미확인');
    expect(result.limitations.join(' ')).toContain('전체 장착 규칙');
  });

  it.each(['evolution-supply', 'core-activation', 'core-points', 'gem-total'])('retains %s checks with all axes selected', async kind => {
    const raw = structuredClone(scenario.raw);
    if (kind === 'evolution-supply') raw.arkpassive!.Points!.find(p => p.Name === '진화')!.Value = 1;
    if (kind === 'core-activation') raw.arkpassive!.Effects = raw.arkpassive!.Effects.filter(e => !e.Description.includes('또 다른 황제'));
    if (kind === 'core-points') raw.arkgrid!.Slots[0]!.Point++;
    if (kind === 'gem-total') raw.gems!.Effects!.Description = '기본 공격력 총합 : 12.50%';
    const baseline = await captureSettingBaseline(raw), before = structuredClone(baseline);
    await expect(rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...scenario.edits })).rejects.toThrow();
    expect(baseline).toEqual(before);
  });

  it('leaves zero enlightenment supply unverified when costs are unknown, rather than certifying affordability', async () => {
    const raw = structuredClone(scenario.raw);
    raw.arkpassive!.Points!.find(p => p.Name === '깨달음')!.Value = 0;
    const baseline = await captureSettingBaseline(raw);
    const result = await rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...scenario.edits });
    expect(result.equipmentLegality).toBe('unverified');
    expect(result.limitations.join(' ')).toContain('사용 포인트 미확인 / 원본 공급 0P');
  });

  it('rejects a seventh gem axis on the empress official baseline instead of inventing evidence', async () => {
    const empress = sevenAxisCase('empress'), baseline = await captureSettingBaseline(empress.raw);
    await expect(rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...empress.edits,
      ...selectAxes(sevenAxisCase('empress-synthetic-gem').edits, ['gems']) })).rejects.toThrow('개별 보석');
  });
});
