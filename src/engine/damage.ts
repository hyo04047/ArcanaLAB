// 피해 공식 (docs/mechanics.md §1). 버킷별 합산/곱산 후 치명 판정.
import type { Bucket, Build, Modifier, SkillDef, SkillFilter } from './types';
import { combinedChance, type Rng } from './rng';

export interface DamageEnv {
  atkBase: number;
  bluntThorn?: Build['bluntThorn'];
  raidCaptainRatio?: number;
}

export interface HitContext {
  skill: SkillDef;
  stacks: number; // 대상 스택(루인은 소모되는 스택)
  component: 'direct' | 'stack' | 'dot';
}

/** T 슬롯 분류와 직업 분류(루인/일반)를 함께 확인합니다. */
export function skillMatches(f: SkillFilter | undefined, skill: SkillDef): boolean {
  if (f === undefined) return true;
  if (f === null || typeof f !== 'object' || Array.isArray(f))
    throw new TypeError('스킬 조건은 객체여야 합니다.');
  const hasKind = (kind: SkillDef['kind']) => kind === skill.kind ||
    (skill.kind === 'hyper_awakening' && (kind === 'ruin' || kind === 'normal') && !!skill.tags?.includes(kind));
  if (f.kinds !== undefined && (!Array.isArray(f.kinds) || !f.kinds.every(kind => typeof kind === 'string')))
    throw new TypeError('포함 스킬 분류는 문자열 배열이어야 합니다.');
  if (f.kinds && !f.kinds.some(hasKind)) return false;
  if (f.excludeKinds !== undefined && (!Array.isArray(f.excludeKinds) || !f.excludeKinds.every(kind => typeof kind === 'string')))
    throw new TypeError('제외 스킬 분류는 문자열 배열이어야 합니다.');
  if (f.excludeKinds?.some(hasKind)) return false;
  if (f.ids !== undefined && (!Array.isArray(f.ids) || !f.ids.every(id => typeof id === 'string')))
    throw new TypeError('스킬 ID 조건은 문자열 배열이어야 합니다.');
  if (f.ids && !f.ids.includes(skill.id)) return false;
  if (f.usesMana !== undefined && typeof f.usesMana !== 'boolean')
    throw new TypeError('마나 사용 조건은 boolean이어야 합니다.');
  if (f.usesMana && skill.usesMana !== true) return false;
  return true;
}

export function filterMatches(f: SkillFilter | undefined, ctx: HitContext): boolean {
  if (!skillMatches(f, ctx.skill)) return false;
  if (!f) return true;
  if (f.minStacks !== undefined && !Number.isFinite(f.minStacks)) throw new TypeError('최소 스택 조건은 유한한 숫자여야 합니다.');
  if (f.minStacks !== undefined && ctx.stacks < f.minStacks) return false;
  if (f.component !== undefined && !['direct', 'stack', 'dot'].includes(f.component))
    throw new TypeError('피해 대상 조건은 direct, stack 또는 dot이어야 합니다.');
  if (f.component && f.component !== ctx.component) return false;
  return true;
}

/** 수치 계산용 버킷만으로 도트 적용 여부를 확정하지 않습니다. */
export function appliesToDot(mod: Modifier): boolean {
  if (mod.dotScope !== undefined && !['include', 'exclude'].includes(mod.dotScope))
    throw new TypeError('도트 적용 범위는 include 또는 exclude여야 합니다.');
  if (mod.dotScope) return mod.dotScope === 'include';
  return mod.bucket !== 'skillDmg' || mod.filter?.component === 'dot';
}

export interface Multipliers {
  atk: number;
  addDmg: number;
  dmgToEnemy: number;
  evoDmg: number;
  critRate: number; // 캡 적용 후
  critDmg: number; // 2.0 + Σ
  critHitDmg: number;
  skillDmg: number;
  nonCrit: number; // 공격력·치명을 제외한 피해 배율
}

export function modifierValue(mod: Modifier): number {
  if (!Number.isFinite(mod.value)) throw new TypeError(`수정치 수치는 유한한 숫자여야 합니다: ${mod.source}`);
  return mod.value;
}

const modifierBuckets: Record<Bucket, true> = {
  atk: true, atkFlat: true, addDmg: true, dmgToEnemy: true, evoDmg: true, critRate: true, critDmg: true,
  critHitDmg: true, skillDmg: true, emperorCardDmg: true, stackEffectDmg: true, atkSpeed: true, moveSpeed: true, cooldown: true,
};

export function validateModifierBuckets(mods: Modifier[]): void {
  for (const mod of mods) if (typeof mod.bucket !== 'string' || !Object.hasOwn(modifierBuckets, mod.bucket))
    throw new TypeError('수정치 계산 분류가 올바르지 않습니다.');
}

function sum(mods: Modifier[], b: Bucket, ctx: HitContext): number {
  let s = 0;
  for (const m of mods) if (m.bucket === b && filterMatches(m.filter, ctx)) s += modifierValue(m);
  return s;
}
function prod(mods: Modifier[], b: Bucket, ctx: HitContext): number {
  let p = 1;
  for (const m of mods) if (m.bucket === b && filterMatches(m.filter, ctx)) p *= 1 + modifierValue(m);
  return p;
}

export function computeMultipliers(env: DamageEnv, mods: Modifier[], ctx: HitContext): Multipliers {
  validateModifierBuckets(mods);
  if (!Number.isFinite(env.atkBase)) throw new TypeError('기본 공격력은 유한한 숫자여야 합니다.');
  if (env.raidCaptainRatio !== undefined && !Number.isFinite(env.raidCaptainRatio))
    throw new TypeError('돌격대장 비율은 유한한 숫자여야 합니다.');
  if (env.bluntThorn && ![env.bluntThorn.base, env.bluntThorn.ratio, env.bluntThorn.cap].every(Number.isFinite))
    throw new TypeError('뭉툭한 가시 수치는 유한한 숫자여야 합니다.');
  if (ctx.component === 'dot') mods = mods.filter(appliesToDot);
  const atk = (env.atkBase + sum(mods, 'atkFlat', ctx)) * (1 + sum(mods, 'atk', ctx));
  const addDmg = 1 + sum(mods, 'addDmg', ctx);
  const moveBonus = Math.max(0, Math.min(0.4, sum(mods, 'moveSpeed', ctx)));
  const dmgToEnemy = prod(mods, 'dmgToEnemy', ctx) * (1 + moveBonus * (env.raidCaptainRatio ?? 0));
  let evo = sum(mods, 'evoDmg', ctx);
  const rawCrit = sum(mods, 'critRate', ctx);
  let critRate = Math.min(1, Math.max(0, rawCrit));
  if (env.bluntThorn) {
    const cap = 0.8;
    evo += Math.min(env.bluntThorn.cap, env.bluntThorn.base + Math.max(0, rawCrit - cap) * env.bluntThorn.ratio);
    critRate = Math.min(critRate, cap);
  }
  const evoDmg = 1 + evo;
  const critDmg = 2 + sum(mods, 'critDmg', ctx);
  const critHitDmg = prod(mods, 'critHitDmg', ctx);
  const skillDmg = prod(mods, 'skillDmg', ctx) * (1 + sum(mods, 'emperorCardDmg', ctx))
    * (ctx.component === 'stack' ? prod(mods, 'stackEffectDmg', ctx) : 1);
  const nonCrit = addDmg * dmgToEnemy * evoDmg * skillDmg;
  return { atk, addDmg, dmgToEnemy, evoDmg, critRate, critDmg, critHitDmg, skillDmg, nonCrit };
}

/** 고정항 0·공격력 계수 1의 치명 포함 기대 피해 (기존 배율 분석용) */
export function expectedMultiplier(m: Multipliers): number {
  return m.atk * m.nonCrit * ((1 - m.critRate) + m.critRate * m.critDmg * m.critHitDmg);
}

/** 기본 피해 두 항을 합친 뒤 피해 배율·치명을 적용합니다. flat은 고정 피해 평균입니다. */
export function rollHit(rng: Rng, coef: number, m: Multipliers, flat = 0): { dmg: number; crit: boolean } {
  if (!Number.isFinite(coef) || !Number.isFinite(flat)) throw new TypeError('피해의 계수·고정항은 유한한 숫자여야 합니다.');
  const crit = rng.chance(m.critRate);
  const dmg = (flat + coef * m.atk) * m.nonCrit * (crit ? m.critDmg * m.critHitDmg : 1);
  return { dmg, crit };
}

/** 방어 무시 없는 동일 대상 대비 증폭입니다. 절대 방어 감쇠와 별도 보스 뎀감은 포함하지 않습니다. */
export function rollDefenseIgnore(rng: Rng, skill: SkillDef, targetDefense = 6500): number {
  const effect = skill.defenseIgnore;
  if (!effect) return 1;
  if (!Number.isFinite(effect.fraction) || effect.fraction < 0 || effect.fraction > 1)
    throw new RangeError('방어 무시 비율은 0 이상 1 이하의 유한한 숫자여야 합니다.');
  if (!Number.isFinite(targetDefense) || targetDefense < 0) throw new Error('targetDefense must be finite and non-negative');
  const chance = combinedChance(effect.chance, skill.tripodChanceBonus ?? 0);
  if (!rng.chance(chance)) return 1;
  return (6500 + targetDefense) / (6500 + targetDefense * (1 - effect.fraction));
}
