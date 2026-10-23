// 프리셋 빌드. 수치 출처: data/*.json + tests/fixtures/armory/FixtureCharacter26/parsed.json (Open API, 2026-10-11).
// 미확인 수치는 [PLACEHOLDER] 로 표시. docs/mechanics.md §10 참조.
import cardsJson from '../../data/cards.json';
import statsJson from '../../data/combat_stats.json';
import type { CardDef } from './deck';
import { SKILL_BY_ID, resolveCallOfDestinyDamage, resolveSkillDamage, resolveStream132Damage } from './skilldata';
import type { Build, Modifier, SkillDef, SkillKind, TimedEffect } from './types';

const SK = Object.fromEntries(SKILL_BY_ID);

const CAST = 0.7; // [PLACEHOLDER] 시전 시간 미확인

function skill(id: string, kind: SkillKind, extra: Partial<SkillDef> = {}): SkillDef {
  const s = SK[id]!;
  // 저장된 참고 캐릭터: 루인 4종 Lv14, T Lv1, 나머지 채용 스킬 Lv10.
  const level = extra.level ?? (kind === 'ruin' ? 14 : kind === 'hyper_awakening' ? 1 : 10);
  return { id, name: s.name, kind, usesMana: kind !== 'awakening', cooldown: s.cooldown, castTime: CAST, hits: 1,
    ...resolveSkillDamage(s, level, extra.tags?.includes('continuous_darkness')), ...extra };
}

export function cardsFor(variant: 'empress' | 'emperor', overrides?: Build['deckOverrides']): CardDef[] {
  const base = (cardsJson.cards as { id: string; name: string; duration: number | null; drawWeight: number; availability: string[]; requires?: string }[])
    .filter((c) => c.availability.includes(variant))
    .filter((c) => !c.requires) // 노드 필요 카드는 overrides.add 로
    .map((c) => ({ id: c.id, name: c.name, duration: c.duration, weight: c.drawWeight, availability: c.availability }));
  const out = base.filter((c) => !overrides?.remove?.includes(c.id));
  for (const id of overrides?.add ?? []) {
    const c = (cardsJson.cards as { id: string; name: string; duration: number | null; drawWeight: number; availability: string[] }[]).find((x) => x.id === id);
    if (c && !out.some((x) => x.id === id)) out.push({ id: c.id, name: c.name, duration: c.duration, weight: c.drawWeight, availability: c.availability });
  }
  return out;
}

/** 특성 → 수정치 (data/combat_stats.json 계수) */
export function statMods(stats: { crit: number; spec: number; swift: number }): { mods: Modifier[]; gaugeBonus: number } {
  const c = statsJson;
  const per = (coefPer699: number, v: number) => (coefPer699 / 100) * (v / 699);
  return {
    mods: [
      { bucket: 'critRate', value: per(c.crit.coefPer699, stats.crit), source: '치명' },
      { bucket: 'atkSpeed', value: per(c.swiftness.atkMoveSpeed.coefPer699, stats.swift), source: '신속' },
      { bucket: 'moveSpeed', value: per(c.swiftness.atkMoveSpeed.coefPer699, stats.swift), source: '신속' },
      { bucket: 'cooldown', value: per(c.swiftness.cooldown.coefPer699, stats.swift), source: '신속' },
      { bucket: 'skillDmg', value: per(c.specialization.arcana.ruinDmg.coefPer699, stats.spec), filter: { kinds: ['ruin'] }, source: '특화(루인)' },
      { bucket: 'skillDmg', value: per(c.specialization.arcana.awakeningDmg.coefPer699, stats.spec), filter: { kinds: ['awakening'] }, source: '특화(각성)' },
    ],
    gaugeBonus: per(c.specialization.arcana.cardGaugeGain.coefPer699, stats.spec),
  };
}

/**
 * 황후 인콤스 440 (참고 캐릭터 1750, 2026-10-11 API 기준).
 * 스킬: 운명의 부름(페이크 플립), 스크래치 딜러, 스파이럴 엣지, 스트림 오브 엣지 / 레인, 포 카드, 세렌디피티, 시크릿 가든 + 더 데빌
 */
export function empressInkomsu440(): Build {
  const stats = { crit: 526, spec: 1735, swift: 227 };
  const st = statMods(stats);
  const ruin = { kinds: ['ruin'] as SkillKind[] };
  const hyper = { kinds: ['hyper_awakening'] as SkillKind[] };

  const passiveMods: Modifier[] = [
    ...st.mods,
    // 각인 (유물, API 관찰값)
    { bucket: 'dmgToEnemy', value: 0.2625, source: '원한' },
    { bucket: 'dmgToEnemy', value: 0.17, source: '저주받은 인형' },
    { bucket: 'dmgToEnemy', value: 0.1975, source: '질량 증가' },
    { bucket: 'atkSpeed', value: -0.1, source: '질량 증가' },
    { bucket: 'atk', value: 0.009 * 6, source: '아드레날린(6중첩 상시 가정)' },
    { bucket: 'critRate', value: 0.2, source: '아드레날린' },
    // 진화
    { bucket: 'cooldown', value: 0.14, filter: { usesMana: true }, cooldownGroup: 'manaEvolution', source: '끝없는 마나 2' },
    { bucket: 'cooldown', value: 0.04, filter: { excludeKinds: ['awakening'] }, cooldownGroup: 'nonAwakeningEvolution', source: '최적화 훈련 1' },
    { bucket: 'evoDmg', value: 0.05, source: '최적화 훈련 1' },
    { bucket: 'evoDmg', value: 0.16, source: '무한한 마력 2' },
    { bucket: 'cooldown', value: 0.14, filter: { usesMana: true }, cooldownGroup: 'manaEvolution', source: '무한한 마력 2' },
    { bucket: 'critHitDmg', value: 0.12, source: '회심' },
    { bucket: 'evoDmg', value: 0.2, source: '분쇄' },
    // 깨달음
    { bucket: 'skillDmg', value: 0.009, filter: ruin, source: '황후의 탐욕 1' },
    { bucket: 'skillDmg', value: 0.26, filter: { kinds: ['ruin'], minStacks: 4 }, source: '황후의 연회 3' },
    { bucket: 'skillDmg', value: 0.2, filter: ruin, source: '황후의 속삭임 3' },
    { bucket: 'cooldown', value: 0.06, filter: { kinds: ['normal', 'stack'] }, source: '황후의 속삭임 3' },
    // 도약
    { bucket: 'dmgToEnemy', value: 0.15, filter: hyper, source: '풀려난 힘 5' },
    { bucket: 'cooldown', value: 0.06, filter: hyper, source: '잠재력 해방 3' },
    { bucket: 'skillDmg', value: 0.2, filter: { ids: ['the_devil'] }, source: '쿼즈 3' },
    { bucket: 'stackEffectDmg', value: 0.2, filter: { ids: ['the_devil'], minStacks: 4 }, source: '쿼즈 3 (4중첩)' },
    // 아크 그리드 질서 (인콤스: 인피니티 덱 17 / 엣지 콤보 17 / 스트림 오브 엣지 18)
    { bucket: 'skillDmg', value: 0.016, filter: ruin, source: '인피니티 덱 10P' },
    { bucket: 'critHitDmg', value: 0.02, source: '엣지 콤보 10P' },
    { bucket: 'skillDmg', value: 0.088, filter: { ids: ['celestial_rain'] }, source: '스트림 오브 엣지 코어 14P+18P' },
    // 아크 그리드 혼돈 (현란한 공격 18 / 불타는 일격 17 / 공격 17)
    { bucket: 'critHitDmg', value: 0.011, source: '현란한 공격' },
    { bucket: 'dmgToEnemy', value: 0.005 + 0.01 + 0.0016, source: '현란한 공격' },
    { bucket: 'dmgToEnemy', value: 0.005 + 0.02, source: '불타는 일격(보스)' },
    { bucket: 'atk', value: 0.0055 + 0.0165, source: '공격 코어' },
    // 젬 옵션 합 (API 관찰: 추피 ≈ 2.6%, 공격력 ≈ 1.6%) [근사]
    { bucket: 'addDmg', value: 0.026, source: '젬 추가 피해 합' },
    { bucket: 'atk', value: 0.016, source: '젬 공격력 합' },
  ];

  const whisperAtkSpeed: TimedEffect = { id: 'whisper_as', duration: 6, mod: { bucket: 'atkSpeed', value: 0.08, source: '황후의 속삭임' } };

  const skills: SkillDef[] = [
    // ---- 스택트 ----
    skill('call_of_destiny', 'stack', {
      ...resolveCallOfDestinyDamage(10, 'fake_flip'),
      castTime: CAST / 1.27, // 날렵한 움직임은 운부 자체 속도입니다. 페이크 플립의 실제 시전 단축은 미검증입니다.
      stacksGranted: 2, hits: 1,
      mods: [{ bucket: 'skillDmg', value: 0.45, filter: { ids: ['call_of_destiny'] }, source: '페이크 플립' }, { bucket: 'dmgToEnemy', value: 0.15, filter: { ids: ['call_of_destiny'] }, source: '어두운 운명' }],
      onHit: [{ id: 'arcana_crit_damage', duration: 5, mod: { bucket: 'critDmg', value: 0.775, source: '어두운 운명' } }],
    }),
    skill('scratch_dealer', 'stack', {
      stacksGranted: 2, hits: 2,
      onHit: [{ id: 'arcana_crit_resistance', duration: 10, mod: { bucket: 'critRate', value: 0.1, source: '급소 노출' } }],
      onCast: [{ id: 'safety', duration: 5, mod: { bucket: 'atkSpeed', value: 0.192, source: '안전 장치' } },
        { id: 'safety_move', duration: 5, mod: { bucket: 'moveSpeed', value: 0.3, source: '안전 장치' } }],
    }),
    skill('spiral_edge', 'stack', {
      stacksGranted: 2, hits: 2, cooldown: SK['spiral_edge']!.cooldown - 5, // 빠른 준비만 적용합니다. 루인 마이너셋은 미장착입니다.
      mods: [{ bucket: 'skillDmg', value: 0.46, filter: { ids: ['spiral_edge'], component: 'direct' }, source: '무자비한 사격' }],
      onCast: [{ id: 'light_step', duration: 2, mod: { bucket: 'moveSpeed', value: 0.4, source: '가벼운 발걸음' } }],
    }),
    skill('stream_of_edge', 'stack', {
      maxCharges: 2,
      ...resolveStream132Damage(10), stacksGranted: 3, tags: ['destiny'],
      onHit: [
        { id: 'darkness_edge', duration: 3, maxStacks: 5, mod: { bucket: 'critRate', value: 0.0552, source: '다크니스 엣지' } },
        { id: 'darkness_edge_core', duration: 3, maxStacks: 5, mod: { bucket: 'critDmg', value: 0.016, source: '스트림 오브 엣지 17P' } },
      ],
      onCast: [
        { id: 'soe_as', duration: 8, mod: { bucket: 'atkSpeed', value: 0.08, source: '스트림 코어 10P' } },
        { id: 'edge_combo', duration: 8, mod: { bucket: 'skillDmg', value: 0.06, filter: ruin, source: '엣지 콤보 17P' } },
      ],
    }),
    // ---- 루인 ----
    skill('celestial_rain', 'ruin', {
      hits: 1, cooldown: SK['celestial_rain']!.cooldown + 8, // 약점 포착 +8s, 공중 대상 추가타 제외
      mods: [
        { bucket: 'critRate', value: 0.45, filter: { ids: ['celestial_rain'] }, source: '급소 타격' },
        { bucket: 'skillDmg', value: 0.6, filter: { ids: ['celestial_rain'] }, source: '강화된 일격' },
        { bucket: 'stackEffectDmg', value: 1.76, filter: { ids: ['celestial_rain'], minStacks: 4 }, source: '약점 포착(4중첩, 피면 보스 가정)' },
      ],
    }),
    skill('four_of_a_kind', 'ruin', {
      cdResetChance: 0.55, keepStacksChance: 0, // 눈속임 미채용(스트레이트 대신 카드 강화 2단)
      mods: [
        { bucket: 'skillDmg', value: 0.75, filter: { ids: ['four_of_a_kind'] }, source: '카드 강화' },
        { bucket: 'critRate', value: 0.44, filter: { ids: ['four_of_a_kind'] }, source: '풀 하우스' },
        { bucket: 'skillDmg', value: 0.36, filter: { ids: ['four_of_a_kind'] }, source: '풀 하우스(피면)' },
      ],
    }),
    skill('serendipity', 'ruin', {
      tags: ['continuous_darkness'], procCritDmg: { chancePerStack: 0.2, value: 5.04 },
      defenseIgnore: { chance: 0.5, fraction: 0.8 },
      mods: [{ bucket: 'skillDmg', value: 0.22, filter: { ids: ['serendipity'], component: 'direct' }, source: '연속된 어둠' }],
    }),
    skill('secret_garden', 'ruin', {
      mods: [
        { bucket: 'critRate', value: 0.4, filter: { ids: ['secret_garden'] }, source: '급소 타격' },
        { bucket: 'stackEffectDmg', value: 0.8, filter: { ids: ['secret_garden'], minStacks: 4 }, source: '완전한 비밀' },
        { bucket: 'stackEffectDmg', value: 0.95, filter: { ids: ['secret_garden'] }, source: '시크릿 찬스' },
      ],
    }),
    skill('the_devil', 'hyper_awakening', { tags: ['ruin'], castTime: 1.5 / 1.12 }), // 즉각적인 주문 3: 속도 연산 후보(S138)
  ];

  return {
    name: '황후 인콤스 440 (참고 캐릭터)',
    combatLevel: 70,
    variant: 'empress',
    stats,
    passiveMods,
    bluntThorn: { base: 0.15, ratio: 1.5, cap: 0.75 },
    cardDurationBonus: { cull: 2, judgment: 2 },
    skills,
    rotation: {
      // 나무위키 운용(S2): 평시 데빌 → 레인 → 시가 → 포카 → 세렌 / 도태 중 데빌 → 세렌 → 레인 → 시가 → 포카
      ruinPriority: ['the_devil', 'celestial_rain', 'secret_garden', 'four_of_a_kind', 'serendipity'],
      cullRuinPriority: ['the_devil', 'serendipity', 'celestial_rain', 'secret_garden', 'four_of_a_kind'],
      stackPriority: ['stream_of_edge', 'spiral_edge', 'scratch_dealer'],
      finisher: 'call_of_destiny', // 2스택 → 운부(2스택 + 치피 77.5%) → 루인
      fishing: ['four_of_a_kind'], // 노스택 포카: 신속한 준비 55% FixtureCharacter25화 낚시
      wheelTargets: ['celestial_rain', 'the_devil', 'serendipity'],
      fillers: [],
    },
    onDestiny: ['drawCard'],
    infinityDeck: { judgment: { delay: 6, fraction: 0.15 }, balance: { id: 'infinity_balance', duration: 30,
      mod: { bucket: 'skillDmg', value: 0.02, filter: ruin, source: '인피니티 덱 17P' } } },
    onRuinAt4: [whisperAtkSpeed],
    params: {
      stackEffectCoefPerStack: 600, // [PLACEHOLDER] Lv70 후보 적용 대상 밖에서만 사용합니다.
      gaugePerHit: { normal: 0.04, stack: 0.03, ruin: 0.03, hyper_awakening: 0.05, awakening: 0 }, // [PLACEHOLDER] 분당 ~7장 수준으로 임시 조정. 로그로 보정 대상
      gaugeGainBonus: st.gaugeBonus + 0.04, // 특화 + 탐욕 1
      normalGaugePenalty: -0.5, // 탐욕
      atkBase: 1,
      raidCaptainRatio: 0.4,
      twistedFateZeroChance: 0.25, // [미확인] 페이탈 핸드 없음
      fatalHandCull: false,
      corrosionValue: 0.1,
      cardDamageCoef: {},
      stackEffectScale: [0, 1, 2, 3, 4], // [PLACEHOLDER] Lv70 후보에는 이 선형 배율을 적용하지 않습니다.
    },
  };
}
