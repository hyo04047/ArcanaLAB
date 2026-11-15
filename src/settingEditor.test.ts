import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settingRows, chooseSettingOption, settingHtml } from './settingEditor';
import { readSettingInput, saveSettingInput, type SavedSetting } from './settingFiles';
import { captureSettingBaseline } from './engine/settings';
import { cardSupplyWarnings } from './engine/cards';
import type { Build } from './engine';
import type { RawArmory } from './engine/armory';
import modelId from 'virtual:arcanalab-model';

const load = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const base = load('tests/fixtures/audit/2026-10-27-setting-files/current-base.json') as { setting: SavedSetting; build: Build; warnings: string[] };
const changed = load('tests/fixtures/audit/2026-10-27-setting-files/current-changed.json');
// 과거 파일과 룬·보석 기대 입력은 보존하고 카드·게이지 후보 변경만 반영합니다.
for (const saved of [base, changed]) {
  saved.setting.compiledWith = modelId;
  saved.build.params.cardDamageCoef = { emperor: 72.395, empress_knight: 120.65 };
  saved.build.params.cardDamageFlat = { emperor: 7791, empress_knight: 12984.5 };
  saved.build.params.gaugeFactors = { specialization: 0.0268, greed: 0 };
  const gaugeWarning = cardSupplyWarnings(saved.build).find(w => w.startsWith('카드 게이지 조합'))!;
  const warning = cardSupplyWarnings(saved.build).find(w => w.startsWith('황제·황후의 기사 기본 피해'))!;
  saved.warnings = saved.warnings.filter((w: string) => !/^황제 카드 기본 피해 계수|^황후의 기사 기본 피해 계수/.test(w))
    .map((w: string) => w.startsWith('황제·황후의 기사 피해는 기준') ? warning
      : w.startsWith('특화·패시브 게이지 증가는 합산') ? gaugeWarning : w);
  const supply = cardSupplyWarnings(saved.build), start = saved.warnings.indexOf(supply[0]!);
  saved.build.skills.find((s: { id: string }) => s.id === 'evoke')!.evokeGauge = { candidate: 'evoke-split', perHit: [.1196], warningVersion: 2 };
  saved.warnings.splice(start, supply.length, ...cardSupplyWarnings(saved.build));
}

describe('setting selection controls', () => {
  it('swaps original rune objects and cooldown effects, matching the saved independent example', async () => {
    const before = structuredClone(base);
    const runes = chooseSettingOption(base.setting, base.build, base.setting.selections, 'runes', 'call_of_destiny', 'return');
    const both = chooseSettingOption(base.setting, base.build, runes, 'cooldownGems', '1', '9');
    const input = JSON.parse(await saveSettingInput(base.setting.baseline, both, modelId, base.setting.source));
    expect(input).toEqual(changed);
    expect(base).toEqual(before);
  });

  it('removes, reassigns and restores runes without duplicating a source', async () => {
    let draft = chooseSettingOption(base.setting, base.build, base.setting.selections, 'runes', 'return', '');
    let input = await readSettingInput(await saveSettingInput(base.setting.baseline, draft, modelId), '제거', modelId);
    expect(input.build.skills.find(skill => skill.id === 'return')!.runeCdReduce).toBeUndefined();
    draft = chooseSettingOption(base.setting, base.build, draft, 'runes', 'call_of_destiny', 'return');
    expect(settingRows(base.setting, base.build, draft).runes.filter(row => row.value === 'return')).toHaveLength(1);
    draft = chooseSettingOption(base.setting, base.build, draft, 'runes', 'call_of_destiny', 'call_of_destiny');
    draft = chooseSettingOption(base.setting, base.build, draft, 'runes', 'return', 'return');
    input = await readSettingInput(await saveSettingInput(base.setting.baseline, draft, modelId), '복원', modelId);
    expect(input.build).toEqual(base.build);
    expect(draft).toEqual(base.setting.selections);
  });

  it('repeated swaps use the current placement and a reverse swap restores the baseline', () => {
    const a = chooseSettingOption(base.setting, base.build, base.setting.selections, 'cooldownGems', '1', '9');
    const b = chooseSettingOption(base.setting, base.build, a, 'cooldownGems', '9', '9');
    expect(b).toEqual(base.setting.selections);
    const c = chooseSettingOption(base.setting, base.build, a, 'cooldownGems', '1', '1');
    expect(c).toEqual(base.setting.selections);
  });

  it('offers only active skills and complete cooldown effects, not damage gems or invented sources', () => {
    const rows = settingRows(base.setting, base.build);
    expect(rows.runes.map(row => row.key).sort()).toEqual(base.build.skills.map(skill => skill.id).sort());
    expect(rows.cooldownGems.map(row => row.key)).toEqual(['1', '3', '5', '6', '8', '9']);
    expect(() => chooseSettingOption(base.setting, base.build, base.setting.selections, 'cooldownGems', '1', '0')).toThrow('지원하는');
    expect(() => chooseSettingOption(base.setting, base.build, base.setting.selections, 'runes', 'missing', 'return')).toThrow('지원하는');
    expect(() => chooseSettingOption(base.setting, base.build, base.setting.selections, 'runes', 'return', 'missing')).toThrow('지원하는');
  });

  it('keeps an incomplete original rune in place but requires removal before replacing it with an occupied rune', async () => {
    const raw = structuredClone(base.setting.baseline.raw);
    raw.combatSkills.find(skill => skill.Name === '운명의 부름')!.Rune!.Tooltip = '';
    const baseline = await captureSettingBaseline(raw);
    const saved = JSON.parse(await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId));
    const rows = settingRows(saved.setting, saved.build);
    expect(rows.runes.find(row => row.key === 'call_of_destiny')!.options.some(option => option.value === 'call_of_destiny')).toBe(true);
    expect(rows.runes.find(row => row.key === 'return')!.options.some(option => option.value === 'call_of_destiny')).toBe(false);
    expect(() => chooseSettingOption(saved.setting, saved.build, saved.setting.selections, 'runes', 'call_of_destiny', 'return')).toThrow('먼저 제거');
    const removed = chooseSettingOption(saved.setting, saved.build, saved.setting.selections, 'runes', 'call_of_destiny', '');
    const relocated = chooseSettingOption(saved.setting, saved.build, removed, 'runes', 'call_of_destiny', 'return');
    await expect(saveSettingInput(baseline, relocated, modelId)).resolves.toBeTypeOf('string');
  });

  it('escapes labels and option values instead of accepting markup', () => {
    expect(settingHtml('<img src="x" onerror=\'a\'>&')).toBe('&lt;img src=&quot;x&quot; onerror=&#39;a&#39;&gt;&amp;');
  });

  const cases = load('tests/fixtures/audit/2026-10-22-master-rune-inputs.json').cases as { variant: Build['variant']; inputs: { id: string; raw: RawArmory }[] }[];
  it.each(cases)('round-trips $variant rune edits with original provenance', async ({ variant, inputs }) => {
    const baseline = await captureSettingBaseline(inputs.find(input => input.id === 'base')!.raw);
    const origin = { kind: 'synthetic' as const, reference: 'saved rune example' };
    const saved = JSON.parse(await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId, origin));
    const other = variant === 'empress' ? 'scratch_dealer' : 'return';
    const choices = chooseSettingOption(saved.setting, saved.build, saved.setting.selections, 'runes', 'call_of_destiny', other);
    const text = await saveSettingInput(baseline, choices, modelId, origin);
    const reread = await readSettingInput(text, '편집', modelId);
    expect(reread.status).toBe('editable');
    expect(reread.setting!.source).toEqual(origin);
    expect(settingRows(reread.setting as unknown as SavedSetting, reread.build).runes.find(row => row.key === 'call_of_destiny')!.value).toBe(other);
  });
});
