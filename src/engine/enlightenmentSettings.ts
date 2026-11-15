import catalog from '../../data/arkpassive.json';
import observed from '../../data/enlightenment_choices.json';
import type { RawArmory } from './armory';
import { strip } from './tooltip';

export interface EnlightenmentChoice { nodeId: string; level: number }
type Effect = NonNullable<RawArmory['arkpassive']>['Effects'][number];
export const enlightenmentNodes = Object.entries(catalog.enlightenment).flatMap(([variant, nodes]) => nodes.map(node => ({
  id: node.id, name: node.name, tier: node.tier, variant, side: observed.sideNodeIds.includes(node.id),
  max: observed.sideNodeIds.includes(node.id) ? 5 : node.tier === 2 ? 2 : 3,
})));
export const enlightenmentEffects = observed.choices;

export function enlightenmentAllocation(raw: RawArmory) {
  const selected: { node: typeof enlightenmentNodes[number]; level: number; effect: Effect }[] = [];
  for (const effect of raw.arkpassive?.Effects ?? []) {
    const description = strip(effect.Description);
    if (effect.Name !== '깨달음' && !description.startsWith('깨달음')) continue;
    const match = description.match(/^깨달음 ([1-4])티어 (.+) Lv\.(\d+)$/);
    const node = match && enlightenmentNodes.find(item => item.name === match[2] && item.tier === Number(match[1]));
    const level = Number(match?.[3]);
    if (effect.Name !== '깨달음' || !node || !Number.isSafeInteger(level) || level < 1 || level > node.max)
      throw new Error(`원본 깨달음 노드의 티어·레벨을 확인할 수 없습니다: ${description}`);
    if (selected.some(item => item.node.id === node.id)) throw new Error(`깨달음 노드가 중복됐습니다: ${node.name}`);
    selected.push({ node, level, effect });
  }
  const anchors = selected.filter(item => item.node.tier === 1);
  if (anchors.length !== 1 || selected.some(item => !item.node.side && item.node.variant !== anchors[0]!.node.variant))
    throw new Error('깨달음 메인 경로의 계열이 없거나 서로 섞여 있습니다');
  return selected;
}

/** 원본 복사본의 사이드만 바꿉니다. 포인트 비용·선행 조건은 검증하지 않습니다. */
export function applyEnlightenment(raw: RawArmory, choices: EnlightenmentChoice[]) {
  if (!Array.isArray(choices)) throw new Error('깨달음 선택은 배열이어야 합니다');
  const original = enlightenmentAllocation(raw), chosen = new Map(original.map(item => [item.node.id, item]));
  const seen = new Set<string>();
  let changed = false;
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice) || Object.keys(choice).some(key => !['nodeId', 'level'].includes(key)))
      throw new Error('깨달음 선택 형식을 확인하세요');
    const node = enlightenmentNodes.find(item => item.id === choice.nodeId);
    if (!node?.side) throw new Error('깨달음 메인 경로는 고정합니다. 지원하는 사이드 노드를 선택하세요.');
    if (!Number.isSafeInteger(choice.level) || choice.level < 0 || choice.level > node.max) throw new Error(`깨달음 노드 레벨 범위를 확인하세요: ${node.name}`);
    if (seen.has(node.id)) throw new Error(`깨달음 선택이 중복됐습니다: ${node.name}`);
    seen.add(node.id);
    if (choice.level === (chosen.get(node.id)?.level ?? 0)) continue;
    changed = true;
    if (choice.level === 0) chosen.delete(node.id);
    else {
      const found = enlightenmentEffects.find(item => item.nodeId === node.id && item.level === choice.level);
      if (!found) throw new Error(`저장된 지원 효과 설명이 없는 깨달음 레벨입니다: ${node.name} Lv.${choice.level}`);
      chosen.set(node.id, { node, level: choice.level, effect: structuredClone(found.effect) });
    }
  }
  const budgets = raw.arkpassive?.Points?.filter(item => item.Name === '깨달음') ?? [];
  if (budgets.length > 1 || budgets.some(item => !Number.isSafeInteger(item.Value) || item.Value < 0)) throw new Error('원본 깨달음 포인트 공급량을 확인하세요');
  if (changed) {
    const effects: Effect[] = [], remaining = new Map(chosen);
    for (const effect of raw.arkpassive!.Effects) {
      const prior = original.find(item => item.effect === effect);
      if (!prior) effects.push(effect);
      else {
        const next = remaining.get(prior.node.id);
        if (next) effects.push(next.effect);
        remaining.delete(prior.node.id);
      }
    }
    let index = 0;
    for (let i = 0; i < effects.length; i++) if (effects[i]!.Name === '깨달음') index = i + 1;
    for (const next of remaining.values()) effects.splice(index++, 0, next.effect);
    raw.arkpassive = { ...raw.arkpassive!, Effects: effects };
  }
  return { changed, variant: original.find(item => item.node.tier === 1)!.node.variant, available: budgets[0]?.Value ?? null };
}
