import catalog from '../../data/arkpassive.json';
import observed from '../../data/evolution_choices.json';
import type { RawArmory } from './armory';
import { strip } from './tooltip';

export interface EvolutionChoice { nodeId: string; level: number }
type Effect = NonNullable<RawArmory['arkpassive']>['Effects'][number];
export const evolutionNodes = Object.entries(catalog.evolution).flatMap(([key, tier]) => tier.nodes.map(node => {
  const first = typeof node === 'string';
  return { id: first ? `stat_${node}` : node.id, name: first ? node : node.name, tier: Number(key.slice(4)),
    max: first ? catalog.evolution.tier1.maxLevel : 'max' in node ? node.max : 1,
    cost: 'costPerLevel' in tier ? tier.costPerLevel : tier.costPerNode, tierLimit: tier.maxPoints };
}));
export const evolutionEffects = observed.choices;

/** 비용이나 티어를 읽을 수 없는 원본을 비용 0의 노드로 취급하지 않습니다. */
export function evolutionAllocation(raw: RawArmory) {
  const selected: { node: typeof evolutionNodes[number]; level: number; effect: Effect }[] = [];
  for (const effect of raw.arkpassive?.Effects ?? []) {
    const description = strip(effect.Description);
    if (effect.Name !== '진화' && !description.startsWith('진화')) continue;
    const match = description.match(/^진화 ([1-5])티어 (.+) Lv\.(\d+)$/);
    const node = match && evolutionNodes.find(item => item.name === match[2] && item.tier === Number(match[1]));
    const level = Number(match?.[3]);
    if (effect.Name !== '진화' || !node || !Number.isSafeInteger(level) || level < 1 || level > node.max)
      throw new Error(`원본 진화 노드의 티어·레벨·포인트를 확인할 수 없습니다: ${description}`);
    if (selected.some(item => item.node.id === node.id)) throw new Error(`진화 노드가 중복됐습니다: ${node.name}`);
    selected.push({ node, level, effect });
  }
  return selected;
}

/** 원본 복사본에 선택을 적용합니다. 호출자는 원본을 직접 넘기지 않습니다. */
export function applyEvolution(raw: RawArmory, choices: EvolutionChoice[]) {
  if (!Array.isArray(choices)) throw new Error('진화 선택은 배열이어야 합니다');
  const original = evolutionAllocation(raw), chosen = new Map(original.map(item => [item.node.id, item]));
  const seen = new Set<string>();
  let changed = false;
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice) || Object.keys(choice).some(key => !['nodeId', 'level'].includes(key)))
      throw new Error('진화 선택 형식을 확인하세요');
    const node = evolutionNodes.find(item => item.id === choice.nodeId);
    if (!node || (node.tier === 1 && !['치명', '특화', '신속'].includes(node.name)))
      throw new Error('지원하는 진화 노드를 선택하세요. 1티어는 치명·특화·신속만 변경할 수 있습니다.');
    if (!Number.isSafeInteger(choice.level) || choice.level < 0 || choice.level > node.max) throw new Error(`진화 노드 레벨 범위를 확인하세요: ${node.name}`);
    if (seen.has(node.id)) throw new Error(`진화 선택이 중복됐습니다: ${node.name}`);
    seen.add(node.id);
    if (choice.level === (chosen.get(node.id)?.level ?? 0)) continue;
    changed = true;
    if (choice.level === 0) chosen.delete(node.id);
    else {
      const found = evolutionEffects.find(item => item.nodeId === node.id && item.level === choice.level);
      if (node.tier !== 1 && !found) throw new Error(`저장된 지원 효과 설명이 없는 진화 레벨입니다: ${node.name} Lv.${choice.level}`);
      // 1티어는 특성 연동에서 처리한 합성 선택이며 공식 관측 툴팁을 만들지 않습니다.
      const effect = node.tier === 1 ? { Name: '진화', Description: `진화 1티어 ${node.name} Lv.${choice.level}` } : structuredClone(found!.effect);
      chosen.set(node.id, { node, level: choice.level, effect });
    }
  }
  const tiers = [1, 2, 3, 4, 5].map(tier => ({ tier,
    spent: [...chosen.values()].filter(item => item.node.tier === tier).reduce((sum, item) => sum + item.node.cost * item.level, 0),
    limit: evolutionNodes.find(node => node.tier === tier)!.tierLimit }));
  for (const tier of tiers) if (tier.spent > tier.limit) throw new Error(`진화 ${tier.tier}티어 포인트 초과: ${tier.spent}/${tier.limit}P`);
  const budgets = raw.arkpassive?.Points?.filter(item => item.Name === '진화') ?? [];
  if (budgets.length > 1 || budgets.some(item => !Number.isSafeInteger(item.Value) || item.Value < 0)) throw new Error('원본 진화 포인트 공급량을 확인하세요');
  const available = budgets[0]?.Value ?? null, spent = tiers.reduce((sum, tier) => sum + tier.spent, 0);
  if (available !== null && spent > available) throw new Error(`진화 총 포인트 초과: ${spent}/${available}P`);
  if (changed) {
    const effects: Effect[] = [];
    const remaining = new Map(chosen);
    for (const effect of raw.arkpassive?.Effects ?? []) {
      const prior = original.find(item => item.effect === effect);
      if (!prior) effects.push(effect);
      else {
        const next = remaining.get(prior.node.id);
        if (next) effects.push(next.effect);
        else {
          const replacement = [...remaining.values()].find(item => item.node.tier === prior.node.tier
            && !original.some(old => old.node.id === item.node.id));
          if (replacement) { effects.push(replacement.effect); remaining.delete(replacement.node.id); }
        }
        remaining.delete(prior.node.id);
      }
    }
    // 새 노드도 같은 티어의 마지막 위치에 넣어 관련 효과의 기존 순서를 유지합니다.
    for (const next of remaining.values()) {
      let index = -1;
      for (let i = 0; i < effects.length; i++) if (strip(effects[i]!.Description).startsWith(`진화 ${next.node.tier}티어 `)) index = i;
      effects.splice(index < 0 ? effects.length : index + 1, 0, next.effect);
    }
    raw.arkpassive = { ...raw.arkpassive, Effects: effects };
  }
  return { changed, tiers, spent, available };
}
