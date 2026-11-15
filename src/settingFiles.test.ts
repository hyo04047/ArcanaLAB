import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import modelId from 'virtual:arcanalab-model';
import { captureSettingBaseline, rebuildSettings } from './engine/settings';
import type { RawArmory } from './engine/armory';
import type { Build } from './engine/types';
import { readSettingInput, regenerateSettingInput, saveSettingInput, type SavedSetting } from './settingFiles';

const raw = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-22-four-axis-inputs.json', 'utf8')).inputs[0].raw as RawArmory;
const oldModel = 'sha256:' + '0'.repeat(64);
const origin = { kind: 'synthetic' as const, reference: 'stored four-axis example' };
type Document = { build: Build; warnings: string[]; summary: string[]; setting: SavedSetting };
async function fixture(changed = false) {
  const baseline = await captureSettingBaseline(raw);
  const selections = { baselineFingerprint: baseline.fingerprint, ...(changed ? {
    runes: [{ targetSkillId: 'call_of_destiny', sourceSkillId: 'return' }, { targetSkillId: 'return', sourceSkillId: 'call_of_destiny' }],
    cooldownGems: [{ targetIndex: 1, sourceIndex: 9 }, { targetIndex: 9, sourceIndex: 1 }],
  } : {}) };
  const text = await saveSettingInput(baseline, selections, modelId, origin);
  return { baseline, selections, text, saved: JSON.parse(text) as Document };
}

describe('setting file round trip and compatibility', () => {
  it.each([false, true])('preserves the complete input, original, choices, warnings and provenance (changed=%s)', async changed => {
    const { baseline, selections, text, saved } = await fixture(changed);
    const loaded = await readSettingInput(text, 'round-trip.json', modelId), rebuilt = await rebuildSettings(baseline, selections);
    expect(loaded.status).toBe('editable'); expect(loaded.text).toBe(text);
    expect(loaded.build).toEqual(JSON.parse(JSON.stringify(rebuilt.build)));
    expect(loaded.warnings).toEqual(rebuilt.warnings); expect(loaded.summary).toEqual(rebuilt.summary);
    expect(loaded.setting).toEqual(saved.setting); expect(saved.setting.source).toEqual(origin);
    expect(saved.setting.baseline.raw).toEqual(raw);
    expect(await saveSettingInput(baseline, selections, modelId, origin)).toBe(text);
  });

  it('preserves a BOM, extra original metadata and object-key reorderings', async () => {
    const extra = { ...structuredClone(raw), unusedMetadata: { text: '\uFEFF자료', value: 0 } };
    const baseline = await captureSettingBaseline(extra);
    const text = await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId);
    const saved = JSON.parse(text), reordered = Object.fromEntries(Object.entries(saved).reverse());
    reordered.build = Object.fromEntries(Object.entries(saved.build).reverse());
    const withBom = '\uFEFF' + JSON.stringify(reordered);
    const loaded = await readSettingInput(withBom, 'BOM.json', modelId);
    expect(loaded.text).toBe(withBom); expect(loaded.status).toBe('editable');
    expect((loaded.setting as unknown as SavedSetting).baseline.raw).toEqual(extra);
  });

  it.each(['raw', 'missing', 'empty'] as const)('keeps legacy %s warning provenance without inventing a source', async kind => {
    const { saved } = await fixture();
    const legacy = kind === 'raw' ? saved.build : { build: saved.build, ...(kind === 'empty' ? { warnings: [] } : {}), note: 'preserve' };
    const text = JSON.stringify(legacy);
    const loaded = await readSettingInput(text, 'legacy.json', modelId);
    expect(loaded.status).toBe('legacy'); expect(loaded.setting).toBeUndefined(); expect(loaded.text).toBe(text);
    expect(loaded.warnings).toEqual(kind === 'empty' ? [] : null);
    await expect(regenerateSettingInput(text, 'legacy.json', modelId)).rejects.toThrow('원본과 선택 정보가 없습니다');
  });

  it('preserves a different model as replay-only and creates a separate regenerated input with explicit differences', async () => {
    const { saved } = await fixture(true);
    saved.setting.compiledWith = oldModel; saved.build.stats.swift++;
    saved.warnings = ['과거 경고']; saved.summary = ['과거 요약'];
    const historical = { ...saved, modelId: oldModel, result: { preserved: true }, config: { preserved: true } };
    const text = JSON.stringify(historical), loaded = await readSettingInput(text, 'old.json', modelId);
    expect(loaded.status).toBe('model-changed'); expect(loaded.build).toEqual(saved.build);
    expect(loaded.warnings).toEqual(['과거 경고']); expect(loaded.text).toBe(text);
    const regenerated = await regenerateSettingInput(text, 'old.json', modelId);
    expect(regenerated.input.status).toBe('editable'); expect(regenerated.changes.map(item => item.path)).toEqual(['/stats/swift']);
    expect(regenerated.warningsRemoved).toEqual(['과거 경고']); expect(regenerated.warningsAdded.length).toBeGreaterThan(0);
    const next = JSON.parse(regenerated.input.text);
    expect(next.setting.compiledWith).toBe(modelId); expect(next.setting.source).toEqual(origin);
    expect(next).not.toHaveProperty('result'); expect(next).not.toHaveProperty('config'); expect(next).not.toHaveProperty('modelId');
    expect(JSON.stringify(historical)).toBe(text);
  });

  it('does not promote a different model even when all numerical fields happen to match', async () => {
    const { saved } = await fixture(); saved.setting.compiledWith = oldModel;
    expect((await readSettingInput(JSON.stringify(saved), 'old-equal.json', modelId)).status).toBe('model-changed');
  });

  it('keeps unknown versions opaque and preserves the original file for replay', async () => {
    const { saved } = await fixture();
    const future = { ...saved, setting: { version: 2, opaque: { choices: ['future'], proof: null } } };
    const text = JSON.stringify(future), loaded = await readSettingInput(text, 'future.json', modelId);
    expect(loaded.status).toBe('unsupported-version'); expect(loaded.setting).toEqual(future.setting);
    expect(loaded.text).toBe(text); expect(loaded.build).toEqual(saved.build);
    await expect(regenerateSettingInput(text, 'future.json', modelId)).rejects.toThrow('원본과 선택 정보가 없습니다');
  });

  it('copies save inputs before asynchronous work', async () => {
    const { baseline, selections } = await fixture();
    const source = { ...origin }, pending = saveSettingInput(baseline, selections, modelId, source);
    baseline.raw.profiles.CharacterName = 'changed'; source.reference = 'changed'; selections.baselineFingerprint = oldModel;
    const loaded = await readSettingInput(await pending, 'copied.json', modelId);
    expect((loaded.setting as unknown as SavedSetting).baseline.raw.profiles.CharacterName).toBe(raw.profiles.CharacterName);
    expect((loaded.setting as unknown as SavedSetting).source).toEqual(origin);
  });
});

describe('inconsistent selection files do not silently become legacy files', () => {
  const invalid: [string, (saved: Document) => void][] = [
    ['null setting', s => { Object.assign(s, { setting: null }); }],
    ['string version', s => { Object.assign(s.setting, { version: '1' }); }],
    ['zero version', s => { Object.assign(s.setting, { version: 0 }); }],
    ['bad compiled model', s => { s.setting.compiledWith = 'unknown'; }],
    ['changed original', s => { s.setting.baseline.raw.profiles.CharacterName = 'different'; }],
    ['changed selected baseline', s => { s.setting.selections.baselineFingerprint = oldModel; }],
    ['changed calculation', s => { s.build.skills[0]!.castTime += 1; }],
    ['removed warnings', s => { s.warnings = []; }],
    ['reordered warnings', s => { s.warnings.reverse(); }],
    ['missing warnings', s => { delete (s as Partial<Document>).warnings; }],
    ['changed summary', s => { s.summary = ['different']; }],
    ['missing summary', s => { delete (s as Partial<Document>).summary; }],
    ['changed limitations', s => { s.setting.checks.limitations = []; }],
    ['invented equipment validity', s => { Object.assign(s.setting.checks, { equipmentLegality: 'verified' }); }],
    ['unknown axis', s => { Object.assign(s.setting.selections, { stats: { swift: 1000 } }); }],
    ['duplicate rune source', s => { s.setting.selections.runes!.pop(); }],
    ['extra selection field', s => { Object.assign(s.setting.selections.runes![0]!, { Grade: '유물' }); }],
    ['bad combat skill array', s => { Object.assign(s.setting.baseline.raw, { combatSkills: {} }); }],
    ['bad profile stats', s => { Object.assign(s.setting.baseline.raw.profiles, { Stats: [null] }); }],
    ['bad rune shape', s => { Object.assign(s.setting.baseline.raw.combatSkills[0]!, { Rune: 'wrong' }); }],
    ['bad passive effects', s => { Object.assign(s.setting.baseline.raw, { arkpassive: { Effects: [null] } }); }],
    ['bad core slots', s => { Object.assign(s.setting.baseline.raw, { arkgrid: { Slots: 'wrong' } }); }],
    ['bad gem descriptions', s => { Object.assign(s.setting.baseline.raw.gems!.Effects!.Skills![0]!, { Description: [1] }); }],
    ['bad source kind', s => { Object.assign(s.setting.source!, { kind: ['synthetic'] }); }],
  ];
  it.each(invalid)('rejects %s', async (_label, change) => {
    const { saved } = await fixture(true); change(saved);
    const text = JSON.stringify(saved);
    await expect(readSettingInput(text, 'invalid.json', modelId)).rejects.toThrow();
    expect(JSON.stringify(saved)).toBe(text);
  });

  it('checks the original fingerprint even for another model', async () => {
    const { saved } = await fixture(); saved.setting.compiledWith = oldModel;
    saved.setting.baseline.raw.profiles.CharacterName = 'changed';
    await expect(readSettingInput(JSON.stringify(saved), 'old-tampered.json', modelId)).rejects.toThrow('원본이 일치하지');
  });

  it('rejects malformed JSON and numeric overflow before interpreting selection metadata', async () => {
    await expect(readSettingInput('{broken', 'bad.json', modelId)).rejects.toThrow('JSON 형식');
    const { text } = await fixture();
    await expect(readSettingInput(text.replace('"version": 1', '"version": 1e999'), 'overflow.json', modelId)).rejects.toThrow('숫자');
  });

  it('rejects an explicitly invalid save source instead of dropping it', async () => {
    const { baseline, selections } = await fixture();
    await expect(saveSettingInput(baseline, selections, modelId, null as never)).rejects.toThrow('선택 정보 형식');
  });
});
