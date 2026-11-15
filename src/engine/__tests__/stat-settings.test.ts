import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { captureSettingBaseline, rebuildSettings, type SettingSelections } from '../settings';
import { applyStatSelections } from '../statSettings';
import { readSettingInput, saveSettingInput } from '../../settingFiles';
import { modelIdentity } from '../../../scripts/model_identity';

const load = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const base: RawArmory = load('tests/fixtures/audit/2026-10-27-evolution-settings/browser-base.json').setting.baseline.raw;
const cases = load('tests/fixtures/audit/2026-10-22-master-rune-inputs.json').cases as { variant: string; inputs: { id: string; raw: RawArmory }[] }[];
const shift = [{ nodeId: 'stat_치명', level: 11 }, { nodeId: 'stat_신속', level: 29 }];
const selections = async (raw: RawArmory, edits: Partial<SettingSelections>) => {
  const baseline = await captureSettingBaseline(raw);
  return rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...edits });
};
const value = (build: ReturnType<typeof buildFromArmory>['build'], source: string, bucket: string) =>
  build.passiveMods.find(mod => mod.source === source && mod.bucket === bucket)!.value;

describe('final stats and evolution tier one', () => {
  it.each(cases)('reallocates $variant tier-one stats once, matches an independently prepared input, and preserves the baseline', async ({ variant, inputs }) => {
    const raw = inputs.find(input => input.id === 'base')!.raw, before = structuredClone(raw), expected = structuredClone(raw);
    const from = variant === 'empress' ? '특화' : '신속', oldCrit = variant === 'empress' ? 7 : 10;
    const changes = [{ nodeId: 'stat_치명', level: oldCrit + 1 }, { nodeId: `stat_${from}`, level: 29 }];
    for (const [name, delta] of [['치명', 50], [from, -50]] as const) {
      const stat = expected.profiles.Stats.find(item => item.Type === name)!;
      stat.Value = String(Number(stat.Value) + delta); delete stat.Tooltip;
      const effect = expected.arkpassive!.Effects.find(item => item.Name === '진화' && item.Description.includes(`${name} Lv.`))!;
      effect.Description = `진화 1티어 ${name} Lv.${name === '치명' ? oldCrit + 1 : 29}`; delete effect.ToolTip;
    }
    const result = await selections(raw, { evolution: changes }), independent = buildFromArmory(expected);
    expect(result.build).toEqual(independent.build); expect(result.conversionWarnings).toEqual(independent.warnings);
    expect(result.build.stats.crit).toBe(Number(before.profiles.Stats.find(item => item.Type === '치명')!.Value) + 50);
    expect(value(result.build, '치명', 'critRate')).toBeCloseTo(result.build.stats.crit * 25 / 69900, 14);
    if (variant === 'emperor') {
      expect(result.build.stats.swift).toBe(1777);
      expect(value(result.build, '신속', 'atkSpeed')).toBeCloseTo(1777 * 12 / 69900, 14);
      expect(value(result.build, '신속', 'moveSpeed')).toBeCloseTo(1777 * 12 / 69900, 14);
      expect(value(result.build, '신속', 'cooldown')).toBeCloseTo(1777 * 15 / 69900, 14);
      expect(value(result.build, '특화(루인)', 'skillDmg')).toBe(0.0375);
    } else {
      expect(result.build.stats.spec).toBe(1685);
      expect(value(result.build, '특화(루인)', 'skillDmg')).toBeCloseTo(1685 * 35 / 69900, 14);
      expect(value(result.build, '특화(각성)', 'skillDmg')).toBeCloseTo(1685 * 15.28 / 69900, 14);
      const otherGaugeBonus = buildFromArmory(before).build.params!.gaugeGainBonus! - 0.6205;
      expect(result.build.params!.gaugeGainBonus).toBeCloseTo(otherGaugeBonus + 1685 * 25 / 69900, 14);
      expect(value(result.build, '신속', 'cooldown')).toBe(0.0487);
    }
    expect(result.limitations.join(' ')).toContain('근사식');
    expect(await selections(raw, { evolution: changes })).toEqual(result);
    expect((await selections(raw, {})).build).toEqual(buildFromArmory(raw).build);
    expect(raw).toEqual(before);
  });

  it('recalculates all three specialization effects and keeps other displayed effects unchanged', async () => {
    const before = buildFromArmory(base).build, result = await selections(base, { stats: { spec: 200 } });
    expect(result.build.stats).toEqual({ crit: 644, spec: 200, swift: 1827 });
    expect(value(result.build, '특화(루인)', 'skillDmg')).toBeCloseTo(200 * 35 / 69900, 14);
    expect(value(result.build, '특화(각성)', 'skillDmg')).toBeCloseTo(200 * 15.28 / 69900, 14);
    expect(result.build.params!.gaugeGainBonus).toBeCloseTo(200 * 25 / 69900, 14);
    expect(result.build.passiveMods.filter(mod => !mod.source?.startsWith('특화'))).toEqual(before.passiveMods.filter(mod => !mod.source?.startsWith('특화')));
    expect(result.conversionWarnings.filter(warning => warning.startsWith('전투 특성 툴팁 미확인:'))).toHaveLength(3);
  });

  it('treats explicit totals as inclusive of new nodes, without adding tier-one contributions again', async () => {
    const result = await selections(base, { evolution: shift, stats: { crit: 700, spec: 200, swift: 1800 } });
    expect(result.build.stats).toEqual({ crit: 700, spec: 200, swift: 1800 });
    expect(result.conversionWarnings.filter(warning => warning.startsWith('전투 특성 툴팁 미확인:'))).toHaveLength(7);
  });

  it('keeps original displayed precision when the final total is unchanged despite an allocation edit', async () => {
    const result = await selections(base, { evolution: shift, stats: { crit: 644, swift: 1827 } });
    expect(result.build).toEqual(buildFromArmory(base).build);
    expect(result.conversionWarnings).toEqual(buildFromArmory(base).warnings);
    expect(result.limitations.some(warning => warning.includes('근사식'))).toBe(false);
  });

  it('adds a previously absent supported node and allows zero after removing its contribution', async () => {
    const added = await selections(base, { evolution: [{ nodeId: 'stat_치명', level: 9 }, { nodeId: 'stat_특화', level: 1 }] });
    expect(added.build.stats).toEqual({ crit: 594, spec: 125, swift: 1827 });
    const removed = await selections(base, { evolution: [{ nodeId: 'stat_치명', level: 0 }], stats: { crit: 0 } });
    expect(removed.build.stats.crit).toBe(0); expect(value(removed.build, '치명', 'critRate')).toBe(0);
  });

  it.each([undefined, '치명이 501 증가합니다.', '체력이 낮을 때 치명이 500 증가합니다.',
    JSON.stringify(['치명이 500 증가합니다.', '치명이 1000 증가합니다.'])])('requires an explicit final total when the old contribution is unverified: %s', async tooltip => {
    const raw = structuredClone(base);
    raw.arkpassive!.Effects.find(item => item.Name === '진화' && item.Description.includes('치명 Lv.'))!.ToolTip = tooltip;
    await expect(selections(raw, { evolution: shift })).rejects.toThrow('최종 총합을 직접 지정');
    const result = await selections(raw, { evolution: shift, stats: { crit: 694 } });
    expect(result.build.stats.crit).toBe(694);
  });

  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid final totals: %s', async crit => {
    await expect(selections(base, { stats: { crit } })).rejects.toThrow('정수');
  });
  it.each([null, [], { attack: 1 }, { crit: '700' }, { crit: undefined }])('rejects forged stat fields or values: %j', async stats => {
    await expect(selections(base, { stats } as unknown as Partial<SettingSelections>)).rejects.toThrow();
  });
  it.each([
    { evolution: [{ nodeId: 'stat_치명', level: 11 }] },
    { evolution: [{ nodeId: 'stat_치명', level: 31 }, { nodeId: 'stat_신속', level: 9 }] },
    { evolution: shift, stats: { crit: 549 } },
    { stats: { crit: 0 } }, { stats: { swift: 4660 } },
    { evolution: [{ nodeId: 'stat_인내', level: 1 }] },
    { evolution: [{ nodeId: 'stat_치명', level: 0 }, { nodeId: 'stat_치명', level: 10 }] },
  ])('rejects invalid points, levels, contribution totals or unsupported effects: %j', async edits => {
    await expect(selections(base, edits)).rejects.toThrow();
  });

  it.each(['missing', 'duplicate', 'negative', 'fraction', 'less than contribution'])('refuses ambiguous automatic profile totals: %s', async kind => {
    const raw = structuredClone(base), entry = raw.profiles.Stats.find(item => item.Type === '치명')!;
    if (kind === 'missing') raw.profiles.Stats = raw.profiles.Stats.filter(item => item !== entry);
    if (kind === 'duplicate') raw.profiles.Stats.push(structuredClone(entry));
    if (kind === 'negative') entry.Value = '-1';
    if (kind === 'fraction') entry.Value = '644.5';
    if (kind === 'less than contribution') entry.Value = '499';
    await expect(selections(raw, { evolution: shift })).rejects.toThrow();
  });

  it('requires a source for automatic node linkage, but allows an explicit synthetic total', async () => {
    const raw = structuredClone(base); raw.arkpassive = null;
    await expect(selections(raw, { evolution: [{ nodeId: 'stat_치명', level: 1 }] })).rejects.toThrow('원본 진화 정보');
    expect((await selections(raw, { stats: { crit: 700 } })).build.stats.crit).toBe(700);
  });

  it('changes only the selected profile tooltip in the copy', () => {
    const raw = structuredClone(base), before = structuredClone(raw);
    applyStatSelections(raw, { spec: 200 }, []);
    const original = before.profiles.Stats.find(item => item.Type === '특화')!;
    original.Value = '200'; delete original.Tooltip;
    expect(raw).toEqual(before);
  });

  it('round-trips combined choices and refuses tampered totals or derived effects', async () => {
    const baseline = await captureSettingBaseline(base), modelId = modelIdentity(process.cwd());
    const edits = { baselineFingerprint: baseline.fingerprint, stats: { spec: 200 }, evolution: shift,
      runes: [{ targetSkillId: 'call_of_destiny', sourceSkillId: 'return' }, { targetSkillId: 'return', sourceSkillId: 'call_of_destiny' }],
      cooldownGems: [{ targetIndex: 1, sourceIndex: 9 }, { targetIndex: 9, sourceIndex: 1 }] };
    const text = await saveSettingInput(baseline, edits, modelId), read = await readSettingInput(text, '변경', modelId);
    expect(read.status).toBe('editable'); expect(read.setting!.selections).toEqual(edits);
    const bad = JSON.parse(text); bad.setting.selections.stats.spec++;
    await expect(readSettingInput(JSON.stringify(bad), '변조', modelId)).rejects.toThrow('일치하지 않습니다');
    delete bad.setting.selections.stats; bad.build.stats.spec = 75;
    await expect(readSettingInput(JSON.stringify(bad), '옛 효과', modelId)).rejects.toThrow('일치하지 않습니다');
  });
});
