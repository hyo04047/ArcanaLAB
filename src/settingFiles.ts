import { diffBuilds, parseBuildInput } from './compare';
import { captureSettingBaseline, rebuildSettings, type SettingBaseline, type SettingSelections } from './engine/settings';
import type { RawArmory } from './engine/armory';

export interface SettingSource {
  kind: 'api-snapshot' | 'synthetic' | 'unspecified';
  reference?: string;
  capturedAt?: string;
}

export interface SavedSetting {
  version: 1;
  baseline: SettingBaseline;
  selections: SettingSelections;
  compiledWith: string;
  checks: { equipmentLegality: 'unverified'; limitations: string[] };
  source?: SettingSource;
}

export interface LoadedSettingInput extends ReturnType<typeof parseBuildInput> {
  status: 'legacy' | 'editable' | 'model-changed' | 'unsupported-version';
  setting?: Record<string, unknown>;
  summary: string[];
  notices: string[];
  /** 다시 저장할 때 원문을 유지하며, 재생성은 별도 입력을 만듭니다. */
  text: string;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const array = (value: unknown, check: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(check);
const strings = (value: unknown): value is string[] => array(value, string);
const optional = (value: unknown, check: (item: unknown) => boolean): boolean => value === undefined || check(value);
const nullable = (value: unknown, check: (item: unknown) => boolean): boolean => value === null || check(value);
const hash = (value: unknown): value is string => string(value) && /^sha256:[a-f0-9]{64}$/.test(value);
const keys = (value: Record<string, unknown>, allowed: string[]): boolean => Object.keys(value).every(key => allowed.includes(key));

// 변환기가 읽는 구조를 검사하며, API의 추가 메타데이터는 그대로 보존합니다.
function armory(value: unknown): value is RawArmory {
  if (!object(value)) return false;
  const p = value.profiles;
  const tooltip = (v: Record<string, unknown>) => optional(v.Tooltip, string);
  const effect = (v: unknown) => object(v) && string(v.Name) && tooltip(v);
  const rune = (v: unknown) => object(v) && string(v.Name) && string(v.Grade) && tooltip(v);
  return object(p) && string(p.CharacterName) && string(p.CharacterClassName) && string(p.ItemAvgLevel)
    && optional(p.CharacterLevel, number) && array(p.Stats, v => object(v) && string(v.Type) && string(v.Value) && optional(v.Tooltip, strings))
    && array(value.combatSkills, v => object(v) && string(v.Name) && number(v.Level) && string(v.Type) && number(v.SkillType) && string(v.Tooltip)
      && optional(v.Tripods, list => array(list, t => object(t) && number(t.Tier) && number(t.Slot) && string(t.Name) && typeof t.IsSelected === 'boolean' && tooltip(t)))
      && optional(v.Rune, r => nullable(r, rune)))
    && optional(value.equipment, v => nullable(v, list => array(list, t => object(t) && string(t.Type) && tooltip(t))))
    && optional(value.cards, v => nullable(v, c => object(c) && array(c.Effects, e => object(e) && array(e.Items, i => object(i) && string(i.Name) && string(i.Description)))))
    && nullable(value.arkpassive, v => object(v) && array(v.Effects, e => object(e) && string(e.Name) && string(e.Description) && optional(e.ToolTip, string))
      && optional(v.Points, p => array(p, point => object(point) && string(point.Name) && number(point.Value))))
    && nullable(value.arkgrid, v => object(v) && optional(v.Effects, e => array(e, effect)) && array(v.Slots, s => object(s)
      && number(s.Index) && string(s.Name) && number(s.Point) && optional(s.Grade, string) && tooltip(s)
      && optional(s.Gems, g => array(g, x => object(x) && number(x.Index) && string(x.Grade) && optional(x.IsActive, a => typeof a === 'boolean') && tooltip(x)))))
    && nullable(value.engravings, v => object(v) && optional(v.ArkPassiveEffects, e => array(e, x => object(x) && string(x.Name) && string(x.Grade)
      && number(x.Level) && nullable(x.AbilityStoneLevel, number) && string(x.Description))))
    && nullable(value.gems, v => object(v)
      && optional(v.Gems, list => nullable(list, g => array(g, x => object(x) && number(x.Slot) && string(x.Name) && number(x.Level) && string(x.Grade) && string(x.Tooltip))))
      && optional(v.Effects, e => nullable(e, x => object(x) && optional(x.Description, string)
      && optional(x.Skills, list => array(list, g => object(g) && string(g.Name) && optional(g.Description, strings)
        && optional(g.GemSlot, number) && optional(g.Option, string) && optional(g.Tooltip, t => nullable(t, string)))))));
}

function selected(value: unknown): value is SettingSelections {
  return object(value) && keys(value, ['baselineFingerprint', 'runes', 'cooldownGems', 'evolution', 'stats', 'enlightenment', 'cores', 'coreGemMode', 'tripods', 'gems', 'gemAttackMode']) && hash(value.baselineFingerprint)
    && optional(value.gemAttackMode, mode => mode === 'ratio-approximation')
    && optional(value.gems, g => array(g, x => object(x) && keys(x, ['slot', 'choiceId'])
      && Number.isSafeInteger(x.slot) && Number(x.slot) >= 0 && nullable(x.choiceId, string)))
    && optional(value.tripods, t => array(t, x => object(x) && keys(x, ['skillId', 'tier', 'choiceId']) && string(x.skillId)
      && Number.isSafeInteger(x.tier) && Number(x.tier) >= 0 && Number(x.tier) <= 2 && nullable(x.choiceId, string)))
    && optional(value.coreGemMode, mode => mode === 'individual-approximation')
    && optional(value.cores, c => array(c, x => object(x) && keys(x, ['targetIndex', 'choiceId'])
      && Number.isSafeInteger(x.targetIndex) && Number(x.targetIndex) >= 0 && string(x.choiceId)))
    && optional(value.stats, s => object(s) && keys(s, ['crit', 'spec', 'swift']) && Object.values(s).every(n => Number.isSafeInteger(n) && Number(n) >= 0))
    && optional(value.runes, r => array(r, x => object(x) && keys(x, ['targetSkillId', 'sourceSkillId']) && string(x.targetSkillId)
      && nullable(x.sourceSkillId, string)))
    && optional(value.cooldownGems, g => array(g, x => object(x) && keys(x, ['targetIndex', 'sourceIndex'])
      && Number.isSafeInteger(x.targetIndex) && Number.isSafeInteger(x.sourceIndex) && Number(x.targetIndex) >= 0 && Number(x.sourceIndex) >= 0))
    && optional(value.evolution, e => array(e, x => object(x) && keys(x, ['nodeId', 'level']) && string(x.nodeId)
      && Number.isSafeInteger(x.level) && Number(x.level) >= 0))
    && optional(value.enlightenment, e => array(e, x => object(x) && keys(x, ['nodeId', 'level']) && string(x.nodeId)
      && Number.isSafeInteger(x.level) && Number(x.level) >= 0));
}

function source(value: unknown): value is SettingSource {
  return object(value) && keys(value, ['kind', 'reference', 'capturedAt']) && string(value.kind) && ['api-snapshot', 'synthetic', 'unspecified'].includes(value.kind)
    && optional(value.reference, string) && optional(value.capturedAt, string);
}

function format(value: unknown, sorted = false): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('저장할 숫자가 지원 범위를 벗어났습니다');
    return sorted && object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
  }, sorted ? undefined : 2);
}

function metadata(value: Record<string, unknown>, label: string): asserts value is Record<string, unknown> & SavedSetting {
  const b = value.baseline, c = value.checks;
  if (!keys(value, ['version', 'baseline', 'selections', 'compiledWith', 'checks', 'source'])
    || !object(b) || !keys(b, ['raw', 'fingerprint']) || !hash(b.fingerprint) || !armory(b.raw) || !selected(value.selections)
    || !hash(value.compiledWith) || !object(c) || !keys(c, ['equipmentLegality', 'limitations'])
    || c.equipmentLegality !== 'unverified' || !strings(c.limitations) || !optional(value.source, source))
    throw new Error(`선택 정보 형식을 확인하세요: ${label}`);
}

/** 같은 모델은 재생성해 대조하며, 다른 모델이나 모르는 버전을 자동 변환하지 않습니다. */
export async function readSettingInput(text: string, label: string, currentModelId: string): Promise<LoadedSettingInput> {
  if (!hash(currentModelId)) throw new Error('현재 모델 식별값을 확인하세요');
  const input = parseBuildInput(text, label), saved = JSON.parse(text.replace(/^\uFEFF/, ''));
  const loaded: LoadedSettingInput = { ...input, text, status: 'legacy', summary: strings(saved.summary) ? saved.summary : [], notices: [] };
  if (!Object.hasOwn(saved, 'setting')) return loaded;
  if (!saved.build || !object(saved.setting) || !Number.isSafeInteger(saved.setting.version) || Number(saved.setting.version) < 1)
    throw new Error(`선택 정보 형식을 확인하세요: ${label}`);
  const setting = saved.setting;
  loaded.setting = setting;
  if (setting.version !== 1) return { ...loaded, status: 'unsupported-version',
    notices: [`선택 정보 버전 ${setting.version}은 편집할 수 없습니다. 저장된 계산 입력으로 재실행하며 원본 파일을 보존합니다.`] };
  metadata(setting, label);
  if (!strings(saved.summary) || input.warnings === null) throw new Error(`선택 입력의 요약·경고 형식을 확인하세요: ${label}`);
  const captured = await captureSettingBaseline(setting.baseline.raw);
  if (captured.fingerprint !== setting.baseline.fingerprint || setting.selections.baselineFingerprint !== captured.fingerprint)
    throw new Error(`선택 정보의 기준 원본이 일치하지 않습니다: ${label}`);
  if (setting.compiledWith !== currentModelId) return { ...loaded, status: 'model-changed',
    notices: ['선택을 변환한 모델이 다릅니다. 저장된 계산 입력을 유지하며, 편집을 재개하려면 현재 모델로 별도 재생성이 필요합니다.'] };
  const rebuilt = await rebuildSettings(setting.baseline, setting.selections);
  const checks = { equipmentLegality: rebuilt.equipmentLegality, limitations: rebuilt.limitations };
  if (format(input.build, true) !== format(rebuilt.build, true) || format(input.warnings, true) !== format(rebuilt.warnings, true)
    || format(saved.summary, true) !== format(rebuilt.summary, true) || format(setting.checks, true) !== format(checks, true))
    throw new Error(`선택 정보와 저장된 계산 입력·경고·요약이 일치하지 않습니다: ${label}`);
  return { ...loaded, status: 'editable' };
}

/** 새 입력만 만듭니다. 과거 결과·조건·실행 모델을 새 선택의 결과로 옮기지 않습니다. */
export async function saveSettingInput(baseline: SettingBaseline, selections: SettingSelections, modelId: string, origin?: SettingSource): Promise<string> {
  const copied = structuredClone({ baseline, selections, source: origin });
  const shell: Record<string, unknown> = { version: 1, baseline: copied.baseline, selections: copied.selections, compiledWith: modelId,
    checks: { equipmentLegality: 'unverified', limitations: [] }, ...(copied.source === undefined ? {} : { source: copied.source }) };
  metadata(shell, '새 세팅');
  const rebuilt = await rebuildSettings(copied.baseline, copied.selections);
  shell.checks = { equipmentLegality: rebuilt.equipmentLegality, limitations: rebuilt.limitations };
  return format({ build: rebuilt.build, warnings: rebuilt.warnings, summary: rebuilt.summary, setting: shell }) + '\n';
}

export async function regenerateSettingInput(text: string, label: string, currentModelId: string) {
  const previous = await readSettingInput(text, label, currentModelId);
  if (previous.status !== 'editable' && previous.status !== 'model-changed') throw new Error('재생성 가능한 원본과 선택 정보가 없습니다');
  const setting = previous.setting!;
  metadata(setting, label);
  const nextText = await saveSettingInput(setting.baseline, setting.selections, currentModelId, setting.source);
  const next = await readSettingInput(nextText, '재생성 입력', currentModelId);
  return { input: next, changes: diffBuilds(previous.build, next.build),
    warningsAdded: next.warnings!.filter(warning => !previous.warnings?.includes(warning)),
    warningsRemoved: previous.warnings?.filter(warning => !next.warnings!.includes(warning)) ?? null };
}
