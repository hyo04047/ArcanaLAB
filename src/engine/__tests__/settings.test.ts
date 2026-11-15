import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { captureSettingBaseline, rebuildSettings, type SettingSelections } from '../settings';
import type { Build } from '../types';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const runeCases = load('tests/fixtures/audit/2026-10-22-master-rune-inputs.json').cases as {
  variant: Build['variant']; inputs: { id: string; raw: RawArmory }[];
}[];
const fourAxis = load('tests/fixtures/audit/2026-10-22-four-axis-inputs.json').inputs as { id: string; raw: RawArmory }[];
const emperor = fourAxis.find(input => input.id === 'base')!.raw;
const gemSwap = [{ targetIndex: 1, sourceIndex: 9 }, { targetIndex: 9, sourceIndex: 1 }];
const runeSwap = (other: string) => [
  { targetSkillId: 'call_of_destiny', sourceSkillId: other },
  { targetSkillId: other, sourceSkillId: 'call_of_destiny' },
];
const normal = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const selections = (fingerprint: string, changes: Partial<SettingSelections> = {}): SettingSelections =>
  ({ baselineFingerprint: fingerprint, ...changes });

function expectedGemSwap(build: Build): Build {
  const result = structuredClone(build);
  const mods = result.passiveMods.filter(mod => mod.bucket === 'cooldown' && ['보석 이보크', '보석 리턴'].includes(mod.source));
  expect(mods.map(mod => [mod.source, mod.value])).toEqual([['보석 이보크', 0.24], ['보석 리턴', 0.2]]);
  mods[0]!.value = 0.2; mods[1]!.value = 0.24;
  return result;
}

// 저장 사례의 27% 트포·14% 질풍·16% 속행과 기준 시전시간으로 전체 기대 입력을 조립합니다.
function expectedRuneSwap(build: Build, variant: Build['variant']): Build {
  const result = structuredClone(build), call = result.skills.find(skill => skill.id === 'call_of_destiny')!;
  const other = result.skills.find(skill => skill.id === (variant === 'empress' ? 'scratch_dealer' : 'return'))!;
  if (variant === 'empress') {
    expect(call.runeCdReduce).toEqual({ chance: 0.2, fraction: 0.16 });
    call.castTime = 0.7 / (1 + 0.27 + 0.14); delete call.runeCdReduce;
    other.castTime = 0.7; other.runeCdReduce = { chance: 0.2, fraction: 0.16 };
  } else {
    expect(other.runeCdReduce).toEqual({ chance: 0.2, fraction: 0.16 });
    call.castTime = 0.7 / (1 + 0.27); call.runeCdReduce = { chance: 0.2, fraction: 0.16 };
    other.castTime = 0.708 / (1 + 0.14); delete other.runeCdReduce;
  }
  return result;
}

function expectMovedRuneWarnings(before: string[], after: string[], variant: Build['variant']): void {
  const oldName = variant === 'empress' ? '운명의 부름' : '리턴';
  const newName = variant === 'empress' ? '스크래치 딜러' : '운명의 부름';
  const moved = before.filter(warning => warning.startsWith(oldName + ' 속행 발동 확률'));
  expect(moved).toHaveLength(1);
  const newWarning = moved[0]!.replace(oldName, newName);
  expect(after).toContain(newWarning); expect(after).not.toContain(moved[0]);
  expect(after.filter(warning => warning !== newWarning)).toEqual(before.filter(warning => warning !== moved[0]));
}

describe('setting rebuild from preserved armory', () => {
  it.each(runeCases)('$variant no-change and rune relocation preserve all unrelated input', async ({ variant, inputs }) => {
    const raw = inputs.find(input => input.id === 'base')!.raw, saved = structuredClone(raw);
    const baseline = await captureSettingBaseline(raw), base = buildFromArmory(raw);
    const unchanged = await rebuildSettings(baseline, selections(baseline.fingerprint));
    expect({ build: unchanged.build, warnings: unchanged.warnings, summary: unchanged.summary }).toEqual(base);
    expect(unchanged.limitations).toEqual([]);
    const changes = selections(baseline.fingerprint, { runes: runeSwap(variant === 'empress' ? 'scratch_dealer' : 'return') });
    const result = await rebuildSettings(baseline, changes);
    expect(result.build).toEqual(expectedRuneSwap(base.build, variant));
    expectMovedRuneWarnings(base.warnings, result.conversionWarnings, variant);
    expect(result.warnings).toEqual([...result.conversionWarnings, ...result.limitations]);
    expect(result.limitations).toHaveLength(1);
    expect(result.equipmentLegality).toBe('unverified');
    // 저장 원본도 현재 모델로 변환합니다. 과거 모델의 Build를 기대값으로 쓰지 않습니다.
    const recorded = buildFromArmory(inputs.find(input => input.id === 'runes')!.raw);
    expect(normal(result.build)).toEqual(normal(recorded.build));
    expect(result.conversionWarnings).toEqual(recorded.warnings);
    expect(await rebuildSettings(baseline, changes)).toEqual(result);
    expect(await rebuildSettings(baseline, selections(baseline.fingerprint))).toEqual(unchanged);
    expect(raw).toEqual(saved); expect(baseline.raw).toEqual(saved);
  });

  it.each(['gems', 'runes-gems'])('%s updates the complete build without changing damage gems', async id => {
    const baseline = await captureSettingBaseline(emperor), base = buildFromArmory(emperor);
    const choices = selections(baseline.fingerprint, { cooldownGems: gemSwap,
      ...(id === 'runes-gems' ? { runes: runeSwap('return') } : {}) });
    const savedChoices = structuredClone(choices), result = await rebuildSettings(baseline, choices);
    const expected = expectedGemSwap(id === 'runes-gems' ? expectedRuneSwap(base.build, 'emperor') : base.build);
    expect(result.build).toEqual(expected);
    if (id === 'runes-gems') expectMovedRuneWarnings(base.warnings, result.conversionWarnings, 'emperor');
    else expect(result.conversionWarnings).toEqual(base.warnings);
    expect(result.summary).toEqual(base.summary);
    const recorded = buildFromArmory(fourAxis.find(input => input.id === id)!.raw);
    expect(result.build).toEqual(recorded.build); expect(result.conversionWarnings).toEqual(recorded.warnings);
    expect(result.limitations).toHaveLength(id === 'runes-gems' ? 2 : 1);
    expect(await rebuildSettings(baseline, choices)).toEqual(result);
    expect((await rebuildSettings(baseline, selections(baseline.fingerprint))).build).toEqual(base.build);
    expect(choices).toEqual(savedChoices); expect(baseline.raw).toEqual(emperor);
  });

  it('keeps core and evolution choices when relocating gems in the combined stored example', async () => {
    const raw = fourAxis.find(input => input.id === 'master-heart-runes')!.raw;
    const baseline = await captureSettingBaseline(raw), base = buildFromArmory(raw);
    const result = await rebuildSettings(baseline, selections(baseline.fingerprint, { cooldownGems: gemSwap }));
    expect(result.build).toEqual(expectedGemSwap(base.build));
    expect(result.build).toEqual(buildFromArmory(fourAxis.find(input => input.id === 'master-heart-runes-gems')!.raw).build);
    expect(result.conversionWarnings).toEqual(base.warnings);
  });

  it('removes a rune and its warning, and restores both from the original', async () => {
    const raw = structuredClone(emperor);
    raw.combatSkills.find(skill => skill.Name === '리턴')!.Rune = { Name: '출혈', Grade: '전설', Tooltip: '적중 시 출혈 상태 부여' };
    const baseline = await captureSettingBaseline(raw), base = buildFromArmory(raw);
    expect(base.warnings.some(warning => warning.includes('룬 출혈'))).toBe(true);
    const result = await rebuildSettings(baseline, selections(baseline.fingerprint,
      { runes: [{ targetSkillId: 'return', sourceSkillId: null }] }));
    expect(result.build).toEqual(base.build);
    expect(result.conversionWarnings).toEqual(base.warnings.filter(warning => !warning.includes('룬 출혈')));
    expect((await rebuildSettings(baseline, selections(baseline.fingerprint))).warnings).toEqual(base.warnings);
  });

  it('keeps unsupported rune warnings when moving a complete recorded object', async () => {
    const raw = structuredClone(emperor);
    raw.combatSkills.find(skill => skill.Name === '리턴')!.Rune = { Name: '출혈', Grade: '전설', Tooltip: '적중 시 출혈 상태 부여' };
    const baseline = await captureSettingBaseline(raw);
    const result = await rebuildSettings(baseline, selections(baseline.fingerprint, { runes: runeSwap('return') }));
    expect(result.warnings).toContain('룬 출혈(도트) 미모델 (call_of_destiny)');
    expect(result.warnings).not.toContain('룬 출혈(도트) 미모델 (return)');
    expect(result.equipmentLegality).toBe('unverified');
  });

  it('distinguishes identical rune records in separate original slots', async () => {
    const raw = structuredClone(emperor), call = raw.combatSkills.find(skill => skill.Name === '운명의 부름')!;
    raw.combatSkills.find(skill => skill.Name === '리턴')!.Rune = structuredClone(call.Rune);
    const baseline = await captureSettingBaseline(raw);
    expect((await rebuildSettings(baseline, selections(baseline.fingerprint, { runes: runeSwap('return') }))).build)
      .toEqual(buildFromArmory(raw).build);
  });

  it('captures all original fields, isolates output edits and freezes each asynchronous request input', async () => {
    const raw = structuredClone(emperor) as RawArmory & { extra: { observation: string } };
    raw.extra = { observation: 'preserve' };
    const captured = captureSettingBaseline(raw);
    raw.extra.observation = 'caller changed';
    const baseline = await captured, saved = structuredClone(baseline);
    expect((baseline.raw as typeof raw).extra.observation).toBe('preserve');
    const choices = selections(baseline.fingerprint, { runes: runeSwap('return') });
    const pending = rebuildSettings(baseline, choices);
    choices.runes![0]!.sourceSkillId = null;
    baseline.raw.profiles.Stats[0]!.Value = '1';
    const result = await pending;
    expect(result.build).toEqual(expectedRuneSwap(buildFromArmory(saved.raw).build, 'emperor'));
    result.build.skills[0]!.castTime = 123;
    expect((await rebuildSettings(saved, selections(saved.fingerprint))).build).toEqual(buildFromArmory(emperor).build);
  });

  it('ignores object key order but detects a changed original and rejects stale choices', async () => {
    const baseline = await captureSettingBaseline(emperor);
    const reordered = Object.fromEntries(Object.entries(emperor).reverse()) as unknown as RawArmory;
    expect((await captureSettingBaseline(reordered)).fingerprint).toBe(baseline.fingerprint);
    baseline.raw.profiles.Stats[0]!.Value = '1';
    await expect(rebuildSettings(baseline, selections(baseline.fingerprint))).rejects.toThrow('원본이 일치하지');
    const refreshed = await captureSettingBaseline(baseline.raw);
    await expect(rebuildSettings(refreshed, selections(baseline.fingerprint))).rejects.toThrow('원본이 일치하지');
  });
});

describe('invalid setting changes are rejected without partial application', () => {
  const invalid: [string, object][] = [
    ['unknown axis', { stats: { swift: 1000 } }],
    ['non-array runes', { runes: {} }],
    ['non-array gems', { cooldownGems: null }],
    ['missing source', { runes: [{ targetSkillId: 'return' }] }],
    ['extra rune grade', { runes: [{ targetSkillId: 'return', sourceSkillId: null, Grade: '유물' }] }],
    ['missing skill', { runes: [{ targetSkillId: 'unknown', sourceSkillId: null }] }],
    ['inactive skill', { runes: [{ targetSkillId: 'scratch_dealer', sourceSkillId: null }] }],
    ['duplicate target', { runes: [runeSwap('return')[0], runeSwap('return')[0]] }],
    ['copied rune still assigned at source', { runes: [runeSwap('return')[0]] }],
    ['damage gem as source', { cooldownGems: [{ targetIndex: 1, sourceIndex: 0 }] }],
    ['damage gem as target', { cooldownGems: [{ targetIndex: 0, sourceIndex: 1 }] }],
    ['missing gem source', { cooldownGems: [{ targetIndex: 1 }] }],
    ['fractional gem index', { cooldownGems: [{ targetIndex: 1.5, sourceIndex: 9 }] }],
    ['negative gem index', { cooldownGems: [{ targetIndex: -1, sourceIndex: 9 }] }],
    ['out-of-range gem index', { cooldownGems: [{ targetIndex: 100, sourceIndex: 9 }] }],
    ['duplicate gem target', { cooldownGems: [gemSwap[0], gemSwap[0]] }],
    ['copied gem still assigned at source', { cooldownGems: [gemSwap[0]] }],
    ['valid rune change with invalid gem change', { runes: runeSwap('return'), cooldownGems: [{ targetIndex: 0, sourceIndex: 1 }] }],
  ];
  it.each(invalid)('%s', async (_label, changes) => {
    const baseline = await captureSettingBaseline(emperor), saved = structuredClone(baseline);
    await expect(rebuildSettings(baseline, selections(baseline.fingerprint, changes))).rejects.toThrow();
    expect(baseline).toEqual(saved);
    expect((await rebuildSettings(baseline, selections(baseline.fingerprint))).build).toEqual(buildFromArmory(emperor).build);
  });

  it.each(['missing tooltip', 'empty tooltip', 'wrong effect', 'missing grade', 'missing rune', 'duplicate skill'])(
    'rejects an incomplete or ambiguous rune source: %s', async failure => {
      const raw = structuredClone(emperor), skill = raw.combatSkills.find(skill => skill.Name === '리턴')!;
      if (failure === 'missing tooltip') delete skill.Rune!.Tooltip;
      if (failure === 'empty tooltip') skill.Rune!.Tooltip = '{}';
      if (failure === 'wrong effect') skill.Rune!.Tooltip = '스킬 시전 속도가 14% 증가';
      if (failure === 'missing grade') skill.Rune!.Grade = '';
      if (failure === 'missing rune') skill.Rune = null;
      if (failure === 'duplicate skill') raw.combatSkills.push(structuredClone(skill));
      const baseline = await captureSettingBaseline(raw);
      await expect(rebuildSettings(baseline, selections(baseline.fingerprint, { runes: runeSwap('return') }))).rejects.toThrow();
      expect(baseline.raw).toEqual(raw);
    });

  it.each([undefined, [], [''], ['재사용 대기시간 100% 감소'], ['재사용 대기시간 1.2.3% 감소'],
    ['재사용 대기시간 20% 감소', '피해 44% 증가']])('rejects an incomplete or mixed cooldown description: %j', async description => {
      const raw = structuredClone(emperor);
      raw.gems!.Effects!.Skills![1]!.Description = description;
      const baseline = await captureSettingBaseline(raw);
      await expect(rebuildSettings(baseline, selections(baseline.fingerprint, { cooldownGems: gemSwap }))).rejects.toThrow();
    });
});
