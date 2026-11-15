import catalog from '../../data/arkpassive.json';
import type { RawArmory } from './armory';
import { evolutionAllocation, type EvolutionChoice } from './evolutionSettings';
import { statMods } from './presets';
import { tooltipLines } from './tooltip';

export const statNames = { crit: '치명', spec: '특화', swift: '신속' } as const;
export type StatKey = keyof typeof statNames;
/** 진화 1티어를 포함한 최종 총합입니다. 생략하면 원본과 노드 변화로 계산합니다. */
export type StatSelections = Partial<Record<StatKey, number>>;

export function profileStat(raw: RawArmory, key: StatKey) {
  const matches = raw.profiles.Stats.filter(stat => stat.Type === statNames[key]);
  const text = matches[0]?.Value.replace(/,/g, '') ?? '', value = Number(text);
  if (matches.length !== 1 || !/^\d+$/.test(text) || !Number.isSafeInteger(value))
    throw new Error(`원본 ${statNames[key]} 총합을 확인할 수 없습니다`);
  return { entry: matches[0]!, value };
}

/** 원본 복사본에만 적용하며, 변경한 특성의 이전 효과 설명은 모두 무효화합니다. */
export function applyStatSelections(raw: RawArmory, totals: StatSelections | undefined, evolution: EvolutionChoice[]) {
  if (totals !== undefined && (!totals || typeof totals !== 'object' || Array.isArray(totals)
    || Object.keys(totals).some(key => !Object.hasOwn(statNames, key)))) throw new Error('최종 특성 선택 형식을 확인하세요');
  for (const value of Object.values(totals ?? {})) if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('최종 특성 총합은 음수가 아닌 안전한 정수여야 합니다');
  const tierOne = evolution.filter(choice => Object.values(statNames).some(name => choice.nodeId === `stat_${name}`));
  const changed: StatKey[] = [], linked: StatKey[] = [];
  if (!tierOne.length && !Object.keys(totals ?? {}).length) return { changed, linked };
  const original = evolutionAllocation(raw);
  const updates: { key: StatKey; entry: RawArmory['profiles']['Stats'][number]; value: number }[] = [];
  for (const key of Object.keys(statNames) as StatKey[]) {
    const name = statNames[key], nodeId = `stat_${name}`, choice = tierOne.find(item => item.nodeId === nodeId);
    const old = original.find(item => item.node.id === nodeId), oldLevel = old?.level ?? 0;
    const level = choice?.level ?? oldLevel, explicit = totals?.[key];
    if (explicit === undefined && level === oldLevel) continue;
    const { entry, value: initial } = profileStat(raw, key);
    const perLevel = catalog.evolution.tier1.statPerLevel;
    if (level !== oldLevel) linked.push(key);
    let value = explicit;
    if (value === undefined) {
      if (!raw.arkpassive) throw new Error(`${name} 자동 연동에는 원본 진화 정보가 필요합니다. 최종 총합을 직접 지정하세요.`);
      const lines = tooltipLines(old?.effect.ToolTip).map(line => line.replace(/\|\|/g, '').trim());
      const expected = `${name}${name === '특화' ? '가' : '이'} ${oldLevel * perLevel} 증가합니다.`;
      const contributions = lines.filter(line => line.startsWith(`${name}${name === '특화' ? '가' : '이'} `));
      if ((old && (contributions.length !== 1 || contributions[0] !== expected)) || initial < oldLevel * perLevel)
        throw new Error(`${name}의 원본 1티어 기여를 확인할 수 없습니다. 최종 총합을 직접 지정하세요.`);
      value = initial + (level - oldLevel) * perLevel;
    }
    if (!Number.isSafeInteger(value) || value < 0 || value < level * perLevel)
      throw new Error(`${name} 최종 총합이 올바르지 않거나 1티어 기여보다 작습니다`);
    if (value !== initial) {
      if (key === 'swift' && statMods({ crit: 0, spec: 0, swift: value }).mods.some(mod => mod.bucket === 'cooldown' && mod.value >= 1))
        throw new Error('신속 근사 쿨타임 감소가 100% 이상입니다');
      updates.push({ key, entry, value });
      changed.push(key);
    }
  }
  for (const update of updates) {
    update.entry.Value = String(update.value);
    delete update.entry.Tooltip;
  }
  return { changed, linked };
}
