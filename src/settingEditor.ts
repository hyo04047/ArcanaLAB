import { runeInputStatus } from './engine/armory';
import { SKILL_BY_NAME } from './engine/skilldata';
import { strip, tooltipLines } from './engine/tooltip';
import type { Build } from './engine';
import type { SettingSelections } from './engine/settings';
import type { SavedSetting } from './settingFiles';
import { applyEvolution, evolutionAllocation, evolutionEffects, evolutionNodes } from './engine/evolutionSettings';
import { applyStatSelections, profileStat, statNames, type StatKey } from './engine/statSettings';
import { applyEnlightenment, enlightenmentAllocation, enlightenmentEffects, enlightenmentNodes } from './engine/enlightenmentSettings';
import { applyCores, coreAllocation, coreChoices } from './engine/coreSettings';
import { tripodChoices, tripodSkill } from './engine/tripodSettings';
import { applyGems, gemAllocation, gemChoices, gemTargetAllowed } from './engine/gemSettings';

export interface SettingRow {
  key: string;
  label: string;
  initial: string;
  value: string;
  options: { value: string; label: string }[];
  description?: string;
}

/** 저장 원본 안에서만 선택지를 만들며, 적용할 때 기존 재생성 검사를 통과해야 합니다. */
export function settingRows(setting: SavedSetting, build: Build, selections = setting.selections): { runes: SettingRow[]; cooldownGems: SettingRow[]; evolution: SettingRow[]; enlightenment: SettingRow[]; cores: SettingRow[]; tripods: SettingRow[]; gems: SettingRow[] } {
  const raw = setting.baseline.raw;
  const skills = build.skills.flatMap(skill => {
    const matches = raw.combatSkills.filter(source => SKILL_BY_NAME.get(source.Name)?.id === skill.id);
    return matches.length === 1 ? [{ id: skill.id, raw: matches[0]! }] : [];
  });
  const availableRunes = skills.filter(skill => {
    const rune = skill.raw.Rune;
    return rune?.Name.trim() && rune.Grade.trim() && rune.Tooltip && tooltipLines(rune.Tooltip).length && runeInputStatus(rune) !== 'invalid';
  }).map(skill => ({ value: skill.id, label: `${skill.raw.Rune!.Name} · ${skill.raw.Rune!.Grade} (원본: ${skill.raw.Name})` }));
  const runes = skills.map(skill => {
    const initial = skill.raw.Rune ? skill.id : '';
    const selected = selections.runes?.find(choice => choice.targetSkillId === skill.id);
    return { key: skill.id, label: skill.raw.Name, initial, value: selected ? selected.sourceSkillId ?? '' : initial,
      options: [{ value: '', label: '룬 제거 / 없음' }, ...availableRunes,
        ...(initial && !availableRunes.some(option => option.value === initial)
          ? [{ value: initial, label: `${skill.raw.Rune!.Name || '이름 없는 룬'} · 원래 위치 유지 (설명 확인 필요)` }] : [])] };
  });
  const cooldownGems = (raw.gems?.Effects?.Skills ?? []).flatMap((gem, index) => {
    const id = SKILL_BY_NAME.get(gem.Name)?.id;
    const text = gem.Description?.length === 1 ? strip(gem.Description[0]!) : '';
    const match = text.match(/^재사용 대기시간 (\d+(?:\.\d+)?)% 감소$/);
    return id && skills.some(skill => skill.id === id) && match && Number(match[1]) < 100
      ? [{ key: String(index), label: `${gem.Name} · 효과 ${index + 1}`, initial: String(index),
        value: String(selections.cooldownGems?.find(choice => choice.targetIndex === index)?.sourceIndex ?? index),
        description: `${match[1]}% 감소 (원본: ${gem.Name} · 효과 ${index + 1})` }] : [];
  });
  let evolution: SettingRow[] = [];
  try {
    const original = evolutionAllocation(raw);
    evolution = evolutionNodes.filter(node => node.tier === 1 ? Object.values(statNames).some(name => name === node.name)
      : evolutionEffects.some(effect => effect.nodeId === node.id) || original.some(item => item.node.id === node.id)).map(node => {
      const initial = String(original.find(item => item.node.id === node.id)?.level ?? 0);
      const levels = node.tier === 1 ? Array.from({ length: node.max + 1 }, (_, level) => level)
        : [...new Set([0, Number(initial), ...evolutionEffects.filter(effect => effect.nodeId === node.id).map(effect => effect.level)])].sort((a, b) => a - b);
      return { key: node.id, label: `${node.tier}티어 ${node.name}`, initial,
        value: String(selections.evolution?.find(choice => choice.nodeId === node.id)?.level ?? initial),
        options: levels.map(level => ({ value: String(level), label: level === 0 ? '미선택 / 제거'
          : `Lv.${level} · ${node.cost * level}P${node.tier === 1 ? ' (특성 연동)' : !evolutionEffects.some(effect => effect.nodeId === node.id && effect.level === level) ? ' (원본 유지)' : ''}` })) };
    });
  } catch { /* 원본을 해석할 수 없어도 기존 룬·보석 편집과 재실행은 유지합니다. */ }
  let enlightenment: SettingRow[] = [];
  try {
    const original = enlightenmentAllocation(raw);
    enlightenment = enlightenmentNodes.filter(node => node.side).map(node => {
      const initial = String(original.find(item => item.node.id === node.id)?.level ?? 0);
      const levels = [...new Set([0, Number(initial), ...enlightenmentEffects.filter(effect => effect.nodeId === node.id).map(effect => effect.level)])].sort((a, b) => a - b);
      return { key: node.id, label: `${node.tier}티어 ${node.name}`, initial,
        value: String(selections.enlightenment?.find(choice => choice.nodeId === node.id)?.level ?? initial),
        options: levels.map(level => ({ value: String(level), label: level === 0 ? '미선택 / 제거'
          : `Lv.${level}${!enlightenmentEffects.some(effect => effect.nodeId === node.id && effect.level === level) ? ' (원본 유지)' : ''}` })) };
    });
  } catch { /* 계열·노드가 모호하면 사이드 편집만 닫고 기존 입력은 보존합니다. */ }
  let cores: SettingRow[] = [];
  try {
    const original = coreAllocation(raw);
    cores = original.slots.map(({ slot, label }) => ({ key: String(slot.Index), label, initial: '',
      value: selections.cores?.find(choice => choice.targetIndex === slot.Index)?.choiceId ?? '',
      options: [{ value: '', label: `원본 유지 · ${slot.Name.split(' : ')[1]} · ${slot.Grade} · ${slot.Point}P` },
        ...coreChoices.filter(choice => choice.slot.Index === slot.Index && (choice.variant === original.variant || choice.variant === 'common_chaos')
          && JSON.stringify(choice.slot) !== JSON.stringify(slot)).map((choice, index) => ({ value: choice.id,
          label: `${choice.slot.Name.split(' : ')[1]} · ${choice.slot.Grade} · ${choice.slot.Point}P · 젬 묶음 ${index + 1}` }))] }));
  } catch { /* 젬·포인트 근거가 불완전한 원본은 코어 편집만 닫습니다. */ }
  const tripods: SettingRow[] = skills.flatMap(({ id }) => {
    try {
      const { skill } = tripodSkill(raw, id);
      return [...new Set(skill.Tripods!.map(item => item.Tier))].sort().map(tier => {
        const original = skill.Tripods!.find(item => item.Tier === tier && item.IsSelected);
        const selected = selections.tripods?.find(item => item.skillId === id && item.tier === tier);
        const value = selected ? selected.choiceId ?? 'none' : '';
        const choice = tripodChoices.find(item => item.id === value);
        return { key: `${id}:${tier}`, label: `${skill.Name} · 스킬 Lv.${skill.Level} · ${tier + 1}티어`, initial: '', value,
          description: value === 'none' ? '이 티어의 효과를 제거합니다.' : strip(choice?.tripod.Tooltip ?? original?.Tooltip),
          options: [{ value: '', label: `원본 유지 · ${original?.Name ?? '미선택'} (강화 레벨 미확인)` }, { value: 'none', label: '미선택 / 제거' },
            ...tripodChoices.filter(item => item.skillId === id && item.skillLevel === skill.Level && item.tripod.Tier === tier
              && skill.Tripods!.some(t => t.Tier === tier && t.Slot === item.tripod.Slot && t.Name === item.tripod.Name))
              .map(item => ({ value: item.id, label: `${item.tripod.Name} · ${item.enhancementLevel === null ? '공식 관측 / 강화 레벨 미확인' : '공개 Lv.1 후보 / 현행 미검증'}` }))] };
      });
    } catch { return []; /* 설명이 불일치하는 스킬만 편집을 닫습니다. */ }
  });
  let gems: SettingRow[] = [];
  const gemLabel = (gem: { Name: string; Grade: string }, effect: { Name: string; Description?: string[] }) =>
    `${strip(gem.Name)} · ${gem.Grade} · ${effect.Name} · ${effect.Description?.join(' / ')}`;
  try {
    gems = gemAllocation(raw).rows.map(({ gem, effect }) => {
      const selected = selections.gems?.find(item => item.slot === gem.Slot), value = selected ? selected.choiceId ?? 'none' : '';
      const choice = gemChoices.find(item => item.id === value);
      return { key: String(gem.Slot), label: `보석 슬롯 ${gem.Slot} · 원본 ${effect.Name}`, initial: '', value,
        description: value === 'none' ? '이 슬롯의 보석과 효과를 제거합니다.' : `${choice?.effect.Option ?? effect.Option} · ${choice ? `저장 근거: ${choice.source.path}` : '기준 원본'}`,
        options: [{ value: '', label: `원본 유지 · ${gemLabel(gem, effect)}` }, { value: 'none', label: '보석 제거' },
          ...gemChoices.filter(item => gemTargetAllowed(raw, item.effect.Name)).map(item => ({ value: item.id, label: gemLabel(item.gem, item.effect) }))] };
    });
  } catch { /* 원본 슬롯과 합계가 없으면 보석 편집만 닫습니다. */ }
  return { runes, evolution, enlightenment, cores, tripods, gems, cooldownGems: cooldownGems.map(row => ({ ...row,
    options: cooldownGems.map(source => ({ value: source.key, label: source.description })) })) };
}

/** 이미 사용 중인 원본을 고르면 두 위치를 교환하고, 룬 제거는 그 자리만 비웁니다. */
export function chooseSettingOption(setting: SavedSetting, build: Build, draft: SettingSelections,
  axis: 'runes' | 'cooldownGems' | 'evolution' | 'enlightenment' | 'cores' | 'tripods' | 'gems', target: string, value: string): SettingSelections {
  const rows = settingRows(setting, build, draft)[axis], row = rows.find(item => item.key === target);
  if (!row || !row.options.some(option => option.value === value)) throw new Error('지원하는 원본 선택인지 확인하세요');
  const other = value === '' || axis === 'evolution' || axis === 'enlightenment' || axis === 'cores' || axis === 'tripods' || axis === 'gems' ? undefined : rows.find(item => item.key !== target && item.value === value);
  if (other) {
    if (!other.options.some(option => option.value === row.value)) throw new Error('현재 룬을 다른 위치로 옮길 수 없습니다. 먼저 제거한 뒤 선택하세요.');
    other.value = row.value;
  }
  row.value = value;
  const next = structuredClone(draft), changed = rows.filter(item => item.value !== item.initial);
  if (axis === 'runes') next.runes = changed.map(item => ({ targetSkillId: item.key, sourceSkillId: item.value || null }));
  else if (axis === 'cooldownGems') next.cooldownGems = changed.map(item => ({ targetIndex: Number(item.key), sourceIndex: Number(item.value) }));
  else if (axis === 'cores') next.cores = changed.map(item => ({ targetIndex: Number(item.key), choiceId: item.value }));
  else if (axis === 'gems') next.gems = changed.map(item => ({ slot: Number(item.key), choiceId: item.value === 'none' ? null : item.value }));
  else if (axis === 'tripods') next.tripods = changed.map(item => ({ skillId: item.key.split(':')[0]!, tier: Number(item.key.split(':')[1]), choiceId: item.value === 'none' ? null : item.value }));
  else next[axis] = changed.map(item => ({ nodeId: item.key, level: Number(item.value) }));
  if (!changed.length) delete next[axis];
  if (axis === 'cores' && !changed.length) delete next.coreGemMode;
  if (axis === 'gems' && !changed.length) delete next.gemAttackMode;
  return next;
}

export const settingHtml = (text: string): string => text.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function evolutionSummary(setting: SavedSetting, selections: SettingSelections): string {
  try {
    const check = applyEvolution(structuredClone(setting.baseline.raw), selections.evolution ?? []);
    return `총 ${check.spent}P / 원본 공급 ${check.available === null ? '미확인' : check.available + 'P'} · `
      + check.tiers.map(tier => `${tier.tier}티어 ${tier.spent}/${tier.limit}P`).join(' · ')
      + ' · 1티어는 최종 특성에 연동, 티어 개방·선행 조건 전체 미확인';
  } catch (error) { return `진화 적용 불가: ${error instanceof Error ? error.message : String(error)}`; }
}

export function chooseStatInput(draft: SettingSelections, key: string, text: string): SettingSelections {
  if (!Object.hasOwn(statNames, key)) throw new Error('지원하는 특성을 선택하세요');
  const next = structuredClone(draft), stats = next.stats ??= {};
  if (text.trim() === '') delete stats[key as StatKey];
  else stats[key as StatKey] = Number(text);
  if (!Object.keys(stats).length) delete next.stats;
  return next;
}

export function enlightenmentSummary(setting: SavedSetting, selections: SettingSelections): string {
  try {
    const check = applyEnlightenment(structuredClone(setting.baseline.raw), selections.enlightenment ?? []);
    return `${check.variant === 'empress' ? '황후' : '황제'} 메인 경로 고정 · 사용 포인트 미확인 / 원본 공급 ${check.available === null ? '미확인' : check.available + 'P'} · 비용·선행 조건·상호 배타·장착 가능성 미확인`;
  } catch (error) { return `깨달음 적용 불가: ${error instanceof Error ? error.message : String(error)}`; }
}

export function coreSummary(setting: SavedSetting, selections: SettingSelections): string {
  try {
    const check = applyCores(structuredClone(setting.baseline.raw), selections.cores ?? [], selections.coreGemMode);
    return check.changed ? '활성 젬 개별 합산 근사 · 실제 보유·전체 장착 규칙 미확인 · '
      + check.slots.map(slot => `${slot.label} ${slot.points}P / 의지력 ${slot.spent}/${slot.supply}`).join(' · ')
      : '원본 코어·젬 합계를 유지합니다. 변경 시 관측 묶음 전체를 적용하며 젬 개별 합산 근사를 선택해야 합니다.';
  } catch (error) { return `코어 적용 불가: ${error instanceof Error ? error.message : String(error)}`; }
}

export function gemSummary(setting: SavedSetting, selections: SettingSelections): string {
  try {
    const raw = structuredClone(setting.baseline.raw), original = gemAllocation(raw);
    if (selections.gems?.length && selections.cooldownGems?.length) throw new Error('쿨감 효과만의 교환을 먼저 원복하세요');
    const check = applyGems(raw, selections.gems ?? [], selections.gemAttackMode);
    return check.changed ? `기본 공격력 옵션 합계 ${check.before}% → ${check.total}% · ${check.base === undefined ? '합계 동일 / 기본 공격력 유지' : `기본 공격력 ${check.base.toFixed(4)} / 비율 환산 근사`}`
      : `원본 기본 공격력 옵션 합계 ${original.total}% · 프로필에 이미 포함되어 추가 가산하지 않습니다.`;
  } catch (error) { return `실제 보석 적용 불가: ${error instanceof Error ? error.message : String(error)}`; }
}

export function statSummary(setting: SavedSetting, selections: SettingSelections): string {
  try {
    const raw = structuredClone(setting.baseline.raw), result = applyStatSelections(raw, selections.stats, selections.evolution ?? []);
    return (Object.keys(statNames) as StatKey[]).map(key => `${statNames[key]} ${profileStat(raw, key).value}`
      + ` (${result.changed.includes(key) ? '근사 재계산' : '원본 효과 유지'})`).join(' · ');
  } catch (error) { return `특성 적용 불가: ${error instanceof Error ? error.message : String(error)}`; }
}
