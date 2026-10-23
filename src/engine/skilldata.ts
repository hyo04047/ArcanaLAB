// 공개 계수 후보가 있는 기본 효과는 고정항과 공격력항을 분리합니다.
// 그 외 툴팁 숫자는 보스 대상 임시 입력으로 남기며 정규화된 계수로 취급하지 않습니다.
import skillsJson from '../../data/skills.json';
import coefficientsJson from '../../data/skill_coefficients.json';
import ruinDirectJson from '../../data/ruin_direct_coefficients.json';
import ruinCoefficientsJson from '../../data/ruin_coefficients.json';
import serendipityHits from '../../data/serendipity_hits.json';
import evokeEffects from '../../data/evoke_effects.json';
import sunEffects from '../../data/sun_effects.json';
import darkEffects from '../../data/dark_resurrection_effects.json';
import shuffleEffects from '../../data/shuffle_effects.json';
import checkmateEffects from '../../data/checkmate_effects.json';
import callEffects from '../../data/call_of_destiny_effects.json';
import scratchEffects from '../../data/scratch_effects.json';
import spiralEffects from '../../data/spiral_effects.json';
import streamHits from '../../data/stream_hits.json';
import emperorBaseEffects from '../../data/emperor_base_effects.json';
import remainingDirectEffects from '../../data/remaining_direct_effects.json';
import returnHits from '../../data/return_hits.json';
import { filterMatches } from './damage';
import type { Build, SkillDef } from './types';

export type SkillRow = { id: string; name: string; type: string; cooldown: number; maxStacks?: number; baseDamageLv10?: number[]; baseDamageByLevel?: Record<string, { dmg: number[] }>; baseDamageLv10Unequipped?: number | string };
export const SKILL_ROWS = skillsJson.skills as SkillRow[];
export const SKILL_BY_ID = new Map(SKILL_ROWS.map((s) => [s.id, s]));
export const SKILL_BY_NAME = new Map(SKILL_ROWS.map((s) => [s.name, s]));
type DirectEffect = { effectId: number; hits?: number; apByLevel: number[]; flatMinByLevel: number[]; flatMaxByLevel: number[] };
const COEFFICIENTS: Record<string, { effects: DirectEffect[]; url: string }> = {
  evoke: { effects: [evokeEffects.direct], url: evokeEffects._meta.url },
  unlimited_shuffle: { effects: shuffleEffects.effects, url: shuffleEffects._meta.url },
  checkmate: { effects: checkmateEffects.effects, url: checkmateEffects._meta.url },
  scratch_dealer: { effects: scratchEffects.effects, url: scratchEffects._meta.url },
  spiral_edge: { effects: spiralEffects.effects, url: spiralEffects._meta.url },
  ...Object.fromEntries(Object.entries(emperorBaseEffects.skills).map(([id, skill]) => [id, { effects: skill.effects, url: emperorBaseEffects._meta.url }])),
  ...Object.fromEntries(Object.entries(remainingDirectEffects.skills).map(([id, skill]) => [id, { effects: skill.effects, url: remainingDirectEffects._meta.url }])),
  ...Object.fromEntries(Object.entries(coefficientsJson.skills).map(([id, effect]) => [id, { effects: [effect], url: coefficientsJson._meta.url }])),
  ...Object.fromEntries(Object.entries(ruinDirectJson.skills).map(([id, skill]) => [id, { effects: skill.effects, url: ruinDirectJson._meta.url }])),
};
export function resolveEvokePoison(level: number): Pick<NonNullable<SkillDef['manaPoison']>, 'coef' | 'flat' | 'firstTick' | 'interval'> | undefined {
  return poisonCoefficients(evokeEffects.poison, level);
}
export function resolveFearOfDeath(level: number): ReturnType<typeof resolveEvokePoison> {
  return poisonCoefficients(darkEffects.poison, level);
}
/** S107·S130: 첫 2타 뒤 4중첩 가시. 시각은 기존 시전 종료에 몰아 두는 임시값입니다. */
export function resolveFlowerReturnDamage(level: number, damagePerStack: number, thornBonus: number) {
  const effects = emperorBaseEffects.skills.dancing_of_spineflower.effects;
  if (!Number.isInteger(level) || level < 1 || level > effects[0]!.apByLevel.length) return undefined;
  const atLevel = (effectId: number) => {
    const e = effects.find(e => e.effectId === effectId)!;
    return { at: 1, directCoef: e.apByLevel[level - 1]!, directFlat: (e.flatMinByLevel[level - 1]! + e.flatMaxByLevel[level - 1]!) / 2 };
  };
  const first = atLevel(192000), thorn = atLevel(192009);
  // 192011은 192009 계수를 참조합니다. 이미 약 40%이므로 다시 0.4를 곱하지 않습니다.
  const scale = (1 + 4 * damagePerStack) * (1 + thornBonus);
  thorn.directCoef *= scale; thorn.directFlat *= scale;
  const hits = [{ ...first }, { ...first }, thorn];
  return { directCoef: hits.reduce((sum, h) => sum + h.directCoef, 0),
    directFlat: hits.reduce((sum, h) => sum + h.directFlat, 0), hits: hits.length,
    hitSequence: { duration: 1, hits },
    damageReference: { source: 'public-coefficient-candidate' as const, level,
      url: emperorBaseEffects._meta.url, effectIds: [192002, 192011] } };
}
function poisonCoefficients(p: typeof evokeEffects.poison, level: number): ReturnType<typeof resolveEvokePoison> {
  if (!Number.isInteger(level) || level < 1 || level > p.apByLevel.length) return undefined;
  const scale = 1 + p.damageIncreasePercent / 100;
  return { coef: p.apByLevel[level - 1]! * scale,
    flat: (p.flatMinByLevel[level - 1]! + p.flatMaxByLevel[level - 1]!) / 2 * scale,
    firstTick: p.firstTick, interval: p.interval };
}
const RUIN_COEFFICIENTS: Record<string, { apByStack: number[]; flatByStack: number[] }> = ruinCoefficientsJson.skills;

/** 코덱스 피해 배열의 각 숫자에 곱할 타격 횟수 (설명문 기준). 없으면 1. */
const HIT_WEIGHTS: Record<string, number[]> = {
  quadra_accelerate: [4], // 4회 각 252
  dancing_of_spineflower: [6, 1], // 245×6 + 985
  unlimited_shuffle: [6, 1, 1], // 421×6 + 179 + 904
  checkmate: [12], // 매 판정 353, 최대 12회 (코덱스 수식 잔재 기준) [미확인]
  celestial_rain: [1, 0], // 두 번째 항은 공중에 떠 있는 적 전용입니다. 보스 대상에서 제외합니다.
};
/** 타격 횟수(게이지·부식 판정용) */
export const HITS: Record<string, number> = { spiral_edge: 1, stream_of_edge: 15, scratch_dealer: 2, quadra_accelerate: 4, celestial_rain: 1, serendipity: 2, dancing_of_spineflower: 7, unlimited_shuffle: 8, dark_resurrection: 3, checkmate: 12, return: 2, mysterious_stampede: 2, call_of_destiny: 2 };

export type CallVariant = keyof typeof callEffects.variants;
/** S318: 기본 두 판정에 표시 증가율의 1배·2배를 적용하는 후보입니다. 타격 시각은 합산 상태를 유지합니다. */
export function resolveStampedeFocusDamage(level: number, increase: number) {
  const effects = emperorBaseEffects.skills.mysterious_stampede.effects;
  if (!Number.isInteger(level) || level < 1 || effects.some(e => level > e.apByLevel.length)) return undefined;
  return {
    directCoef: effects.reduce((sum, e, i) => sum + e.apByLevel[level - 1]! * (1 + (i + 1) * increase), 0),
    directFlat: effects.reduce((sum, e, i) => sum + (e.flatMinByLevel[level - 1]! + e.flatMaxByLevel[level - 1]!) / 2 * (1 + (i + 1) * increase), 0),
  };
}
export function resolveCallOfDestinyDamage(level: number, variant: CallVariant = 'basic'): Pick<SkillDef, 'level' | 'directCoef' | 'directFlat' | 'damageReference' | 'hits'> | undefined {
  if (!Number.isInteger(level) || level < 1 || level > callEffects.effects[0]!.apByLevel.length) return undefined;
  const effects = callEffects.variants[variant].map(id => callEffects.effects.find(e => e.effectId === id)!);
  return { level, directCoef: effects.reduce((sum, e) => sum + e.apByLevel[level - 1]!, 0),
    directFlat: effects.reduce((sum, e) => sum + (e.flatMinByLevel[level - 1]! + e.flatMaxByLevel[level - 1]!) / 2, 0),
    hits: effects.length, damageReference: { source: 'public-coefficient-candidate', level, url: callEffects._meta.url,
      effectIds: [...new Set(effects.map(e => e.effectId))] } };
}

/** 검색한 캐릭터의 기본 운용은 시너지용 첫 입력입니다. 기본 전체 계수 검산과 구분합니다. */
export function resolveReturnFirstDamage(level: number, exposedDarkness: boolean) {
  const effect = emperorBaseEffects.skills.return.effects[0]!;
  if (!Number.isInteger(level) || level < 1 || level > effect.apByLevel.length) return undefined;
  const motion = exposedDarkness ? returnHits.profiles.exposedDarkness : returnHits.profiles.basic;
  const directCoef = effect.apByLevel[level - 1]!;
  const directFlat = (effect.flatMinByLevel[level - 1]! + effect.flatMaxByLevel[level - 1]!) / 2;
  return { level, directCoef, directFlat, hits: 1, castTime: motion.duration,
    hitSequence: { duration: motion.duration, hits: [{ at: motion.at, directCoef, directFlat }] },
    damageReference: { source: 'public-coefficient-candidate' as const, level, url: emperorBaseEffects._meta.url, effectIds: [effect.effectId] } };
}

/** S88/S89: 132 조합만 지원합니다. 전체 피해 후보를 보존하고 설치 적중으로 나눕니다. */
export function resolveStream132Damage(level: number) {
  const damage = resolveSkillDamage(SKILL_BY_ID.get('stream_of_edge')!, level);
  return { ...damage, castTime: streamHits.duration, hits: streamHits.hitCount,
    delayedHits: { duration: streamHits.duration, spawnAt: streamHits.spawnAt,
      hits: Array.from({ length: streamHits.hitCount }, (_, i) => ({
        after: Math.round((streamHits.firstHitAfter + i * streamHits.interval) * 1000) / 1000,
        directCoef: damage.directCoef / streamHits.hitCount, directFlat: damage.directFlat! / streamHits.hitCount,
        stacksGranted: streamHits.stackHitNumbers.includes(i + 1) ? 1 : 0,
      })) } };
}

/** 해당 레벨의 저장된 툴팁 합계입니다. Lv11+ 반복 숫자와 위키 자료는 여기서 사용하지 않습니다. */
export function directCoef(row: SkillRow, level = 10): number | undefined {
  if (!Number.isInteger(level) || level < 1 || level > 10) return undefined;
  const damage = row.baseDamageByLevel?.[level]?.dmg ?? (level === 10 ? row.baseDamageLv10 : undefined);
  if (!damage?.length) return undefined;
  const w = HIT_WEIGHTS[row.id];
  return damage.reduce((sum, d, i) => sum + d * (w?.[i] ?? 1), 0);
}

/** 임시값을 사용하는 경우에도 실제 레벨과 자료의 기준 레벨/출처를 함께 보존합니다. */
export function resolveSkillDamage(row: SkillRow, level: number, continuousDarkness = false, darkStage: 0 | 1 | 2 = 0): Pick<SkillDef, 'level' | 'directCoef' | 'directFlat' | 'damageReference'> & Partial<Pick<SkillDef, 'hitSequence' | 'delayedHits' | 'hits' | 'castTime'>> {
  const call = row.id === 'call_of_destiny' ? resolveCallOfDestinyDamage(level) : undefined;
  if (call) return call;
  const candidate = COEFFICIENTS[row.id];
  const index = level - 1;
  const projectile = row.id === 'the_sun' ? { effects: sunEffects.effects, motion: sunEffects.motion, url: sunEffects._meta.url }
    : row.id === 'dark_resurrection' ? { effects: darkEffects.effects, motion: darkEffects.motions[darkStage], url: darkEffects._meta.url } : undefined;
  if (projectile && Number.isInteger(level) && level >= 1 && projectile.effects.every(e => level <= e.apByLevel.length)) {
    const hits = projectile.motion.hits.map(h => {
      const e = projectile.effects.find(e => e.effectId === h.effectId)!;
      return { after: h.after, directCoef: e.apByLevel[index]!, directFlat: (e.flatMinByLevel[index]! + e.flatMaxByLevel[index]!) / 2 };
    });
    return { level, directCoef: hits.reduce((sum, h) => sum + h.directCoef, 0), directFlat: hits.reduce((sum, h) => sum + h.directFlat, 0),
      castTime: projectile.motion.duration, hits: hits.length, delayedHits: { ...projectile.motion, hits },
      damageReference: { source: 'public-coefficient-candidate', level, url: projectile.url, effectIds: projectile.effects.map(e => e.effectId) } };
  }
  if (candidate && Number.isInteger(level) && level >= 1 && candidate.effects.every(e => level <= e.apByLevel.length)) {
    const motion = row.id === 'serendipity' ? (continuousDarkness ? serendipityHits.continuousDarkness : serendipityHits.basic) : undefined;
    const hits = motion?.hits.map(h => {
      const e = candidate.effects.find(e => e.effectId === h.effectId)!;
      return { at: h.at, directCoef: e.apByLevel[index]!, directFlat: (e.flatMinByLevel[index]! + e.flatMaxByLevel[index]!) / 2 };
    });
    return {
      level, directCoef: hits ? hits.reduce((sum, h) => sum + h.directCoef, 0) : candidate.effects.reduce((sum, e) => sum + e.apByLevel[index]! * (e.hits ?? 1), 0),
      directFlat: hits ? hits.reduce((sum, h) => sum + h.directFlat, 0) : candidate.effects.reduce((sum, e) => sum + (e.flatMinByLevel[index]! + e.flatMaxByLevel[index]!) / 2 * (e.hits ?? 1), 0),
      ...(motion && hits ? { castTime: motion.duration, hits: hits.length, hitSequence: {
        duration: motion.duration, firstHitEnd: serendipityHits.singleHit.nextActionAt ?? serendipityHits.singleHit.fallbackEnd, hits } } : {}),
      damageReference: { source: 'public-coefficient-candidate', level, url: candidate.url, effectIds: candidate.effects.map(e => e.effectId) },
    };
  }
  const exact = directCoef(row, level);
  if (exact !== undefined) return { level, directCoef: exact, directFlat: 0, damageReference: { source: 'codex-tooltip', level } };
  const fallback = directCoef(row, 10);
  if (fallback !== undefined) return { level, directCoef: fallback, directFlat: 0, damageReference: { source: 'codex-tooltip', level: 10 } };
  const u = row.baseDamageLv10Unequipped;
  const wiki = typeof u === 'number' ? u : typeof u === 'string'
    ? u.split('+').reduce((s, part) => { const [a, b] = part.trim().split('x').map(Number); return s + (a ?? 0) * (b ?? 1); }, 0) : undefined;
  if (wiki !== undefined) return { level, directCoef: wiki, directFlat: 0, damageReference: { source: 'wiki-tooltip' } };
  return { level, directCoef: 0, directFlat: 0, damageReference: { source: 'missing' } };
}

function ruinCandidate(build: Build, skill: SkillDef) {
  return build.combatLevel === ruinCoefficientsJson._meta.combatLevel ? RUIN_COEFFICIENTS[skill.id] : undefined;
}

/** 유효 중첩은 심판을 반영한 0~4입니다. 스킬 레벨은 폭발 계수에 사용하지 않습니다. */
export function resolveStackDamage(build: Build, skill: SkillDef, stacks: number): { coef: number; flat: number } {
  const candidate = ruinCandidate(build, skill);
  if (candidate) return { coef: candidate.apByStack[stacks]!, flat: candidate.flatByStack[stacks]! };
  const scale = build.params.stackEffectScale[stacks] ?? stacks;
  return { coef: build.params.stackEffectCoefPerStack * scale * (skill.stackEffectMultiplier ?? 1), flat: 0 };
}

export function damageWarnings(build: Build): string[] {
  const warnings = ['피해 기준 미검증: 공개 계수 후보와 정규화되지 않은 임시값이 함께 사용될 수 있습니다. 현재 DPS와 피해 비중으로 세팅 우열을 판단할 수 없습니다.'];
  const aggregateCrit = build.skills.filter(skill => skill.hits > 1 && (skill.directCoef > 0 || (skill.directFlat ?? 0) > 0) &&
    !skill.hitSequence && !skill.delayedHits && !skill.manualEvoke && !skill.splitEvoke);
  if (aggregateCrit.length) warnings.push(`합산 직접 피해의 치명 판정 (${aggregateCrit.map(skill => skill.name).join(', ')}): 개별 적중 프로필이 없어 직접 피해 합계에 치명 여부를 한 번만 판정합니다. 실제 타격별 치명 판정과 피해 분산은 미검증이며, 평균 피해의 게임 정확성을 보장하지 않습니다.`);
  if (build.skills.some(s => s.manaPoison || s.fearOfDeath)) warnings.push('중독의 카드 버프: 뒤틀린 운명·제후의 스킬 피해 증가는 적용 범위 미확인으로 임시 제외합니다. 도태·재상의 치명타 계열 효과는 틱 시점에 계산하는 기존 가정입니다.');
  if (!build.skills.some(s => s.kind === 'awakening')) warnings.push('일반 각성기와 초각성기의 피해·카드 수급은 자동 입력에서 빠져 있습니다. API 스킬 목록만으로 장착한 각성기를 구분할 수 없으며, 현재 결과는 이 누락을 포함한 부분 모델입니다.');
  if (build.skills.some(s => s.kind === 'hyper_awakening')) warnings.push('T 스킬의 표시 Lv1을 공개 피해 배열의 첫 값에 연결한 것은 후보입니다. 표시 레벨·피해 배열 인덱스·전투 레벨의 관계를 확인하지 못했으며, 별도 Lv70 루인 폭발 후보와 구분합니다.');
  if (build.skills.some(s => s.kind === 'hyper_awakening')) warnings.push('T 스킬 시전시간과 즉각적인 주문·공속·질풍 조합은 실측 미검증입니다. 새 검색 입력과 참고 프리셋은 즉각적인 주문을 시간 / (1 + 증가율) 후보로 반영하며 마나 감소는 미모델입니다.');
  if (build.passiveMods.some(m => m.source.startsWith('금단의 주문'))) warnings.push('금단의 주문: 전체 진화형 피해와 확인된 마나 스킬의 추가 진화형 피해를 합산합니다. 마나 소모 감소는 미모델이며, 마나 전용 추가분의 중독 피해 적용은 미확인·미반영입니다.');
  if (build.passiveMods.some(m => m.source.startsWith('마나 효율 증가('))) warnings.push('마나 효율 증가: 마나 사용이 확인된 스킬의 피해 증가만 반영합니다. 마나 회복 속도와 실제 고갈·유지율은 미모델입니다.');
  if (build.passiveMods.some(m => m.source.startsWith('예리한 둔기('))) warnings.push('예리한 둔기: 피해 감소 발동 확률은 미확인·10% 가정이며, 감소량20%의 평균 피해 −2%를 적용합니다. 타격별 발동·분산은 미모델입니다.');
  if (build.passiveMods.some(m => m.source.startsWith('입식 타격가'))) warnings.push('입식 타격가: 전투 시작 시 최대 중첩을 얻고 유지하는 모델입니다. 피격 이상에 따른 중첩 손실·회복과 낙인력은 미모델이며 실제 레이드 유지율을 검증하지 않았습니다.');
  if (build.passiveMods.some(m => m.source.startsWith('일격 Lv'))) {
    warnings.push('일격: 전체 치적과 공식 툴팁에 백·헤드 어택이 표시된 스킬의 직접 치피를 구분합니다. 루인 폭발·도트 제외는 과거 방향성 자료에 근거한 후보이며 현행 일격 적용·트포 변형은 실측 미검증입니다. 위치에 따른 백·헤드 기본 보너스는 미모델입니다.');
    if (build.passiveMods.some(m => m.source.startsWith('일격 Lv') && m.bucket === 'critDmg' &&
        (m.filter?.component !== 'direct' || !m.filter.ids))) warnings.push('일격: 기존 저장 입력의 전역 치피를 유지하고 있습니다. 캐릭터를 재검색하여 방향성 범위가 붙은 입력으로 갱신해야 합니다.');
  }
  if (build.passiveMods.some(m => m.source.startsWith('타격의 대가('))) {
    warnings.push('타격의 대가: 공식 분류와 비방향성 표기를 확인한 직접 타격·기존 두 피해 카드에 적용하고 각성기는 제외합니다. 루인 폭발 적용은 과거 실험 근거이며 현행 트포·카드 적용은 실측 미검증입니다. 도트 적용은 미확인·임시 제외합니다.');
    if (build.passiveMods.some(m => m.source.startsWith('타격의 대가(') && m.bucket === 'skillDmg' && !m.filter?.component))
      warnings.push('타격의 대가: 기존 저장 입력의 전역 피해 효과를 유지하고 있습니다. 캐릭터를 재검색하여 공격 타입과 각성기 제외 범위를 갱신해야 합니다.');
  }
  if (build.passiveMods.some(m => m.bucket === 'cooldown' && m.cooldownGroup)) warnings.push('진화 쿨감: 끝없는 마나·무한한 마력 및 최적화 훈련·타이밍 지배는 각각 합산하고 두 묶음을 곱하는 후보입니다. 2024년 공개 측정에 근거하며 현행 서버 실측 미검증입니다.');
  if (build.passiveMods.some(m => m.bucket === 'cooldown' && !m.cooldownGroup && /^(끝없는 마나|무한한 마력|최적화 훈련|타이밍 지배)/.test(m.source))) warnings.push('저장된 진화 쿨감 입력에 합산 묶음이 없어 기존 곱연산을 유지합니다. 새 검색·참고 프리셋은 묶음별 합산 후보를 사용합니다.');
  if (build.passiveMods.some(m => /^루인 마이너셋 (14|1[7-9]|20)P$/.test(m.source))) warnings.push('루인 마이너셋은 세렌 자체 시전시간을 단축하며 평시 1타·심판 3타 정책을 유지합니다. 질풍과의 곱연산·실제 취소 시간·직접/폭발 적용 범위·포인트별 피해 곱연산은 실측 미검증 후보입니다.');
  if (build.skills.some(s => s.onHit?.length)) warnings.push('적중 버프는 직접 피해 처리 후 시작·갱신합니다. 운부·리턴·엣지의 치피와 급소 노출은 각각 동일 효과 하나로 갱신하며, 서로 다른 트포 레벨의 우선순위·동일 프레임 선후·개별 타격 없는 스킬의 중간 적중·미스는 미검증입니다.');
  if (build.params.raidCaptainRatio > 0) warnings.push('돌격대장은 피해 발생 시점의 합산 이속 증가분(0~40%)에 적용합니다. 신속·유령·안전 장치·가벼운 발걸음을 반영하며 두 트포의 시작은 최초 시전 기준 가정입니다. 정확한 콤보 입력 시점·서포터와 외부 이속·상한 확장 효과는 미모델입니다.');
  if (build.skills.some(s => s.onCast?.some(e => e.id === 'master_crit'))) warnings.push('달인은 최초 스킬 시전마다 1중첩을 얻고 툴팁의 지속시간·상한을 적용합니다. 시작 전 예열·체인 재입력의 추가 중첩·입력과 적중의 서버 처리 순서는 미검증이며 이동기·기상기는 미모델입니다.');
  const ruins = build.skills.filter(s => s.kind === 'ruin' || s.tags?.includes('ruin'));
  const candidates = ruins.filter(s => ruinCandidate(build, s));
  const placeholders = ruins.filter(s => !ruinCandidate(build, s));
  for (const skill of build.skills) {
    if (skill.maxCharges && skill.maxCharges > 1) warnings.push(`${skill.name}: ${skill.maxCharges}회 저장·순차 충전 후보입니다. 회복 시작 시 쿨감, 진행 중 회복에만 속행, 운수는 해당 사용만 면제하는 가정이며 스트림 직접 실측·동시 이벤트 순서는 미검증입니다. 자동 사용 정책은 최적 사이클을 보장하지 않습니다.`);
    if (skill.id === 'stream_of_edge') warnings.push(skill.delayedHits
      ? '스트림 132: 설치 후 첫 0.3초부터 15타, 5·10·15번째 1스택과 적중 치적 5중첩 후보입니다. 설치 동작만 공속 적용하며 첫 오프셋·현행 서버 프레임·퍼펙트 범위·부분 적중·게이지는 미검증입니다.'
      : '스트림: 이 트포 조합의 개별 타격·스택 시점은 미검증이며 시전 종료 합산 적중으로 임시 처리합니다. 지속 적중과 치적 유지 시간을 재현하지 않습니다.');
    if (skill.id === 'spiral_edge') warnings.push('스파이럴 엣지: 도약 한 번의 피해 후보와 기본 1타·무자비한 사격 2타를 합산합니다. 체인 두 번째 입력은 미반영이며 첫 시전 쿨 시작은 임시 처리입니다. 재입력 허용 시간·운수·개별 타격·스택 시점·후딜은 미검증입니다.');
    if (skill.id === 'scratch_dealer') warnings.push('스크래치 딜러: 기본 이동·내려찍기의 총 피해 후보만 합산합니다. 내부 다단 수를 피해에 다시 곱하지 않습니다. 적중 판정 2회·시전 종료 2스택은 임시 처리이며 콤보 입력·내부 타수·게이지·후딜·트포의 개별 타격 범위는 실측 미검증입니다.');
    if (skill.id === 'call_of_destiny') warnings.push('운명의 부름: 기본 2타·연속 공격 3타·페이크 플립 대체 1타의 직접 피해 후보를 분리합니다. 비행·적중·후딜은 임시 합산이며 치명·어두운 운명 시작·시전 단축과 현재 계수의 실측 검증은 미완료입니다.');
    if (skill.runeCdReduce) warnings.push(`${skill.name} 속행 발동 확률 [미확인] ${skill.runeCdReduce.chance * 100}% 가정. 남은 쿨 ${skill.runeCdReduce.fraction * 100}% 감소율과 다릅니다. 시전 시작 시 1회 판정하며 체인 재입력별 발동·동일 시각 처리 순서는 미검증입니다.`);
    if (skill.hitRune) warnings.push(`${skill.name} 단죄·심판 룬: 직접 적중별 판정, 단죄 갱신·소모, 심판 이후 쿨 시작에 15% 곱연산·공유 내부쿨 30초를 반영합니다. 마나 회복·도트 판정·미스·최적 운용은 미모델이며 현행 서버 실측 미검증입니다.${skill.hitSequence || skill.delayedHits || skill.manualEvoke || skill.splitEvoke ? '' : ' 개별 적중 시간 후보가 없어 임시 타수 전체를 시전 종료에 합산 판정합니다.'}`);
    const ref = skill.damageReference;
    if (ref?.source === 'public-coefficient-candidate') warnings.push(`${skill.name} Lv${ref.level}: 고정 피해·공격력 계수는 공개 자료 후보입니다. 현재 패치·인게임 실측 및 특화·트포 적용 범위는 미검증입니다.`);
    if (ref?.source === 'codex-tooltip' && skill.level !== ref.level) warnings.push(`${skill.name} Lv${skill.level}: 해당 레벨 피해 미확인 — Lv${ref.level} 대체값 사용`);
    if (ref?.source === 'wiki-tooltip') warnings.push(`${skill.name}: 위키 툴팁 임시값 — 기준 스펙·패치 시점 미확인`);
    if (!ref) warnings.push(`${skill.name}: 직접 피해 입력값의 출처 미등록`);
    if (ref?.source === 'missing') warnings.push(`${skill.name}: 직접 피해 자료 없음 — 0 자리값 사용(실제 무피해 아님)`);
    if (skill.delayedHits) warnings.push(`${skill.name}: 발사 동작과 이후 개별 적중을 분리한 공개 모션 후보입니다. 거리별 비행·취소 후딜·현행 서버 프레임은 실측하지 않았습니다.`);
    if (skill.id === 'evoke') warnings.push(skill.splitEvoke
      ? '분할 이보크: 설치 후 2초 폭발, 별도 두 번째 설치를 반영합니다. 동작 1.3초·설치 0.326초는 공개 후보이며 두 번째 설치도 같은 모션을 가정합니다. 재입력 때 현재 쿨감·운수를 적용합니다. 분할 운수 적용·체인 창 시작·만료 쿨·체인별 룬은 현행 실측 미검증입니다.'
      : skill.manualEvoke ? '수동 이보크: 설치 후 1초부터 격발하며 자동 운용은 다음 행동 경계에서 입력합니다. 설치 모션·0.5초 폭발 간격은 공개 후보, 격발 후딜 0초는 미측정 대체값입니다. 작성자 운용 근거로 격발 때 현재 쿨감·운수를 적용합니다. 시전 중 격발·최적 카드 운용·만료 소멸과 운수 미소모는 미검증입니다.'
        : '이보크: 체인 툴팁 해석 누락 — 설치·격발·개별 폭발 미반영');
    if (skill.id === 'dark_resurrection') warnings.push('다크 리저렉션: 공개 전체 모션과 실제 입력 후딜은 다릅니다. 죽공 선입력 취소·거리별 적중은 미모델이며 현재 행동 시간으로 최적 로테이션을 확정할 수 없습니다.');
    if (skill.id === 'unlimited_shuffle') warnings.push('언리미티드 셔플: 기본 6+1+1회 피해 후보만 합산합니다. 연타 시각·행동 시간은 임시값이며 변형 트포의 추가 공격·피해·타수·모션은 미반영입니다. 현행 파멸의 폭풍을 개편 전 14/20타로 처리하지 않습니다.');
    if (skill.id === 'mysterious_stampede' && skill.maxCharges === 2) warnings.push('신비한 쇄도 신비한 전략: 2회 충전과 기존 직렬 회복 후보를 연결합니다. 개별 타격·취소 후딜·현행 충전 시간과 쿨감 처리 순서는 실측 미검증입니다.');
    if (skill.id === 'return') warnings.push(skill.hitSequence
      ? '리턴: 검색 변환은 시너지용 첫 입력만 계산합니다. 적중 0.300/0.301초·첫 모션 0.708초는 공개 후보이며 실제 후딜·콤보 창·쿨 시작은 미검증입니다. 쿨은 기존 첫 시전 시작 기준을 유지하며 추가 입력 운용은 미반영입니다.'
      : '리턴: 기본 두 타격 피해 후보를 합산한 검산용 입력입니다. 실제 첫 입력 운용·타격 시점·추가 콤보는 포함하지 않습니다.');
    if (skill.id === 'mysterious_stampede') warnings.push(`${skill.name}: 기본 두 타격 피해 후보를 합산합니다. 입력·개별 적중·취소 후딜과 연속 공격의 세 번째 타격은 미반영입니다.`);
    if (skill.id === 'dancing_of_spineflower') warnings.push(skill.flowerThornChance !== undefined
      ? '플라워 14P 빠른 복귀: 작성자 설명과 공개 계수에 따라 첫 2타·4중첩 가시 1타·가시 카드 획득을 연결한 후보입니다. 세 타격을 기존 시전 종료에 처리하며 입력 창·비행·쿨 시작·질풍 적용·미스·시전 중 카드 사용은 실측 미검증입니다. 전체 6+1타를 함께 더하지 않습니다.'
      : '플라워: 기본 6+1회 고정 피해·공격력항 후보만 합산합니다. 이 조합의 페이크 플립 가시·가시 집약 변형·중간 복귀·타격별 치명과 실제 행동 시간은 미반영입니다.');
    if (skill.id === 'checkmate') warnings.push('체크메이트: 기본 12회 고정 피해·공격력항 후보만 합산합니다. 홀딩·해제·후딜·개별 적중·스택 부여 시간은 임시 처리이며 누적 트포·추가 타격은 미반영입니다. 공개 계수에 2025-10-22 상향을 임의로 중복 적용하지 않습니다. 현재 계산은 시전 시작에 쿨을 등록하지만 홀딩 종료·해제와 쿨 시작의 실제 관계, 홀딩 중 환희 적용은 미검증입니다.');
    if (skill.manaPoison || skill.fearOfDeath) {
      const name = skill.manaPoison ? '마나 중독' : '죽음의 공포';
      warnings.push(skill.manaPoison
        ? '이보크 마나 중독: 고정 피해·공격력항 및 트포 +72%는 공개 후보(선택 트포 레벨 미확인 가정)입니다. 첫 틱 0.5초·이후 1초·기존 틱 주기 유지, 보석 미적용·마나 사용 분리 및 개별 효과 범위는 현행 실측 미검증입니다. 도트 게이지·부식은 미반영입니다.'
        : '죽음의 공포: 별도 계수·트포 +66%는 공개 후보(선택 레벨 미확인)입니다. 마지막 직접 적중에 최대 1중첩, 재적중 지속 갱신·기존 틱 주기 유지·마나 미사용은 모델 가정입니다. 도트 보석·각인·방어 무시·후딜은 현행 실측 미검증이며 도트 게이지·부식은 미반영입니다.');
      const timed = [...build.skills.flatMap(s => [...(s.onCast ?? []), ...(s.onHit ?? [])]), ...(build.onCardUse ?? []),
        ...(build.onDestiny ?? []).filter(e => typeof e !== 'string')];
      const unknown = [...build.passiveMods, ...(skill.mods ?? []), ...timed.map(e => e.mod)]
        .filter(m => m.bucket === 'skillDmg' && !m.dotScope && m.filter?.component !== 'dot' &&
          filterMatches(m.filter, { skill, stacks: 4, component: 'dot' }));
      if (unknown.length) warnings.push(`${name} 적용 미확인·임시 제외: ${[...new Set(unknown.map(m => m.source))].join(', ')}. 과거 세트 실험만으로 현행 각인·코어의 미적용을 확정할 수 없습니다.`);
    }
    if (skill.id === 'serendipity') warnings.push(skill.hitSequence
      ? `세렌디피티: 평시 1타, 심판 사용 후 시전은 ${skill.hitSequence.hits.length}타. 1타 후 행동 가능 시각·후딜 취소는 미확인으로 첫 모션 종료 1.8초를 임시 대기값으로 사용합니다(공속 적용 전). 심판 콤보 시간도 전체 모션 후보이며 스페이스 자원·시전 중 카드 사용은 미모델입니다.`
      : '세렌디피티: 해당 레벨의 타격별 자료 없음 — 기존 합산 임시값 사용, 콤보·복수 폭발 미반영');
    if (skill.defenseIgnore) warnings.push(`${skill.name} 꿰뚫는 일격: 대상 방어력 ${build.params.targetDefense ?? 6500}${build.params.targetDefense === undefined ? ' 가정' : ' 입력값'}에서 방어 무시 없는 동일 대상 대비 증폭만 적용합니다. 절대 방어 감쇠·별도 보스 뎀감·방깎 시너지는 미모델, 직접 피해·폭발의 독립 추첨은 공개 모델 가정이며 현행 서버 실측 미검증입니다.`);
  }
  if (candidates.length || build.skills.some(s => s.damageReference?.source === 'public-coefficient-candidate')) {
    const basis = build.attackPower
      ? `API 기본 공격력 연결. 검색 당시 상시 공격력 ${build.attackPower.status === 'matched-display' ? '표시 오차 범위 일치' : '재구성 불일치'}. 순수 공격력 분해와 피해 계수의 정규화 기준은 미검증입니다.`
      : '캐릭터의 실제 공격력·정규화 기준과 자동 연결되지 않았습니다.';
    warnings.push(`공격력 입력값 ${build.params.atkBase}: 고정·% 공격력 수정치 적용 전 값입니다. ${basis}`);
  }
  if (candidates.length) warnings.push(`스택트 효과 (${candidates.map(s => s.name).join(', ')}): Lv70 공개 계수 후보 사용. 고정 피해·공격력항을 분리하고 스킬 레벨 배율은 적용하지 않습니다. 현재 패치·인게임 실측 미검증이며 직접 피해와의 비율도 미검증입니다.`);
  if (placeholders.length) warnings.push(`스택트 효과 (${placeholders.map(s => s.name).join(', ')}): 전투 레벨 ${build.combatLevel ?? '미확인'}, Lv70 후보 미적용(지원 전투 레벨 또는 등록 스킬 범위 밖). 기존 임시값 사용: 기본값 ${build.params.stackEffectCoefPerStack} 및 중첩 배율. 직접 피해와의 비율은 미검증입니다.`);
  return warnings;
}
