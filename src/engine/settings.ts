import { buildFromArmory, runeInputStatus, type ConvertResult, type RawArmory } from './armory';
import { SKILL_BY_NAME } from './skilldata';
import { strip, tooltipLines } from './tooltip';
import { applyEvolution, type EvolutionChoice } from './evolutionSettings';
import { applyStatSelections, statNames, type StatSelections } from './statSettings';
import { applyEnlightenment, type EnlightenmentChoice } from './enlightenmentSettings';
import { applyCores, type CoreChoice, type CoreGemMode } from './coreSettings';
import { applyTripods, type TripodChoice } from './tripodSettings';
import { applyGems, type GemChoice, type GemAttackMode } from './gemSettings';

/** 원본과 선택을 묶는 내부 계약입니다. 외부 저장 파일의 형식 검사는 별도입니다. */
export interface SettingBaseline {
  raw: RawArmory;
  fingerprint: string;
}

export interface SettingSelections {
  baselineFingerprint: string;
  /** 같은 원본의 룬 객체 전체를 옮깁니다. null은 해당 스킬에서 룬을 제거합니다. */
  runes?: { targetSkillId: string; sourceSkillId: string | null }[];
  /** 실제 보석 등급 변경이 아닌, 원본 쿨감 효과 설명의 재배치 실험입니다. */
  cooldownGems?: { targetIndex: number; sourceIndex: number }[];
  /** 생략한 노드는 원본을 유지하고 0은 제거합니다. 1티어는 최종 특성과 함께 재생성합니다. */
  evolution?: EvolutionChoice[];
  stats?: StatSelections;
  /** 메인 경로는 유지합니다. 생략은 원본 유지, 0은 사이드 제거입니다. */
  enlightenment?: EnlightenmentChoice[];
  cores?: CoreChoice[];
  coreGemMode?: CoreGemMode;
  /** 저장 설명과 강화 레벨 근거를 묶어 선택합니다. null은 해당 티어 제거입니다. */
  tripods?: TripodChoice[];
  gems?: GemChoice[];
  gemAttackMode?: GemAttackMode;
}

export interface SettingRebuild extends ConvertResult {
  conversionWarnings: string[];
  limitations: string[];
  equipmentLegality: 'unverified';
}

// 객체 키 순서는 무시하고, 효과·운용에 의미가 있는 배열 순서는 보존합니다.
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]));
  return value;
}

async function fingerprint(raw: RawArmory): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(ordered(raw)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

export async function captureSettingBaseline(raw: RawArmory): Promise<SettingBaseline> {
  const snapshot = structuredClone(raw);
  return { raw: snapshot, fingerprint: await fingerprint(snapshot) };
}

function fields(value: unknown, allowed: string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label} 형식을 확인하세요`);
}

/** 매번 원본에서 재생성합니다. 기존 Build, 변경 결과, 이전 경고를 덧붙이지 않습니다. */
export async function rebuildSettings(baseline: SettingBaseline, selections: SettingSelections): Promise<SettingRebuild> {
  // 비동기 해시 계산 중 호출자가 원본이나 선택을 바꿔도 이번 입력은 고정됩니다.
  const raw = structuredClone(baseline.raw), expected = baseline.fingerprint, choices = structuredClone(selections);
  fields(choices, ['baselineFingerprint', 'runes', 'cooldownGems', 'evolution', 'stats', 'enlightenment', 'cores', 'coreGemMode', 'tripods', 'gems', 'gemAttackMode'], '세팅 선택');
  if (typeof expected !== 'string' || choices.baselineFingerprint !== expected || await fingerprint(raw) !== expected)
    throw new Error('세팅 기준 원본이 일치하지 않습니다 — 원본에서 선택을 다시 준비하세요');
  for (const key of ['runes', 'cooldownGems', 'evolution', 'enlightenment', 'cores', 'tripods', 'gems'] as const)
    if (choices[key] !== undefined && !Array.isArray(choices[key])) throw new Error(`${key} 선택은 배열이어야 합니다`);
  if (choices.gems?.length && choices.cooldownGems?.length) throw new Error('실제 보석 변경과 효과만의 교환은 함께 적용할 수 없습니다. 쿨감 효과 교환을 먼저 원복하세요');

  const base = buildFromArmory(raw), activeSkills = new Set(base.build.skills.map(skill => skill.id));
  const skillIndex = (id: string): number => {
    const matches = raw.combatSkills.flatMap((skill, index) => SKILL_BY_NAME.get(skill.Name)?.id === id ? [index] : []);
    if (typeof id !== 'string' || !activeSkills.has(id) || matches.length !== 1)
      throw new Error(`룬 대상 스킬이 없거나 중복·미장착 상태입니다: ${id}`);
    return matches[0]!;
  };

  const runePlacement = raw.combatSkills.map((skill, index) => skill.Rune ? index : null);
  const runeTargets = new Set<number>();
  for (const choice of choices.runes ?? []) {
    fields(choice, ['targetSkillId', 'sourceSkillId'], '룬 선택');
    const target = skillIndex(choice.targetSkillId);
    if (runeTargets.has(target)) throw new Error('같은 스킬의 룬 선택이 중복됐습니다');
    runeTargets.add(target);
    const source = choice.sourceSkillId === null ? null : skillIndex(choice.sourceSkillId);
    if (source !== null) {
      const rune = raw.combatSkills[source]!.Rune;
      if (!rune || typeof rune.Name !== 'string' || !rune.Name.trim() || typeof rune.Grade !== 'string' || !rune.Grade.trim()
        || typeof rune.Tooltip !== 'string' || !tooltipLines(rune.Tooltip).length || runeInputStatus(rune) === 'invalid')
        throw new Error('옮길 룬의 이름·등급·효과 설명이 없거나 올바르지 않습니다');
    }
    runePlacement[target] = source;
  }
  const assignedRunes = runePlacement.filter(index => index !== null);
  if (new Set(assignedRunes).size !== assignedRunes.length) throw new Error('같은 원본 룬을 여러 스킬에 배치할 수 없습니다');

  const gems = raw.gems?.Effects?.Skills ?? [];
  const gemPlacement = gems.map((_, index) => index), gemTargets = new Set<number>();
  const cooldownGem = (index: number): void => {
    const gem = gems[index];
    const id = gem && SKILL_BY_NAME.get(gem.Name)?.id;
    const match = gem?.Description?.length === 1 && typeof gem.Description[0] === 'string'
      ? strip(gem.Description[0]).match(/^재사용 대기시간 (\d+(?:\.\d+)?)% 감소$/) : null;
    if (!Number.isSafeInteger(index) || index < 0 || !id || !activeSkills.has(id) || !match || Number(match[1]) >= 100)
      throw new Error('보석 대상은 원본의 장착 스킬 쿨감 효과 하나여야 합니다');
  };
  for (const choice of choices.cooldownGems ?? []) {
    fields(choice, ['targetIndex', 'sourceIndex'], '쿨감 보석 선택');
    cooldownGem(choice.targetIndex); cooldownGem(choice.sourceIndex);
    if (gemTargets.has(choice.targetIndex)) throw new Error('같은 보석 효과의 선택이 중복됐습니다');
    gemTargets.add(choice.targetIndex);
    gemPlacement[choice.targetIndex] = choice.sourceIndex;
  }
  if (new Set(gemPlacement).size !== gemPlacement.length) throw new Error('같은 원본 보석 효과를 여러 곳에 배치할 수 없습니다');

  // 모든 참조는 아직 바꾸지 않은 원본에서 읽습니다. 검사가 끝난 뒤 한꺼번에 적용합니다.
  const runes = raw.combatSkills.map(skill => skill.Rune);
  for (const target of runeTargets) {
    const source = runePlacement[target]!;
    raw.combatSkills[target]!.Rune = source === null ? null : structuredClone(runes[source]);
  }
  const descriptions = gems.map(gem => gem.Description);
  for (const target of gemTargets) gems[target]!.Description = structuredClone(descriptions[gemPlacement[target]!]);

  const changedRunes = [...runeTargets].some(target => runePlacement[target] !== (runes[target] ? target : null));
  const changedGems = [...gemTargets].some(target => gemPlacement[target] !== target);
  const stats = applyStatSelections(raw, choices.stats, choices.evolution ?? []);
  const evolution = choices.evolution?.length ? applyEvolution(raw, choices.evolution) : undefined;
  const enlightenment = choices.enlightenment?.length ? applyEnlightenment(raw, choices.enlightenment) : undefined;
  const cores = applyCores(raw, choices.cores ?? [], choices.coreGemMode);
  const tripods = applyTripods(raw, choices.tripods ?? []);
  const actualGems = applyGems(raw, choices.gems ?? [], choices.gemAttackMode);
  const converted = changedRunes || changedGems || evolution?.changed || stats.changed.length || enlightenment?.changed || cores.changed || tripods.changed || actualGems.changed ? buildFromArmory(raw) : base;
  if (converted.build.variant !== base.build.variant) throw new Error('세팅 변경 전후의 계열이 일치하지 않습니다');
  const limitations = [
    ...(actualGems.changed ? [`보석 등급·레벨·대상·효과는 저장 관측 묶음입니다. 기본 공격력 옵션 합계 ${actualGems.before}% → ${actualGems.total}%. ${actualGems.base === undefined ? '합계가 같아 원본 기본 공격력을 유지합니다.' : `기본 공격력 ${actualGems.base.toFixed(4)}은 (1+새 합계)/(1+옛 합계)의 비율 환산 근사이며 다른 기본 공격력 효과와의 결합·반올림은 미확인입니다. 프로필 표시 공격력은 원본 비교 참고값입니다.`} 실제 보유·전체 장착 규칙과 현행 게임 효과는 미확인입니다.`] : []),
    ...(tripods.changed ? ['트라이포드는 관측 스킬 레벨을 유지하고 저장 설명을 적용합니다. 공식 관측의 강화 레벨은 미확인이며 공개 Lv.1은 현행 미검증 후보입니다. 피해·타수·쿨·기본 운용을 재생성하지만 미지원 변형·강화 레벨별 수치·전체 장착 규칙은 미완입니다.'] : []),
    ...(changedRunes ? ['원본 룬의 배치 변경 실험입니다 — 룬 보유 수량·게임 장착 규칙 전체는 미확인입니다.'] : []),
    ...(changedGems ? ['쿨감 보석의 효과 설명만 재배치한 실험입니다 — 실제 보석 등급·슬롯·장착 가능성을 재생성하지 않습니다.'] : []),
    ...(evolution?.changed ? [`진화 선택은 저장 공식 설명과 티어 한도로 검증합니다. 사용 ${evolution.spent}P / 원본 공급 ${evolution.available ?? '미확인'}${evolution.available === null ? '' : 'P'}. ${stats.linked.length ? '1티어는 카탈로그 +50/레벨 규칙으로 구성한 합성 선택이며 최종 특성에 한 번만 반영합니다.' : '1티어 특성은 유지하며'} 티어 개방·선행 조건 전체와 현재 서버 장착 가능성은 미확인입니다.`] : []),
    ...(stats.changed.length ? [`특성 변경(${stats.changed.map(key => statNames[key]).join('·')})은 이전 툴팁을 무효화하고 카탈로그 근사식으로 재계산합니다. 정확한 게임 환산 계수와 장비로 달성 가능한 총합은 미확인입니다.`] : []),
    ...(Object.keys(choices.stats ?? {}).length ? ['직접 지정한 특성은 진화 1티어를 포함한 최종 총합이며 노드 기여를 다시 더하지 않습니다.'] : []),
    ...(enlightenment?.changed ? [`깨달음 사이드는 저장 공식 설명의 관측 레벨로 변경하며 메인 경로는 유지합니다. 사용 포인트 미확인 / 원본 공급 ${enlightenment.available === null ? '미확인' : enlightenment.available + 'P'}. 비용·선행 조건·상호 배타·현재 서버 장착 가능성은 미확인입니다.`] : []),
    ...(cores.changed ? [`코어·등급·포인트·젬을 저장 관측 묶음으로 변경했습니다. 기존 공식 젬 합계를 무효화하고 활성 젬 설명의 개별 합산 근사를 선택했습니다. 표시 반올림 차이·미모델 효과·실제 보유와 현행 장착 가능성은 미확인입니다. ${actualGems.base === undefined ? '프로필의 기본 공격력은 유지하며' : '기본 공격력은 보석의 명시적 비율 환산 근사를 따르며'} 표시 공격력은 원본의 비교 참고값입니다.`] : []),
  ];
  return { ...converted, conversionWarnings: [...converted.warnings], limitations,
    warnings: [...converted.warnings, ...limitations], equipmentLegality: 'unverified' };
}
