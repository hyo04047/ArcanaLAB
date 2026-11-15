import { readFileSync } from 'node:fs';
import type { RawArmory } from '../src/engine/armory';
import type { SettingSelections } from '../src/engine/settings';
import gems from '../data/gem_choices.json';
import cores from '../data/core_choices.json';
import tripods from '../data/tripod_choices.json';
import evolution from '../data/evolution_choices.json';
import enlightenment from '../data/enlightenment_choices.json';
import skills from '../data/skills.json';
import { strip } from '../src/engine/tooltip';

export const axes = ['runes', 'evolution', 'stats', 'enlightenment', 'cores', 'tripods', 'gems'] as const;
export type Axis = typeof axes[number];
export const caseIds = ['emperor', 'empress', 'empress-synthetic-gem'] as const;
export type CaseId = typeof caseIds[number];
export const normal = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function sevenAxisCase(id: CaseId) {
  const variant = id === 'emperor' ? 'emperor' : 'empress';
  const sourcePath = `tests/fixtures/audit/2026-10-28-gem-settings/input-${variant}.json`;
  const saved = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const raw: RawArmory = structuredClone(saved.setting.baseline.raw);
  const synthetic = id === 'empress-synthetic-gem';
  if (synthetic) {
    const gem = gems.choices.find(c => c.effect.Name === '스트림 오브 엣지' && c.gem.Level === 10)!;
    raw.gems = { Gems: [structuredClone(gem.gem)], Effects: { Description: '기본 공격력 총합 : 1.20%', Skills: [structuredClone(gem.effect)] } };
  }
  const core = cores.choices.find(c => variant === 'emperor' ? c.slot.Name.endsWith(' : 황제의 심장')
    : c.slot.Name.endsWith(' : 인피니티 덱') && c.slot.Grade === '고대')!;
  const tripod = tripods.choices.find(c => c.skillId === 'call_of_destiny' && c.enhancementLevel === null
    && c.tripod.Name === (variant === 'emperor' ? '페이크 플립' : '연속 공격'))!;
  const gem = gems.choices.find(c => c.effect.Name === (variant === 'emperor' ? '황제' : '스트림 오브 엣지') && c.gem.Level === 8)!;
  const partner = variant === 'emperor' ? 'return' : 'scratch_dealer';
  const edits: Partial<SettingSelections> = {
    runes: [{ targetSkillId: 'call_of_destiny', sourceSkillId: partner }, { targetSkillId: partner, sourceSkillId: 'call_of_destiny' }],
    evolution: [{ nodeId: 'stat_치명', level: variant === 'emperor' ? 11 : 8 }, { nodeId: 'stat_신속', level: variant === 'emperor' ? 29 : 2 },
      { nodeId: 'crush', level: 0 }, { nodeId: 'master', level: 1 }],
    stats: { crit: 700, spec: variant === 'emperor' ? 200 : 1800 },
    enlightenment: [{ nodeId: variant === 'emperor' ? 'empress_knight' : 'emperor_judgment', level: variant === 'emperor' ? 5 : 2 }],
    cores: [{ targetIndex: core.slot.Index, choiceId: core.id }], coreGemMode: 'individual-approximation',
    tripods: [{ skillId: 'call_of_destiny', tier: 2, choiceId: tripod.id }],
    ...(variant === 'emperor' || synthetic ? { gems: [{ slot: variant === 'emperor' ? 0 : 8, choiceId: gem.id }], gemAttackMode: 'ratio-approximation' as const } : {}),
  };
  return { id, variant, raw, edits, availableAxes: axes.filter(axis => edits[axis] !== undefined),
    source: { kind: synthetic ? 'synthetic' as const : 'api-snapshot' as const,
      reference: sourcePath + (synthetic ? ' + 관측 스트림 Lv.10 보석 1개를 넣은 합성 기준; 실제 황후 장착·공격력 아님' : '') } };
}

export function selectAxes(edits: Partial<SettingSelections>, selected: readonly Axis[]): Partial<SettingSelections> {
  return structuredClone(Object.fromEntries(Object.entries(edits).filter(([key]) => selected.includes(key as Axis)
    || key === 'coreGemMode' && selected.includes('cores') || key === 'gemAttackMode' && selected.includes('gems'))));
}

export function representativeSubsets(available: Axis[]): Axis[][] {
  return [[], ...available.map(axis => [axis]), ...available.flatMap((axis, index) => available.slice(index + 1).map(other => [axis, other])),
    available, ...available.map(axis => available.filter(other => other !== axis))];
}

/** 검사용 독립 원본입니다. apply* 함수를 쓰지 않고 관측 객체와 직접 계산값을 넣습니다. */
export function independentRaw(original: RawArmory, edits: Partial<SettingSelections>): RawArmory {
  const raw = structuredClone(original);
  const skillName = (id: string) => skills.skills.find(skill => skill.id === id)!.name;
  for (const choice of edits.runes ?? []) raw.combatSkills.find(s => s.Name === skillName(choice.targetSkillId))!.Rune
    = choice.sourceSkillId === null ? null : structuredClone(original.combatSkills.find(s => s.Name === skillName(choice.sourceSkillId!))!.Rune);
  const nodes = raw.arkpassive!.Effects;
  for (const [key, name] of [['crit', '치명'], ['spec', '특화'], ['swift', '신속']] as const) {
    const current = nodes.find(e => strip(e.Description).startsWith(`진화 1티어 ${name} Lv.`));
    const oldLevel = current ? Number(strip(current.Description).match(/Lv\.(\d+)$/)![1]) : 0;
    const newLevel = edits.evolution?.find(e => e.nodeId === `stat_${name}`)?.level ?? oldLevel;
    const stat = raw.profiles.Stats.find(s => s.Type === name)!;
    const before = Number(stat.Value.replaceAll(',', ''));
    const after = edits.stats?.[key] ?? before + 50 * (newLevel - oldLevel);
    if (before !== after) { stat.Value = String(after); delete stat.Tooltip; }
    if (current && oldLevel !== newLevel) {
      const index = nodes.indexOf(current);
      if (!newLevel) nodes.splice(index, 1);
      else nodes[index] = { Name: '진화', Description: `진화 1티어 ${name} Lv.${newLevel}` };
    }
  }
  if (edits.evolution?.some(e => e.nodeId === 'master')) {
    const index = nodes.findIndex(e => strip(e.Description) === '진화 4티어 분쇄 Lv.1');
    nodes[index] = structuredClone(evolution.choices.find(e => e.nodeId === 'master' && e.level === 1)!.effect);
  }
  for (const choice of edits.enlightenment ?? []) {
    const found = enlightenment.choices.find(e => e.nodeId === choice.nodeId && e.level === choice.level)!;
    const prefix = strip(found.effect.Description).replace(/Lv\.\d+$/, 'Lv.');
    const index = nodes.findIndex(e => strip(e.Description).startsWith(prefix));
    if (index >= 0) nodes[index] = structuredClone(found.effect);
    else {
      const last = nodes.reduce((pos, e, i) => e.Name === '깨달음' ? i : pos, -1);
      nodes.splice(last + 1, 0, structuredClone(found.effect));
    }
  }
  for (const choice of edits.cores ?? []) {
    const found = cores.choices.find(c => c.id === choice.choiceId)!;
    raw.arkgrid!.Slots = raw.arkgrid!.Slots.map(s => s.Index === choice.targetIndex ? structuredClone(found.slot) : s);
    delete raw.arkgrid!.Effects;
  }
  for (const choice of edits.tripods ?? []) {
    const skill = raw.combatSkills.find(s => s.Name === skillName(choice.skillId))!;
    const found = tripods.choices.find(c => c.id === choice.choiceId)!;
    skill.Tripods = skill.Tripods!.map(t => t.Tier !== choice.tier ? t : t.Slot === found.tripod.Slot
      ? { ...structuredClone(found.tripod), IsSelected: true } : { ...t, IsSelected: false });
  }
  if (edits.gems?.length) {
    const before = Number(strip(raw.gems!.Effects!.Description).match(/[\d.]+/)![0]);
    for (const choice of edits.gems) {
      const found = gems.choices.find(c => c.id === choice.choiceId)!;
      raw.gems!.Gems = raw.gems!.Gems!.map(g => g.Slot === choice.slot ? { ...structuredClone(found.gem), Slot: choice.slot } : g);
      raw.gems!.Effects!.Skills = raw.gems!.Effects!.Skills!.map(g => g.GemSlot === choice.slot ? { ...structuredClone(found.effect), GemSlot: choice.slot } : g);
    }
    const total = Math.round(raw.gems!.Effects!.Skills!.reduce((n, e) => n + Number(e.Option!.match(/[\d.]+/)![0]), 0) * 100) / 100;
    const stat = raw.profiles.Stats.find(s => s.Type === '공격력')!;
    stat.Tooltip = stat.Tooltip!.map(line => strip(line).replace(/기본 공격력은 (\d+) 입니다/, (_, base) => `기본 공격력은 ${Number(base) * (100 + total) / (100 + before)} 입니다`));
    raw.gems!.Effects!.Description = `기본 공격력 총합 : ${total.toFixed(2)}%`;
  }
  return raw;
}
