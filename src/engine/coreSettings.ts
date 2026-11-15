import observed from '../../data/core_choices.json';
import type { RawArmory } from './armory';
import { enlightenmentAllocation } from './enlightenmentSettings';
import { tooltipLines } from './tooltip';

export interface CoreChoice { targetIndex: number; choiceId: string }
export type CoreGemMode = 'individual-approximation';
type Slot = NonNullable<RawArmory['arkgrid']>['Slots'][number];
export const coreChoices = observed.choices;
const gemEffects = [
  { name: '공격력', pattern: /^공격력 \+([\d.]+)%$/ },
  { name: '추가 피해', pattern: /^추가 피해 \+([\d.]+)%$/ },
  { name: '보스 피해', pattern: /^보스 등급 이상 몬스터에게 주는 피해 \+([\d.]+)%$/ },
  { name: '낙인력', pattern: /^낙인력 \+([\d.]+)%$/ },
  { name: '아군 피해 강화', pattern: /^아군 피해량 강화 효과 \+([\d.]+)%$/ },
  { name: '아군 공격 강화', pattern: /^아군 공격력 강화 효과 \+([\d.]+)%$/ },
];

/** API 포인트와 의지력을 표시 설명으로 대조합니다. 장착 가능성 전체의 판정은 아닙니다. */
export function coreSlotInfo(slot: Slot) {
  const match = slot.Name.match(/^(질서|혼돈)의 (해|달|별) 코어 : (.+)$/), lines = tooltipLines(slot.Tooltip);
  const index = match && ['해', '달', '별'].indexOf(match[2]!) + (match[1] === '혼돈' ? 3 : 0);
  const supplyIndex = lines.indexOf('코어 공급 의지력');
  const supplyMatch = supplyIndex >= 0 && lines[supplyIndex + 1]?.match(/^(\d+) 포인트$/);
  const supply = supplyMatch ? Number(supplyMatch[1]) : NaN;
  if (!match || !Number.isSafeInteger(slot.Index) || slot.Index !== index || !slot.Grade
    || !lines.includes(`${slot.Grade} 아크 그리드 코어`) || !lines.includes(slot.Name)
    || !lines.includes(`${match[1]} - ${match[2]}`) || !Number.isSafeInteger(supply) || supply < 0
    || !Number.isSafeInteger(slot.Point) || slot.Point < 0 || !Array.isArray(slot.Gems) || slot.Gems.length > 4)
    throw new Error(`코어의 슬롯·등급·포인트·의지력 설명을 확인하세요: ${slot.Name}`);
  let points = 0, spent = 0;
  const seen = new Set<number>();
  for (const gem of slot.Gems) {
    if (!Number.isSafeInteger(gem.Index) || gem.Index < 0 || gem.Index > 3 || seen.has(gem.Index) || typeof gem.IsActive !== 'boolean')
      throw new Error(`젬 위치·활성 상태가 없거나 중복됐습니다: ${slot.Name}`);
    seen.add(gem.Index);
    if (!gem.IsActive) continue;
    const texts = tooltipLines(gem.Tooltip), effect = texts.find(text => text.startsWith('필요 의지력 : ')) ?? '';
    const cost = effect.match(/^필요 의지력 : (\d+) \(기본 값 (\d+) [–-] 의지력 효율 (\d+)\)/);
    const point = effect.match(/(질서|혼돈) 포인트 : (\d+)/);
    const options = [...effect.matchAll(/\[([^\]]+)\] Lv\.([1-5])([^[]+)/g)];
    if (!cost || !point || point[1] !== match[1] || !texts.some(text => text.startsWith(`젬 타입 : ${match[1]}`))
      || !cost.slice(1).every(value => Number.isSafeInteger(Number(value))) || Number(cost[1]) !== Number(cost[2]) - Number(cost[3])
      || !Number.isSafeInteger(Number(point[2])) || options.length !== 2 || new Set(options.map(option => option[1])).size !== 2)
      throw new Error(`활성 젬의 의지력·포인트·효과 설명을 확인하세요: ${slot.Name}`);
    for (const option of options) {
      const rule = gemEffects.find(item => item.name === option[1]), value = rule && option[3]!.trim().match(rule.pattern);
      if (!value || !Number.isFinite(Number(value[1])) || Number(value[1]) > 100)
        throw new Error(`활성 젬의 효과 설명을 해석할 수 없습니다: ${slot.Name} / ${option[1]}`);
    }
    spent += Number(cost[1]); points += Number(point[2]);
  }
  if (spent > supply) throw new Error(`코어 의지력 초과: ${slot.Name} ${spent}/${supply}`);
  if (points !== slot.Point) throw new Error(`코어 포인트와 활성 젬 합계가 다릅니다: ${slot.Name} ${slot.Point}/${points}`);
  return { label: `${match[1]}의 ${match[2]} 코어`, points, spent, supply };
}

export function coreAllocation(raw: RawArmory) {
  const passives = enlightenmentAllocation(raw), variant = passives.find(item => item.node.tier === 1)!.node.variant;
  const slots = raw.arkgrid?.Slots;
  if (!slots?.length || new Set(slots.map(slot => slot.Index)).size !== slots.length) throw new Error('원본 코어 슬롯이 없거나 중복됐습니다');
  return { variant, passives, slots: slots.map(slot => ({ slot, ...coreSlotInfo(slot) })) };
}

/** 관측 슬롯 전체를 적용하고 명시적으로 선택한 개별 젬 근사만 허용합니다. */
export function applyCores(raw: RawArmory, choices: CoreChoice[], gemMode?: CoreGemMode) {
  if (!Array.isArray(choices)) throw new Error('코어 선택은 배열이어야 합니다');
  if (gemMode !== undefined && gemMode !== 'individual-approximation') throw new Error('지원하는 코어 젬 합산 방식을 선택하세요');
  if (!choices.length) return { changed: false, slots: [] };
  const original = coreAllocation(raw), slots = raw.arkgrid!.Slots.slice(), seen = new Set<number>();
  let changed = false;
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice) || Object.keys(choice).some(key => !['targetIndex', 'choiceId'].includes(key)))
      throw new Error('코어 선택 형식을 확인하세요');
    const index = slots.findIndex(slot => slot.Index === choice.targetIndex);
    const found = coreChoices.find(item => item.id === choice.choiceId);
    if (!Number.isSafeInteger(choice.targetIndex) || index < 0 || !found || found.slot.Index !== choice.targetIndex)
      throw new Error('저장된 같은 슬롯의 코어·등급·포인트 묶음을 선택하세요');
    if (seen.has(choice.targetIndex)) throw new Error('같은 코어 슬롯의 선택이 중복됐습니다');
    seen.add(choice.targetIndex);
    if (found.variant !== 'common_chaos' && found.variant !== original.variant) throw new Error('같은 계열의 코어만 선택할 수 있습니다');
    if (found.variant !== 'common_chaos') {
      const lines = tooltipLines(found.slot.Tooltip), condition = lines[lines.indexOf('코어 옵션 발동 조건') + 1];
      const names = original.variant === 'empress' ? ['황후의 은총', '황후의 속삭임'] : ['황제의 칙령', '또 다른 황제'];
      if (condition?.replace(/\s+/g, '') !== `${names[0]}전용아크패시브4티어${names[1]}활성화필요`.replace(/\s+/g, '')
        || !original.passives.some(item => item.node.tier === 4 && item.node.name === names[1]))
        throw new Error('코어의 깨달음 활성 조건을 확인하세요');
    }
    coreSlotInfo(found.slot);
    if (JSON.stringify(slots[index]) !== JSON.stringify(found.slot)) { slots[index] = structuredClone(found.slot); changed = true; }
  }
  if (changed && gemMode !== 'individual-approximation') throw new Error('코어 변경은 활성 젬 설명의 개별 합산 근사를 선택해야 적용할 수 있습니다');
  if (changed) {
    raw.arkgrid = { ...raw.arkgrid!, Slots: slots };
    // 선택한 근사 경로입니다. 원본의 공식 합계는 baseline에 그대로 보존합니다.
    delete raw.arkgrid.Effects;
  }
  return { changed, slots: slots.map(slot => ({ name: slot.Name, grade: slot.Grade, ...coreSlotInfo(slot) })) };
}
