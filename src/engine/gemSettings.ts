import catalog from '../../data/gem_choices.json';
import type { RawArmory } from './armory';
import { SKILL_BY_NAME } from './skilldata';
import { strip, tooltipLines } from './tooltip';

export const gemChoices = catalog.choices;
export interface GemChoice { slot: number; choiceId: string | null }
export type GemAttackMode = 'ratio-approximation';
type Gem = NonNullable<NonNullable<RawArmory['gems']>['Gems']>[number];
type Effect = NonNullable<NonNullable<NonNullable<RawArmory['gems']>['Effects']>['Skills']>[number];

/** 등급표를 추정하지 않고 개별 원본과 요약의 일치를 검사합니다. */
export function gemEvidence(gem: Gem, effect: Effect) {
  const lines = tooltipLines(gem.Tooltip), name = strip(gem.Name);
  const description = effect.Description?.length === 1 ? strip(effect.Description[0]) : '';
  const damage = description.match(/^피해 (\d+(?:\.\d+)?)% 증가$/);
  const cooldown = description.match(/^재사용 대기시간 (\d+(?:\.\d+)?)% 감소$/);
  const option = strip(effect.Option), attack = option.match(/^기본 공격력 (\d+(?:\.\d+)?)% 증가$/);
  if (!Number.isSafeInteger(gem.Slot) || gem.Slot < 0 || effect.GemSlot !== gem.Slot
    || !Number.isSafeInteger(gem.Level) || gem.Level < 1 || !name.startsWith(`${gem.Level}레벨 `)
    || !lines.includes(name) || !lines.includes(`${gem.Grade} 보석`) || !lines.includes(`보석 레벨 ${gem.Level}`)
    || !lines.includes(`[아르카나] ${effect.Name} ${description}추가 효과${option}`)
    || !(damage || cooldown) || Number((damage || cooldown)![1]) >= 100 || !attack || Number(attack[1]) > 100)
    throw new Error('보석 등급·레벨·대상·효과 설명이 일치하지 않습니다');
  return { kind: damage ? 'damage' : 'cooldown', attack: Number(attack[1]), key: `${effect.Name}:${damage ? 'damage' : 'cooldown'}` };
}

export function gemTargetAllowed(raw: RawArmory, name: string): boolean {
  if (name === '황제') return (raw.arkpassive?.Effects ?? []).some(e => e.Name === '깨달음' && /^깨달음 1티어 황제의 칙령 Lv\.[1-3]$/.test(strip(e.Description)));
  return SKILL_BY_NAME.has(name) && raw.combatSkills.filter(s => s.Name === name && s.Level > 1 && s.SkillType === 0).length === 1;
}

export function gemAllocation(raw: RawArmory) {
  const gems = raw.gems?.Gems, effects = raw.gems?.Effects?.Skills;
  const total = strip(raw.gems?.Effects?.Description).match(/^기본 공격력 총합 : (\d+(?:\.\d+)?)%$/);
  if (!gems?.length || !effects || !total || gems.length !== effects.length)
    throw new Error('개별 보석·슬롯·공식 공격력 합계가 없어 실제 보석 편집을 열 수 없습니다');
  const slots = new Set<number>(), keys = new Set<string>();
  const rows = gems.map(gem => {
    const matches = effects.filter(effect => effect.GemSlot === gem.Slot);
    if (slots.has(gem.Slot) || matches.length !== 1) throw new Error('보석 슬롯과 효과의 일대일 대응을 확인하세요');
    slots.add(gem.Slot);
    const effect = matches[0]!, evidence = gemEvidence(gem, effect);
    if (keys.has(evidence.key)) throw new Error('같은 대상·종류의 보석 중복 합산은 지원하지 않습니다');
    keys.add(evidence.key);
    return { gem, effect, ...evidence };
  });
  const sum = Math.round(rows.reduce((n, row) => n + row.attack, 0) * 100) / 100;
  if (sum !== Number(total[1])) throw new Error('개별 보석 옵션과 공식 공격력 합계가 일치하지 않습니다');
  return { rows, total: sum };
}

export function applyGems(raw: RawArmory, choices: GemChoice[], mode?: GemAttackMode) {
  if (mode !== undefined && mode !== 'ratio-approximation') throw new Error('보석 공격력 환산 방식을 확인하세요');
  if (!choices.length) return { changed: false };
  const original = gemAllocation(raw), selected = new Map<number, { gem: Gem; effect: Effect; attack: number; key: string } | null>();
  for (const choice of choices) {
    if (!choice || Object.keys(choice).some(key => !['slot', 'choiceId'].includes(key)) || !Number.isSafeInteger(choice.slot)
      || !original.rows.some(row => row.gem.Slot === choice.slot) || selected.has(choice.slot))
      throw new Error('원본 보석 슬롯이 없거나 선택이 중복됐습니다');
    if (choice.choiceId === null) { selected.set(choice.slot, null); continue; }
    const found = gemChoices.find(item => item.id === choice.choiceId);
    if (!found || !gemTargetAllowed(raw, found.effect.Name)) throw new Error('보석 관측 묶음 또는 장착 대상을 확인하세요');
    const evidence = gemEvidence(found.gem, found.effect);
    if (found.effect.Name === '황제' && evidence.kind !== 'damage') throw new Error('황제 쿨 보석은 지원하지 않습니다');
    const gem = { ...structuredClone(found.gem), Slot: choice.slot };
    const effect: Effect = { ...structuredClone(found.effect), GemSlot: choice.slot };
    // 다른 캐릭터·다른 트라이포드의 스킬 툴팁을 새 근거로 사용하지 않습니다.
    delete effect.Tooltip;
    selected.set(choice.slot, { gem, effect, ...evidence });
  }
  const rows = original.rows.flatMap(row => selected.has(row.gem.Slot) ? selected.get(row.gem.Slot) ?? [] : [row]);
  if (rows.some(row => !gemTargetAllowed(raw, row.effect.Name))) throw new Error('보석 장착 대상이 없거나 계열과 일치하지 않습니다');
  if (new Set(rows.map(row => row.key)).size !== rows.length) throw new Error('같은 대상·종류의 보석 중복 합산은 지원하지 않습니다');
  const total = Math.round(rows.reduce((n, row) => n + row.attack, 0) * 100) / 100;
  const changed = rows.length !== original.rows.length || rows.some((row, index) => {
    const old = original.rows[index]!;
    return row.key !== old.key || row.gem.Name !== old.gem.Name || row.gem.Grade !== old.gem.Grade
      || row.gem.Level !== old.gem.Level || row.attack !== old.attack || JSON.stringify(row.effect.Description) !== JSON.stringify(old.effect.Description);
  });
  if (!changed) return { changed: false, before: original.total, total };
  let base: number | undefined;
  if (total !== original.total) {
    if (mode !== 'ratio-approximation') throw new Error('보석 합계가 바뀝니다. 기본 공격력 비율 환산 근사를 명시적으로 선택하세요');
    const stats = raw.profiles.Stats.filter(s => s.Type === '공격력');
    const lines = stats[0]?.Tooltip?.map(strip) ?? [];
    const matches = lines.flatMap((line, index) => {
      const match = line.replaceAll(',', '').match(/기본 공격력은 (\d+(?:\.\d+)?) 입니다/);
      return match ? [{ index, value: Number(match[1]) }] : [];
    });
    if (stats.length !== 1 || matches.length !== 1 || !Number.isFinite(matches[0]!.value) || matches[0]!.value <= 0
      || !Number.isFinite(Number(stats[0]!.Value.replaceAll(',', ''))) || Number(stats[0]!.Value.replaceAll(',', '')) <= 0)
      throw new Error('보석 합계 환산에 필요한 원본 기본 공격력이 없습니다');
    base = matches[0]!.value * (100 + total) / (100 + original.total);
    stats[0]!.Tooltip = lines.map((line, index) => index === matches[0]!.index
      ? line.replaceAll(',', '').replace(/기본 공격력은 \d+(?:\.\d+)? 입니다/, `기본 공격력은 ${base} 입니다`) : line);
  }
  const effectOrder = raw.gems!.Effects!.Skills!.map(effect => effect.GemSlot);
  for (const row of rows) delete row.effect.Tooltip;
  raw.gems!.Gems = rows.map(row => row.gem);
  raw.gems!.Effects = { Description: `기본 공격력 총합 : ${total.toFixed(2)}%`,
    Skills: effectOrder.flatMap(slot => rows.filter(row => row.gem.Slot === slot).map(row => row.effect)) };
  for (const skill of raw.combatSkills) {
    const tooltip = JSON.parse(skill.Tooltip);
    const descriptions = rows.filter(row => row.effect.Name === skill.Name)
      .map(row => `[아르카나] ${skill.Name} ${row.effect.Description![0]}`).join('<BR>');
    let hasSummary = false;
    for (const [key, part] of Object.entries(tooltip) as [string, any][]) {
      if (part?.type !== 'ItemPartBox' || strip(part.value?.Element_000) !== '보석 효과') continue;
      hasSummary = true;
      if (descriptions) part.value.Element_001 = descriptions;
      else delete tooltip[key];
    }
    if (descriptions && !hasSummary) tooltip.SettingGemEffects = { type: 'ItemPartBox', value: { Element_000: '보석 효과', Element_001: descriptions } };
    skill.Tooltip = JSON.stringify(tooltip);
  }
  return { changed, before: original.total, total, base };
}
