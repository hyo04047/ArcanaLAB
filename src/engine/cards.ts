// 카드 효과 → 시뮬 상태 변경 (docs/mechanics.md §3.4). 수치는 data/cards.json 과 일치시킨다.
import { randomStream, type Rng } from './rng';
import type { Build, CardDrawSource, TimedEffect } from './types';

export const CARD_DRAW_LABELS: Record<CardDrawSource, string> = {
  gauge: '게이지', quickDraw: '퀵 드로', hiddenHand: '숨겨진 패', flowerThorn: '플라워 가시', destiny: '운명 발동', royal: '로열',
  clown: '광대', empressKnight: '황후의 기사', manual: '통제용 주입',
};

export function emptyCardDraws(): Record<CardDrawSource, number> {
  return { gauge: 0, quickDraw: 0, hiddenHand: 0, flowerThorn: 0, destiny: 0, royal: 0, clown: 0, empressKnight: 0, manual: 0 };
}

export function cardSupplyWarnings(build: Build): string[] {
  const warnings = [
    '각 반복은 빈 손패·게이지 0·대상 스택 0, 모든 스킬 사용 가능·충전 최대 상태에서 시작합니다. 시간제 버프와 이전 전투 상태를 이월하지 않으며, 상시 효과 가정은 Build 입력을 따릅니다. 시작 카드·게이지·사전 버프를 지정하는 입력은 지원하지 않습니다.',
    '기본 드로우 가중치는 균등한 임시 가정이며 실제 확률이 아닙니다. 카드별 관측 빈도와 손패 조건을 검증하기 전 카드 운·세팅 우열을 판정할 수 없습니다.',
    '카드 게이지는 스킬 분류·타수별 임시값입니다. 분당 카드 수가 비슷해도 세팅별 수급이 검증된 것은 아닙니다.',
    '마나 소모·회복·고갈은 미모델이며 마나 부족으로 시전을 멈추지 않습니다. 별의 마나 효과와 삼두사의 평타·스택·게이지 효과도 미반영입니다. 두 카드는 사용 횟수와 카드 사용 연동 효과에는 포함되므로, 현재 DPS로 마나 유지율이나 평타 운용의 이득을 판단할 수 없습니다.',
    '특화·패시브 게이지 증가는 합산하고 풍요는 별도로 곱하는 임시 모델입니다. 조합별 실제 연산은 미검증입니다.',
    '환희는 사용마다 한 번 50%를 판정해 대상의 남은 쿨을 함께 15% 또는 30% 줄입니다. 서버의 공통 판정 단위와 체인 도중 추가 쿨감은 미검증이며, 체인 중 환희의 관측 예외는 아직 반영하지 않습니다.',
  ];
  if (build.infinityDeck) warnings.push('인피니티 덱 17P는 해석한 카드별 조건만 반영합니다. 심판의 지연 쿨감은 남은 시간 기준이며 연속 사용은 독립 예약하는 후보입니다. 실제 감소 기준·중복 예약·동일 프레임 순서는 미검증입니다. 균형의 루인 피해 버프는 사용 시 갱신합니다.');
  if (build.ruinFullset) warnings.push('루인 풀셋 14P는 첫 직접 적중을 사용당 1회 세며 0스택·더 데빌도 포함하는 후보입니다. 세렌 연속타·폭발은 중복 집계하지 않습니다. 현행 판정·누적 유지·손패 포화 시 주기 소모·게이지 다음 운명 처리 순서는 영상 실측 미검증입니다.');
  if (build.chainDraw) warnings.push('체인 드로우는 해석한 포인트의 효과만 적용합니다. 14P는 실제 카드 사용 뒤 독립 확률로 운명을 판정하고 카드 고유 효과를 먼저 처리합니다. 17P 적중 게이지는 특화·탐욕과 합산하는 후보입니다. 실제 확률 독립성·로열/광대와의 순서·게이지 조합 연산은 미검증입니다.');
  if (build.stackHold) warnings.push('스택 홀드 14P는 실제 카드 사용 두 번마다 운명을 발생시킵니다. 획득·광대 복제는 세지 않습니다. 카드 효과 다음 처리·누적 유지 시간은 현행 실측 미검증입니다. 17P는 실제 대상 스택 조건으로 적용하며 스택 자연 만료는 미모델입니다.');
  if (build.emperorHeartChance !== undefined) warnings.push('황제의 심장 14P는 일반·스택트 첫 시전마다 한 번 판정하는 부분 구현입니다. 이보크 재입력·수동 격발·엣지 두 번째 입력·T 스킬은 미확인·미반영입니다. 충전 소비는 각각 새 시전으로 처리하며 확률 독립성·동일 시각 쿨 시작 순서는 실측 미검증입니다.');
  if (build.anotherEmperorChance !== undefined) warnings.push('또 다른 황제는 황제 이외의 실제 카드 사용당 확률을 판정하고 추가 피해를 별도로 집계합니다. 카드 고유 효과·자비 다음, 운명 이전에 즉시 적중하는 순서와 확률 독립성은 미검증입니다. 추가 발동을 카드 사용·획득·스킬 적중으로 다시 세지 않습니다. 검색 변환은 추가 카드 피해를 칙령과 합산해 직접 사용·추가 발동에 적용하는 후보이며 게임 실측 미검증입니다.');
  if (build.normalEnhanceCooldown !== undefined || build.onDestiny?.some(e => typeof e !== 'string' && e.id === 'normal_enhance')) warnings.push('노말 인핸스 14P는 일반·스택트의 남은 쿨을 줄이고 17P는 일반 피해 버프를 갱신하는 후보입니다. 더 썬 포함 범위·감소 기준·연속 입력 중 쿨·동일 시각 순서는 현행 실측 미검증입니다. 미래 쿨에 상시 쿨감을 적용하지 않습니다.');
  if (build.onDestiny?.some(e => typeof e !== 'string' && e.id === 'impact_mate')) warnings.push('임팩트 메이트는 운명 이후 5초 피해 버프이며 17P는 14P 배율을 교체합니다. 재발동은 중첩 없이 지속시간을 갱신하는 후보입니다. 카드·도트 적용 범위와 동일 시각 처리 순서는 현행 피해 실측 미검증입니다.');
  if (build.onDestiny?.some(e => typeof e !== 'string' && e.id === 'high_tempo')) warnings.push('하이 템포는 운명 이후 마나 사용이 확인된 스킬의 새 쿨에 적용합니다. 17P 피해도 같은 버프 시간에만 적용하며 재발동은 지속 갱신 후보입니다. 기존 쿨 즉시 감소와 다르고, 발동 스킬·이보크 재입력·충전 회복 시작 시점 및 도트 범위는 현행 실측 미검증입니다.');
  warnings.push(`뒤틀린 운명의 꽝 확률 ${build.params.twistedFateZeroChance * 100}%와 나머지 10/20/40%의 균등 분포는 임시 가정입니다. 페이탈 핸드의 확률 감소 문구로 정확한 확률을 알 수 없으며 관측 2/100도 확정값이 아닙니다.`);
  if (build.params.fatalHandCull) warnings.push('페이탈 핸드 14P의 도태 치명타 피해는 +20%p를 더한 +70% 후보입니다. 공개 숫자 자료·커뮤니티 계산을 대조했으며 현행 인게임 피해 실측은 미검증입니다.');
  if (build.variant === 'emperor') warnings.push('황제 카드 운용은 더 썬·셔플·다크·이보크에 도태·뒤운·제후를 맞추는 기본 정책입니다. 노말 인핸스의 더 썬·셔플만 쿨 시작 직후, 나머지는 시전 전이며 이보크는 두 번째 입력 전입니다. 직후 입력은 간격 0초 후보로 실제 입력 창·지연을 재현하지 않습니다. 시전 중 새 카드 사용·황제 카드와의 연계·플라워/체크메이트 운용·최적 킵 시간은 미모델이며 숙련자 DPS를 재현하지 않습니다.');
  if (build.variant === 'emperor' && build.rotation.critSetupSkill) warnings.push('황제 기본 운용은 다크니스 엣지가 없고 도태가 비활성일 때 준비된 스트림을 일반기 앞에서 사용합니다. 적 4스택에서도 재사용하지만 실제 타격 시각·버프 가동률·도태 보관·설치 중 미리 준비하는 최적 순서는 미검증입니다.');
  if (build.variant === 'emperor' && build.rotation.setupSkill === 'return' && !build.rotation.fillers?.includes('return')) warnings.push('새 황제 기본 순서의 리턴은 선택된 공통 버프가 없을 때 일반기 앞에서 준비하며, 버프 유지 중에는 쿨마다 다시 쓰지 않습니다. 속행·카드 수급 기회도 줄어드는 후보 운용이며 선제 갱신·설치기 순서와 실제 DPS는 미검증입니다.');
  if (build.variant === 'emperor' || build.deckOverrides?.add?.includes('empress_knight')) {
    warnings.push('황제·황후의 기사 피해는 기준 전투 레벨을 확인하지 못해 자동 입력이 0입니다. 황제 피해 보석·칙령·기사 노드의 피해 증가는 반영하지만 또 다른 황제의 합연산 후보·적중 지연은 실측 미검증이므로 수동 계수로도 세팅 우열을 판정할 수 없습니다.');
    warnings.push('카드 피해는 일반 스킬 전용 효과에서 분리합니다. 황제에 제후 미적용은 공략 근거가 있으나 황후의 기사와 각 효과의 현행 적용 범위는 추가 검증이 필요합니다.');
  }
  if (build.skills.some(s => s.kind === 'ruin' || s.tags?.includes('ruin'))) {
    warnings.push('루인 게이지는 스택 수·폭발·눈속임을 구분하지 않습니다. 평시·심판 및 트라이포드별 카드 수급 비교는 미검증입니다.');
  }
  if (build.skills.some(s => s.tags?.includes('quickdraw') && !s.quickDraw)) warnings.push('퀵 드로 툴팁·판정 해석이 누락된 스킬은 카드 획득을 반영하지 않습니다.');
  if (build.skills.some(s => s.quickDraw && !s.hitSequence && !s.splitEvoke && !s.manualEvoke)) warnings.push('개별 타격 자료가 없는 퀵 드로는 툴팁 확률·판정 횟수를 시전 종료에 합산합니다. 해당 스킬의 개별 적중·지연 폭발은 미모델입니다.');
  if (build.skills.some(s => s.quickDraw)) warnings.push('시전 중 획득한 카드는 다음 행동 시점에 사용합니다. 시전 도중 카드 사용은 미모델입니다.');
  if (build.skills.some(s => s.hiddenHandChance !== undefined)) warnings.push('숨겨진 패는 더 썬 마지막 직접 적중에서만 판정하며 손패가 가득 차면 획득하지 않습니다. 비행 시간·게이지와 동일 시각 처리 순서는 후보 모델이고, 시전 중 카드 사용·최적 운용은 미모델입니다.');
  return warnings;
}

/** 킵하는 카드 (가이드 S6: 심판·도태·운수만 킵, 나머지는 즉시 사용). 뒤틀린 운명·제후는 4초 버프라 루인/주력기 직전까지만 든다. */
export const HELD_CARDS = new Set(['cull', 'judgment', 'twisted_fate', 'sovereign', 'wheel_of_fortune']);

export interface CardHost {
  now: number;
  rng: Rng;
  applyBuff(e: TimedEffect): void;
  removeBuff(id: string): void;
  drawCards(n: number, forcedId?: string, source?: Exclude<CardDrawSource, 'gauge'>): void;
  lastUsedCard(): string | null;
  reduceAllCooldowns(fraction: number): void;
  setNextSkillCooldownReset(): void;
  dealCardDamage(cardId: string, coef: number): void;
  /** 황후의 계략 등 카드 지속 보정 */
  durationBonus(cardId: string): number;
  /** 뒤틀린 운명 0% 확률 (페이탈 핸드 10P 로 감소) */
  twistedFateZeroChance: number;
  /** 페이탈 핸드 14P: 도태 치피 +20%p 후보(S101) */
  fatalHandCull: boolean;
  /** 카드 피해 공격력 계수 (황제·황후의 기사). 기준 전투 레벨 미확인, 자동 입력 0. */
  cardDamageCoef: Record<string, number>;
}

export function useCard(id: string, h: CardHost): void {
  const dur = (base: number) => base + h.durationBonus(id);
  switch (id) {
    case 'cull':
      h.applyBuff({ id: 'cull_rate', duration: dur(4), mod: { bucket: 'critRate', value: 1.0, source: '도태' } });
      h.applyBuff({ id: 'cull_dmg', duration: dur(4), mod: { bucket: 'critDmg', value: h.fatalHandCull ? 0.7 : 0.5, source: '도태' } });
      break;
    case 'judgment':
      h.applyBuff({ id: 'judgment', duration: dur(4), mod: { bucket: 'skillDmg', value: 0, source: '심판' } });
      break;
    case 'twisted_fate': {
      // 0% 또는 10/20/40% 중 하나. 분포 [미확인] — 0% 확률만 파라미터.
      const zero = randomStream(h.rng, 'twistedFateZero').chance(h.twistedFateZeroChance);
      const v = zero ? 0 : randomStream(h.rng, 'twistedFateValue').pick([0.1, 0.2, 0.4]);
      h.applyBuff({ id: 'twisted_fate', duration: dur(4), mod: { bucket: 'skillDmg', value: v, source: '뒤틀린 운명' } });
      break;
    }
    case 'moon':
      h.applyBuff({ id: 'moon', duration: dur(30), mod: { bucket: 'cooldown', value: 0.2, source: '달' } });
      break;
    case 'mayhem':
      // 30초 창. 스킬 사용마다 sim 이 'mayhem_stack' 을 쌓는다.
      h.applyBuff({ id: 'mayhem_window', duration: dur(30), mod: { bucket: 'skillDmg', value: 0, source: '광기' } });
      break;
    case 'corrosion':
      h.applyBuff({ id: 'corrosion_window', duration: dur(30), mod: { bucket: 'skillDmg', value: 0, source: '부식' } });
      break;
    case 'balance':
      h.applyBuff({ id: 'balance', duration: dur(30), mod: { bucket: 'skillDmg', value: 0, source: '균형' } });
      break;
    case 'ghost':
      h.applyBuff({ id: 'ghost', duration: dur(16), mod: { bucket: 'moveSpeed', value: 0.2, source: '유령' } });
      break;
    case 'star':
      break; // 마나 미모델
    case 'three_headed_snake':
      break; // 평타 미모델
    case 'royal':
      h.drawCards(2, undefined, 'royal');
      break;
    case 'wheel_of_fortune':
      h.setNextSkillCooldownReset();
      break;
    case 'clown': {
      const prev = h.lastUsedCard();
      if (prev && prev !== 'clown') h.drawCards(1, prev, 'clown');
      break;
    }
    case 'joy':
      h.reduceAllCooldowns(randomStream(h.rng, 'joy').chance(0.5) ? 0.3 : 0.15);
      break;
    case 'chancellor':
      h.applyBuff({ id: 'chancellor', duration: dur(12), mod: { bucket: 'critRate', value: 0.2, filter: { kinds: ['normal'] }, source: '재상' } });
      break;
    case 'sovereign':
      h.applyBuff({ id: 'sovereign', duration: dur(4), mod: { bucket: 'skillDmg', value: 0.5, filter: { kinds: ['normal'] }, source: '제후' } });
      break;
    case 'emperor':
      h.dealCardDamage('emperor', h.cardDamageCoef['emperor'] ?? 0);
      break;
    case 'empress_knight':
      h.dealCardDamage('empress_knight', h.cardDamageCoef['empress_knight'] ?? 0);
      h.drawCards(1, undefined, 'empressKnight');
      break;
    default:
      break;
  }
}
