import observed from '../../data/tripod_choices.json';
import catalog from '../../data/skills.json';
import type { RawArmory } from './armory';
import { strip, tooltipLines } from './tooltip';

export interface TripodChoice { skillId: string; tier: number; choiceId: string | null }
export const tripodChoices = observed.choices;

/** 편집 대상만 검사합니다. 원본 유지와 과거 입력 실행에는 새 근거를 요구하지 않습니다. */
export function tripodSkill(raw: RawArmory, skillId: string) {
  const definition = catalog.skills.find(item => item.id === skillId);
  const matches = raw.combatSkills.filter(skill => skill.Name === definition?.name);
  const skill = matches[0];
  if (!definition || matches.length !== 1 || !skill || skill.SkillType !== 0 || !Number.isSafeInteger(skill.Level)
    || !tripodChoices.some(choice => choice.skillId === skillId && choice.skillLevel === skill.Level))
    throw new Error('트라이포드 대상 스킬·스킬 레벨의 저장 근거가 없거나 대상이 중복됐습니다');
  if (!tooltipLines(skill.Tooltip).includes(`스킬 레벨 ${skill.Level}`)) throw new Error('스킬 레벨과 원본 설명이 일치하지 않습니다');
  const slots = new Set<string>(), tiers = new Set<number>();
  for (const tripod of skill.Tripods ?? []) {
    const key = `${tripod.Tier}:${tripod.Slot}`;
    if (!Number.isSafeInteger(tripod.Tier) || !Number.isSafeInteger(tripod.Slot)
      || definition.tripods?.[tripod.Tier]?.[tripod.Slot - 1] !== tripod.Name || slots.has(key)
      || typeof tripod.IsSelected !== 'boolean') throw new Error('원본 트라이포드의 티어·슬롯·이름이 잘못됐거나 중복됐습니다');
    slots.add(key);
    if (!tripod.IsSelected) continue;
    if (tiers.has(tripod.Tier)) throw new Error('원본에서 같은 트라이포드 티어를 중복 선택했습니다');
    tiers.add(tripod.Tier);
    if (!tripodChoices.some(choice => choice.skillId === skillId && choice.skillLevel === skill.Level
      && choice.tripod.Tier === tripod.Tier && choice.tripod.Slot === tripod.Slot && strip(choice.tripod.Tooltip) === strip(tripod.Tooltip)))
      throw new Error('선택한 원본 트라이포드 설명의 저장 근거를 확인할 수 없습니다');
  }
  const tooltip = JSON.parse(skill.Tooltip) as Record<string, { type?: string; value?: unknown }>;
  const custom = Object.entries(tooltip).filter(([, item]) => item?.type === 'TripodSkillCustom');
  if (custom.length !== 1 || !custom[0]![1].value || typeof custom[0]![1].value !== 'object' || Array.isArray(custom[0]![1].value))
    throw new Error('원본 트라이포드 선택 요약을 확인할 수 없습니다');
  const selected = (skill.Tripods ?? []).filter(item => item.IsSelected).sort((a, b) => a.Tier - b.Tier);
  const summary = Object.values(custom[0]![1].value as Record<string, { name?: string; desc?: string }>);
  if (summary.length !== selected.length || summary.some((item, index) => !item || typeof item.name !== 'string' || typeof item.desc !== 'string'
    || strip(item.name) !== selected[index]!.Name || strip(item.desc) !== strip(selected[index]!.Tooltip)))
    throw new Error('원본 트라이포드 선택과 스킬 설명의 요약이 일치하지 않습니다');
  return { skill, tooltip, customKey: custom[0]![0] };
}

/** 선택 객체와 중복된 스킬 툴팁 요약을 함께 바꾸며, 전체 Build는 호출자가 재생성합니다. */
export function applyTripods(raw: RawArmory, choices: TripodChoice[]) {
  if (!Array.isArray(choices)) throw new Error('트라이포드 선택은 배열이어야 합니다');
  const targets = new Map<string, ReturnType<typeof tripodSkill>>(), seen = new Set<string>();
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)
      || Object.keys(choice).some(key => !['skillId', 'tier', 'choiceId'].includes(key)) || typeof choice.skillId !== 'string'
      || !Number.isSafeInteger(choice.tier) || choice.tier < 0 || choice.tier > 2
      || (choice.choiceId !== null && typeof choice.choiceId !== 'string')) throw new Error('트라이포드 선택 형식을 확인하세요');
    const key = `${choice.skillId}:${choice.tier}`;
    if (seen.has(key)) throw new Error('같은 스킬·티어의 트라이포드 선택이 중복됐습니다');
    seen.add(key);
    if (!targets.has(choice.skillId)) targets.set(choice.skillId, tripodSkill(raw, choice.skillId));
    const { skill } = targets.get(choice.skillId)!;
    if (!(skill.Tripods ?? []).some(item => item.Tier === choice.tier)) throw new Error('원본에 없는 트라이포드 티어입니다');
    if (choice.choiceId !== null) {
      const found = tripodChoices.find(item => item.id === choice.choiceId);
      if (!found || found.skillId !== choice.skillId || found.skillLevel !== skill.Level || found.tripod.Tier !== choice.tier
        || !skill.Tripods!.some(item => item.Tier === choice.tier && item.Slot === found.tripod.Slot && item.Name === found.tripod.Name))
        throw new Error('저장 트라이포드 선택의 스킬·레벨·티어·슬롯이 대상과 일치하지 않습니다');
    }
  }
  // 검사가 끝난 다음 최종 선택을 원본 복사본에 적용합니다.
  for (const choice of choices) {
    const { skill } = targets.get(choice.skillId)!;
    const selected = tripodChoices.find(item => item.id === choice.choiceId);
    skill.Tripods = skill.Tripods!.map(item => item.Tier !== choice.tier ? item
      : selected && item.Slot === selected.tripod.Slot ? { ...structuredClone(selected.tripod), IsSelected: true } : { ...item, IsSelected: false });
  }
  for (const { skill, tooltip, customKey } of targets.values()) {
    tooltip[customKey] = { ...tooltip[customKey], value: Object.fromEntries(skill.Tripods!.filter(item => item.IsSelected)
      .sort((a, b) => a.Tier - b.Tier).map(item => [`Element_${String(item.Tier).padStart(3, '0')}`,
        { name: item.Name, desc: item.Tooltip, lock: false }])) };
    skill.Tooltip = JSON.stringify(tooltip);
  }
  return { changed: choices.length > 0 };
}
