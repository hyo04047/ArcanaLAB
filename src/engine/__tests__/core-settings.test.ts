import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { applyCores, coreChoices, coreSlotInfo } from '../coreSettings';
import { captureSettingBaseline, rebuildSettings, type SettingSelections } from '../settings';
import { readSettingInput, saveSettingInput } from '../../settingFiles';
import modelId from 'virtual:arcanalab-model';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const cases = load('tests/fixtures/audit/2026-10-22-master-rune-inputs.json').cases as { variant: string; inputs: { id: string; raw: RawArmory }[] }[];
const emperor = cases.find(item => item.variant === 'emperor')!.inputs.find(item => item.id === 'base')!.raw;
const heart = coreChoices.find(item => item.slot.Name.endsWith(' : 황제의 심장'))!;
const selections = { cores: [{ targetIndex: 1, choiceId: heart.id }], coreGemMode: 'individual-approximation' as const };
const rebuild = async (raw: RawArmory, edits: Partial<SettingSelections>) => {
  const baseline = await captureSettingBaseline(raw);
  return rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...edits });
};

describe('observed core, grade, point and gem bundles', () => {
  it.each(coreChoices)('checks source, points and willpower: $slot.Name $slot.Grade $slot.Point', choice => {
    const bytes = readFileSync(choice.source.path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(choice.source.sha256);
    let source = JSON.parse(bytes.toString('utf8'));
    for (const key of choice.source.location.replace(/\[(\d+)\]/g, '.$1').split('.')) {
      if (typeof source === 'string') source = JSON.parse(source);
      source = source[key];
    }
    expect(source).toEqual(choice.slot);
    const info = coreSlotInfo(choice.slot);
    expect(info.points).toBe(choice.slot.Point); expect(info.spent).toBeLessThanOrEqual(info.supply);
  });

  describe.each(cases)('$variant', ({ variant, inputs }) => {
    const raw = inputs.find(item => item.id === 'base')!.raw;
    it.each(coreChoices.filter(item => item.variant === variant || item.variant === 'common_chaos'))('matches an independent full-slot replacement: $slot.Name $slot.Point', async choice => {
      const expected = structuredClone(raw), before = structuredClone(raw);
      const old = expected.arkgrid!.Slots.findIndex(slot => slot.Index === choice.slot.Index);
      const changed = JSON.stringify(expected.arkgrid!.Slots[old]) !== JSON.stringify(choice.slot);
      expected.arkgrid!.Slots[old] = structuredClone(choice.slot);
      if (changed) delete expected.arkgrid!.Effects;
      const result = await rebuild(raw, { cores: [{ targetIndex: choice.slot.Index, choiceId: choice.id }], coreGemMode: 'individual-approximation' });
      const independent = buildFromArmory(expected);
      expect(result.build).toEqual(independent.build); expect(result.conversionWarnings).toEqual(independent.warnings);
      expect(result.build.variant).toBe(variant); expect(raw).toEqual(before);
    });
  });

  it('requires explicit approximation and replaces stale totals and former core effects', async () => {
    await expect(rebuild(emperor, { cores: selections.cores })).rejects.toThrow('개별 합산 근사');
    const result = await rebuild(emperor, selections);
    expect(result.build.stackHold).toBeUndefined(); expect(result.build.emperorHeartChance).toBe(0.18);
    expect(result.build.passiveMods.some(mod => mod.source.startsWith('스택 홀드'))).toBe(false);
    expect(result.build.passiveMods.filter(mod => mod.source.startsWith('젬')).every(mod => mod.source.includes('개별 합산 근사'))).toBe(true);
    expect(result.build.passiveMods.find(mod => mod.source === '황제의 심장 17P')!.value).toBe(0.15);
    expect(result.limitations.join(' ')).toContain('기존 공식 젬 합계를 무효화');
    expect(result.warnings.some(warning => warning.includes('황제의 심장 14P') && warning.includes('첫 시전'))).toBe(true);
    expect(await rebuild(emperor, selections)).toEqual(result);
    expect((await rebuild(emperor, {})).build).toEqual(buildFromArmory(emperor).build);
  });

  it.each(['grade', 'point', 'willpower', 'unknown-active', 'duplicate-gem', 'missing-effect', 'conditional-effect', 'cost-arithmetic'])('rejects ambiguous original gem state: %s', async change => {
    const raw = structuredClone(emperor), slot = raw.arkgrid!.Slots[0]!;
    if (change === 'grade') slot.Grade = '유물';
    if (change === 'point') slot.Point++;
    if (change === 'willpower') slot.Tooltip = slot.Tooltip!.replace(/17<\/FONT> 포인트/, '0</FONT> 포인트');
    if (change === 'unknown-active') delete slot.Gems![0]!.IsActive;
    if (change === 'duplicate-gem') slot.Gems![1]!.Index = slot.Gems![0]!.Index;
    if (change === 'missing-effect') slot.Gems![0]!.Tooltip = '';
    if (change === 'conditional-effect') slot.Gems![0]!.Tooltip = slot.Gems![0]!.Tooltip!.replace('공격력 +', '조건 충족 시 공격력 +');
    if (change === 'cost-arithmetic') slot.Gems![0]!.Tooltip = slot.Gems![0]!.Tooltip!.replace(/기본 값 \d+/, '기본 값 99');
    await expect(rebuild(raw, selections)).rejects.toThrow();
  });

  it('excludes inactive gems while rejecting unknown status and preserves a same-bundle no-op', async () => {
    const slot = structuredClone(heart.slot), gem = slot.Gems[0]!;
    const oldPoints = coreSlotInfo(slot).points;
    const point = Number(gem.Tooltip.match(/질서 포인트 : (?:<[^>]*>)*(\d+)/)![1]);
    gem.IsActive = false; slot.Point = oldPoints - point;
    expect(coreSlotInfo(slot).points).toBe(oldPoints - point);
    const raw = structuredClone(emperor); raw.arkgrid!.Slots[1] = structuredClone(heart.slot);
    const before = structuredClone(raw);
    expect(applyCores(raw, selections.cores).changed).toBe(false); expect(raw).toEqual(before);
  });

  it.each([null, {}, [null], [{ targetIndex: 1.5, choiceId: heart.id }]])('rejects malformed core choices: %j', async cores => {
    await expect(rebuild(emperor, { cores } as unknown as Partial<SettingSelections>)).rejects.toThrow();
  });
  it.each(['official', null, true])('rejects unsupported aggregation mode: %s', async coreGemMode => {
    await expect(rebuild(emperor, { ...selections, coreGemMode } as unknown as Partial<SettingSelections>)).rejects.toThrow();
  });

  it.each(['wrong-slot', 'opposing-family', 'unknown-id', 'duplicate', 'forged-point', 'missing-prerequisite'])('rejects unsupported choices: %s', async change => {
    const raw = structuredClone(emperor), edits = structuredClone(selections);
    if (change === 'wrong-slot') edits.cores[0]!.targetIndex = 0;
    if (change === 'opposing-family') edits.cores[0]!.choiceId = coreChoices.find(item => item.variant === 'empress' && item.slot.Index === 1)!.id;
    if (change === 'unknown-id') edits.cores[0]!.choiceId = 'unknown';
    if (change === 'duplicate') edits.cores.push(structuredClone(edits.cores[0]!));
    if (change === 'forged-point') Object.assign(edits.cores[0]!, { point: 20 });
    if (change === 'missing-prerequisite') raw.arkpassive!.Effects = raw.arkpassive!.Effects.filter(effect => !effect.Description.includes('또 다른 황제'));
    await expect(rebuild(raw, edits)).rejects.toThrow();
  });

  it('round-trips all previously connected axes and rejects changed choices, aggregates and checks', async () => {
    const previous = load('tests/fixtures/audit/2026-10-27-enlightenment-settings/browser-combined.json');
    const text = await saveSettingInput(previous.setting.baseline, { ...previous.setting.selections, ...selections }, modelId);
    const result = await readSettingInput(text, 'combined', modelId), saved = JSON.parse(text);
    expect(result.status).toBe('editable'); expect(result.build.stats).toEqual(previous.build.stats);
    expect(saved.setting.baseline).toEqual(previous.setting.baseline);
    for (const mutate of [(x: typeof saved) => { x.build.passiveMods.find((m: { source: string }) => m.source.startsWith('젬')).value = 1; },
      (x: typeof saved) => { delete x.setting.selections.coreGemMode; },
      (x: typeof saved) => { x.setting.checks.limitations = []; }]) {
      const changed = structuredClone(saved); mutate(changed);
      await expect(readSettingInput(JSON.stringify(changed), 'tampered', modelId)).rejects.toThrow();
    }
    const copy = structuredClone(emperor); applyCores(copy, selections.cores, selections.coreGemMode);
    expect(copy.arkgrid).not.toHaveProperty('Effects'); expect(emperor.arkgrid).toHaveProperty('Effects');
  });
});
