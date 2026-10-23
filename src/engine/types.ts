// 엔진 공용 타입. docs/mechanics.md §1·§9 의 버킷 구조와 빌드 스키마를 코드로 옮긴 것.

// hyper_awakening은 초각성 스킬(T: 더 데빌·더 썬)입니다. 초각성기는 미모델입니다.
export type SkillKind = 'normal' | 'stack' | 'ruin' | 'hyper_awakening' | 'awakening' | 'identity_card';

/** 피해 공식 버킷 (docs/mechanics.md §1). atkFlat만 실제 공격력이며 나머지는 소수(0.12 = 12%)입니다. */
export type Bucket =
  | 'atk' // 공격력 % (합연산)
  | 'atkFlat' // 고정 공격력 (공격력 % 적용 전 합산)
  | 'addDmg' // 추가 피해 (합연산)
  | 'dmgToEnemy' // 적에게 주는 피해 (독립 곱연산)
  | 'evoDmg' // 진화형 피해 (합연산)
  | 'critRate' // 치명타 적중률 (합연산)
  | 'critDmg' // 치명타 피해 (합연산, 기본 2.0 에 더함)
  | 'critHitDmg' // 치명타 적중 시 피해 (곱연산, 치명 부분에만)
  | 'skillDmg' // 특정 스킬/분류 피해 증가 (곱연산)
  | 'emperorCardDmg' // 칙령·또 다른 황제 카드 피해 (합연산 후보, S123)
  | 'stackEffectDmg' // 스택트 효과(루인 폭발) 피해 증가 (곱연산)
  | 'atkSpeed' // 일반 공격속도 증가분 (합연산, 최종 +40% 상한)
  | 'moveSpeed' // 이동속도 증가분 (합연산, 돌격대장은 0~40% 사용)
  | 'cooldown'; // 재사용 대기시간 감소 (같은 명시 그룹 합산 후 그룹 간 곱연산)

export interface SkillFilter {
  kinds?: SkillKind[];
  /** 포함 조건과 동시에 적용하며, 제외가 우선합니다(예: 초각성 스킬 제외). */
  excludeKinds?: SkillKind[];
  /** 툴팁에서 마나 사용을 확인한 스킬만 선택합니다. */
  usesMana?: true;
  ids?: string[];
  /** 대상 스택이 이 값 이상일 때만 (예: 황후의 연회 4스택) */
  minStacks?: number;
  /** 직접 피해·스택트 폭발·도트 선택. */
  component?: 'direct' | 'stack' | 'dot';
}

export interface Modifier {
  bucket: Bucket;
  value: number;
  filter?: SkillFilter;
  source: string;
  /** 도트 적용 범위. 미지정 skillDmg는 미확인으로 임시 제외합니다. */
  dotScope?: 'include' | 'exclude';
  /** 진화 쿨감의 합산 묶음. 미지정 입력은 기존 독립 곱연산을 유지합니다. */
  cooldownGroup?: 'manaEvolution' | 'nonAwakeningEvolution';
}

export interface PoisonDamage {
  coef: number; flat: number; duration: number; maxStacks: number; firstTick: number; interval: number;
}

export interface SkillDef {
  id: string;
  name: string;
  kind: SkillKind;
  /** 실제 스킬 레벨. 전투 레벨 및 피해 자료의 기준 레벨과 구분합니다. */
  level?: number;
  /** 피해 자료의 출처. 공개 계수 후보도 인게임 검증 완료를 뜻하지 않습니다. */
  damageReference?: { source: 'codex-tooltip' | 'wiki-tooltip' | 'missing'; level?: number }
    | { source: 'public-coefficient-candidate'; level: number; url: string; effectIds: number[] };
  /** 마나 사용 여부. 생략은 미확인이며 마나 전용 효과를 적용하지 않습니다. */
  usesMana?: boolean;
  cooldown: number; // 초
  /** 저장 횟수. 순차 회복하며 각 회복 시작 시 쿨감을 적용하는 후보입니다. */
  maxCharges?: number;
  /** 시전 시간(초). 미확인 → 프리셋 파라미터 */
  castTime: number;
  /** 직접 피해의 공격력 계수. 툴팁 대체값은 같은 자리에 둔 미정규화 임시값입니다. */
  directCoef: number;
  /** 공격력에 비례하지 않는 직접 피해 합계. 생략은 0이며 기존 임시값 경로와 호환합니다. */
  directFlat?: number;
  /** 개별 타격 후보. at·duration은 공속 적용 전 초, castTime 변경은 전체에 비례 적용합니다. */
  hitSequence?: { duration: number; firstHitEnd?: number; hits: { at: number; directCoef: number; directFlat: number }[] };
  /** 발사 동작만 공속 적용하며, 발사 후 적중 간격은 실제 경과 초입니다. */
  delayedHits?: { duration: number; spawnAt: number; hits: { after: number; directCoef: number; directFlat: number; stacksGranted?: number }[] };
  /** 분할 이보크: 동작 후보는 공속 적용 전, 설치 후 지연·체인 창은 실제 경과 초입니다. */
  splitEvoke?: { duration: number; placementAt: number; delay: number; window: number };
  /** 기본·중첩 이보크 수동 격발. 설치 동작만 공속 적용, 나머지는 경과 초입니다. */
  manualEvoke?: { duration: number; placementAt: number; minRecastDelay: number; lifetime: number;
    recastRecovery: number; hits: { after: number; weight: number }[] };
  /** 마나 중독 1중첩·1틱의 공개 계수 후보. 공격력항과 고정항을 분리합니다. */
  manaPoison?: PoisonDamage;
  /** 죽음의 공포: 마지막 직접 타격에만 부여하며 최대 1중첩인 후보 모델입니다. */
  fearOfDeath?: PoisonDamage;
  /** 세렌디피티 꿰뚫는 일격. 직접 피해·폭발 각각 판정하며 방깎 디버프가 아닙니다. */
  defenseIgnore?: { chance: number; fraction: number };
  /** 스택트 스킬: 적중 시 부여 스택 수 */
  stacksGranted?: number;
  /** 타격 횟수(게이지·부식 판정용). 미확인 → 1 */
  hits: number;
  /** 루인: 4스택일 때 스택을 소모하지 않을 확률 (포 카드 '눈속임') */
  keepStacksChance?: number;
  /** 보존 판정의 실제 스택 하한. 생략은 포 카드 기준 4, 세렌디피티는 1입니다. */
  keepStacksMin?: number;
  /** 세렌디피티 '의도된 우연': 트라이포드 발동 확률 가산(20%p = 0.2). */
  tripodChanceBonus?: number;
  /** 사용 시 쿨타임 FixtureCharacter25화 확률 (포 카드 '신속한 준비') */
  cdResetChance?: number;
  /** 루인: 스택당 확률로 치피 증가 (세렌디피티 '우연한 일격') */
  procCritDmg?: { chancePerStack: number; value: number };
  /** 후보가 없는 스택 임시값 경로의 추정 배율. Lv70 후보에는 적용하지 않습니다. */
  stackEffectMultiplier?: number;
  /** 룬 속행: 사용 시 chance 확률로 각성기 제외 전체 남은 쿨을 fraction만큼 감소 */
  runeCdReduce?: { chance: number; fraction: number };
  /** 단죄·심판 룬: 직접 적중별 확률과 실제 툴팁의 상태 지속시간. 심판 카드와 별개입니다. */
  hitRune?: { kind: 'conviction' | 'judgment'; chance: number; duration: number };
  /** 이 스킬의 덱 게이지 획득 배율 (풍요 룬 1.4) */
  gaugeMultiplier?: number;
  /** 선택한 퀵 드로의 표시 확률과 적중 조건. attempts는 합산 적중 1회에 포함된 판정 수입니다. */
  quickDraw?: { chance: number; trigger: 'each' | 'first' | 'last'; attempts: number };
  /** 숨겨진 패: 더 썬의 마지막 직접 적중에서 1회 카드 획득을 판정합니다. */
  hiddenHandChance?: number;
  /** 페이크 플립 표시값. 가시 참조 계수의 기본 피해 비율과 중첩 증가를 대조합니다. */
  flowerFakeFlip?: { baseFraction: number; damagePerStack: number };
  /** 셔플 댄스 14P 빠른 복귀 후보: 마지막 가시 적중에만 카드 1장 판정. */
  flowerThornChance?: number;
  /** 이 스킬 자체에 붙는 고정 수정치(트라이포드 등) */
  mods?: Modifier[];
  /** 사용 시 거는 버프 */
  onCast?: TimedEffect[];
  /** 직접 적중 처리 후 거는 버프. 동일 프레임의 서버 선후는 미검증입니다. */
  onHit?: TimedEffect[];
  /** 초각성 등 특수 */
  tags?: string[];
}

export interface TimedEffect {
  mod: Modifier;
  duration: number;
  /** 같은 id 는 갱신(중첩 X) */
  id: string;
  maxStacks?: number;
}

export interface Build {
  name: string;
  /** 캐릭터 전투 레벨. 등록된 루인은 Lv70에서 해당 레벨의 폭발 후보를 사용합니다. */
  combatLevel?: number;
  /** 검색 당시 상시 공격력의 검산입니다. 전투 버프와 이후 세팅 변경은 포함하지 않습니다. */
  attackPower?: {
    base: number; displayed: number; increase?: number;
    flat: number; percent: number; reconstructed: number; difference: number;
    status: 'matched-display' | 'mismatch';
  };
  /** 'empress' | 'emperor' */
  variant: 'empress' | 'emperor';
  stats: { crit: number; spec: number; swift: number };
  /** 상시 수정치: 각인·아크패시브·코어 10P/18~20P·젬 합산 등 */
  passiveMods: Modifier[];
  /** 뭉툭한 가시: 치적 캡 80%, 기본 피해 + 초과분 전환의 합에 노드 상한 적용 */
  bluntThorn?: { base: number; ratio: number; cap: number };
  /** 황후의 계략 등: 카드 지속 보정(초) */
  cardDurationBonus?: Partial<Record<string, number>>;
  /** 덱에서 제외/추가할 카드 */
  deckOverrides?: { add?: string[]; remove?: string[] };
  skills: SkillDef[];
  /**
   * 로테이션 정책 (docs/mechanics.md §3.5·§4.4).
   * - ruinPriority: 4스택(또는 심판) 루인 순서. cullRuinPriority: 도태 중 순서.
   * - stackPriority: 스택 스킬 순서. finisher: 4스택 직전에 써서 자버프를 거는 스킬(운명의 부름).
   * - fishing: 0스택에서 필러로 던져도 되는 루인(포 카드 '신속한 준비' 낚시).
   * - wheelTargets: 사용 직전 운명의 수레바퀴를 적용할 대상. 행동 순서는 기존 우선순위를 따릅니다.
   */
  rotation: {
    ruinPriority: string[];
    cullRuinPriority?: string[];
    stackPriority: string[];
    finisher?: string;
    fishing?: string[];
    wheelTargets?: string[];
    /** 황제: 선택된 공통 치피·시너지가 없으면 일반기보다 먼저 쓰는 준비 스킬 */
    setupSkill?: string;
    /** 황제: 다크니스 엣지 치적 버프가 없을 때 준비하는 스트림. 기존 저장 순서에는 소급하지 않습니다. */
    critSetupSkill?: string;
    /** 일반 스킬·더 썬. 황제는 스택/루인 판단 전에, 황후는 뒤에 선택 */
    fillers?: string[];
  };
  /** 카드 사용 시 거는 버프 (황제의 자비) */
  onCardUse?: TimedEffect[];
  /** 또 다른 황제: 황제 이외의 카드 사용당 추가 황제 피해 확률 */
  anotherEmperorChance?: number;
  /** 인피니티 덱 17P: 심판 지연 쿨감과 균형 피해 버프를 독립 적용합니다. */
  infinityDeck?: { judgment?: { delay: number; fraction: number }; balance?: TimedEffect };
  /** 루인 풀셋 14P: 스킬 사용별 첫 직접 적중을 4회 세는 후보입니다. */
  ruinFullset?: boolean;
  /** 체인 드로우 14P 사용 확률, 17P 적중 게이지 가산 후보 */
  chainDraw?: { chance?: number; gaugeBonus?: number };
  /** 스택 홀드 14P: 실제 카드 사용 두 번마다 운명을 발생시킵니다. */
  stackHold?: boolean;
  /** 황제의 심장 14P: 일반·스택트 첫 시전만 연결합니다. 재입력·T 스킬은 미검증입니다. */
  emperorHeartChance?: number;
  /** 노말 인핸스 14P: 운명 시 일반·스택트의 남은 쿨 감소 후보 */
  normalEnhanceCooldown?: number;
  /** 운명 발동 시 효과 (아크 그리드 해 코어 14P) */
  onDestiny?: ('drawCard' | TimedEffect)[];
  /** 4스택 이상 적에게 루인 적중 시 (황후의 속삭임 공속) */
  onRuinAt4?: TimedEffect[];
  /** 플레이스홀더 파라미터 — 미확인 수치 */
  params: SimParams;
}

export interface SimParams {
  /** 방어 무시의 상대 증폭용 대상 방어력. 생략은 6500 가정, 현행 보스 확정값 아님. */
  targetDefense?: number;
  /** Lv70 후보 적용 대상 밖에서만 쓰는 스택 임시 계수: 중첩 1당, 상대값. */
  stackEffectCoefPerStack: number;
  /** 스킬 1타당 덱 게이지 획득량(분류별, 게이지 1.0 = 카드 1장). [미확인 → 보정 파라미터] */
  gaugePerHit: Record<Exclude<SkillKind, 'identity_card'>, number>;
  /** 게이지 획득량 증가 합(특화 + 탐욕 등) */
  gaugeGainBonus: number;
  /** 일반 스킬 게이지 패널티(황후의 탐욕 −0.5) */
  normalGaugePenalty: number;
  /** 검색은 API 기본 공격력, 미확인·수동 프리셋은 자리값 1. 고정·% 공격력 수정치 적용 전입니다. */
  atkBase: number;
  /** 돌격대장: 이속 증가분 × 계수 */
  raidCaptainRatio: number;
  /** 뒤틀린 운명 0% 확률 [미확인] */
  twistedFateZeroChance: number;
  /** 페이탈 핸드 14P: 도태 치피 +50% → +70% 후보 */
  fatalHandCull: boolean;
  /** 부식 디버프 값 (기본 0.10, 페이탈 핸드 17P 0.12/0.13) */
  corrosionValue: number;
  /** 카드 피해 공격력 계수. 기준 전투 레벨 미확인으로 자동 입력하지 않습니다. */
  cardDamageCoef: Record<string, number>;
  /** 카드 고정 피해. 공격력에 곱하지 않으며 통제용 수동 입력만 지원합니다. */
  cardDamageFlat?: Record<string, number>;
  /** 후보 적용 대상 밖에서만 쓰는 중첩별 임시 배율 (index = 중첩 수, 0~4). */
  stackEffectScale: number[];
}

export interface SimConfig {
  durationSec: number;
  iterations: number;
  seed: number;
  /** 생략은 과거 단일 난수열. 비교용 판정별 난수는 버전을 저장합니다. */
  randomMode?: import('./rng').RandomMode;
}

export interface SkillBreakdown {
  id: string;
  name: string;
  casts: number;
  direct: number;
  stackEffect: number;
  /** 마나 중독 피해. 미사용 스킬에는 생략해 기존 결과 형식을 유지합니다. */
  dot?: number;
}

export interface SimRunResult {
  totalDamage: number;
  dps: number;
  cardsDrawn: number;
  /** 손패에서 실제로 소비한 카드 수. 추가 황제 피해 발동은 포함하지 않습니다. */
  cardsUsed: number;
  cardsHeldAtEnd: number;
  /** 손패에 실제 들어온 카드만 집계합니다. manual은 통제 실험의 직접 주입입니다. */
  cardDraws: Record<CardDrawSource, number>;
  ruinCasts: number;
  ruinAt4: number;
  breakdown: SkillBreakdown[];
}

export type CardDrawSource = 'gauge' | 'quickDraw' | 'hiddenHand' | 'flowerThorn' | 'destiny' | 'royal' | 'clown' | 'empressKnight' | 'manual';

export interface SimSummary {
  build: string;
  /** 과거 결과와의 호환을 위해 단일 난수열에서는 생략합니다. */
  randomMode?: import('./rng').RandomMode;
  /** 호출자가 전달한 입력 당시 안내. Worker를 통한 검색 결과에서 보존합니다. */
  inputWarnings?: string[];
  /** 수치만 복사해도 임시 피해 기준의 한계를 잃지 않도록 결과에 포함합니다. */
  damageWarnings: string[];
  cardSupplyWarnings: string[];
  iterations: number;
  durationSec: number;
  dps: { mean: number; median: number; p10: number; p90: number; min: number; max: number; stdev: number };
  cardsPerMin: number;
  cardsUsedPerMin: number;
  /** 실행별 종료 손패 수의 평균이며 분당 수치가 아닙니다. */
  cardsHeldAtEnd: number;
  cardsPerMinBySource: Record<CardDrawSource, number>;
  ruinAt4Rate: number;
  breakdown: SkillBreakdown[]; // 평균
  samples: number[]; // 히스토그램용 DPS 샘플
}
