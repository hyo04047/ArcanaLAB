import type { Build } from './engine/types';

const roots: Record<string, string> = {
  name: '입력 이름', variant: '계열', combatLevel: '전투 레벨', stats: '특성 기록', attackPower: '공격력 산출 기록',
  params: '계산 가정', rotation: '자동 운용', passiveMods: '공통 효과', skills: '스킬 목록',
  deckOverrides: '카드 덱', cardDurationBonus: '카드 지속시간', onCardUse: '카드 사용 시 효과',
  onDestiny: '운명 발동 시 효과', onRuinAt4: '4스택 루인 적중 시 효과',
};
const skillFields: Record<string, string> = {
  id: '스킬 ID', name: '스킬 이름', kind: '스킬 분류', level: '스킬 레벨', cooldown: '재사용 대기시간',
  castTime: '시전 시간', directCoef: '직접 피해 계수', directFlat: '직접 피해 고정항', hits: '판정 횟수',
  maxCharges: '충전 횟수', hitSequence: '적중 순서·시각', delayedHits: '지연 적중', splitEvoke: '분할 이보크',
  manualEvoke: '수동 이보크', manaPoison: '마나 중독', fearOfDeath: '죽음의 공포',
  mods: '스킬 효과 목록', onCast: '시전 시 효과', onHit: '적중 시 효과', quickDraw: '퀵 드로',
  runeCdReduce: '속행', hitRune: '적중 룬', gaugeMultiplier: '게이지 획득 배율', tags: '효과 태그',
};
const label = (labels: Record<string, string>, key: string | undefined, fallback: string) =>
  key !== undefined && Object.hasOwn(labels, key) ? labels[key]! : fallback;
const field = (value: unknown, key: string): string | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const text = (value as Record<string, unknown>)[key];
  return typeof text === 'string' && text.length > 0 ? text : undefined;
};

/** 저장 배열의 위치를 설명합니다. 효과 대응·장착·계산 지원 여부를 추론하지 않습니다. */
export function describeBuildPath(before: Build, after: Build, path: string): string {
  const [root, position, key] = path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const index = position !== undefined && /^(0|[1-9]\d*)$/.test(position) ? Number(position) : null;
  if (root === 'skills' && index !== null) {
    const left = before.skills[index], right = after.skills[index];
    const leftName = field(left, 'name') ?? field(left, 'id') ?? '이름 없음';
    const rightName = field(right, 'name') ?? field(right, 'id') ?? '이름 없음';
    let owner;
    if (left === undefined) owner = `추가 스킬: ${rightName}`;
    else if (right === undefined) owner = `삭제 스킬: ${leftName}`;
    else if (field(left, 'id') !== field(right, 'id'))
      owner = `기준 스킬: ${leftName} (${field(left, 'id') ?? 'ID 없음'}) / 비교 스킬: ${rightName} (${field(right, 'id') ?? 'ID 없음'})`;
    else owner = leftName === rightName ? leftName : `기준 이름: ${leftName} / 비교 이름: ${rightName}`;
    return `${owner} · ${label(skillFields, key, key === undefined ? '전체 스킬 입력' : '스킬 설정')}`;
  }
  if (root === 'passiveMods' && index !== null) {
    const left = field(before.passiveMods[index], 'source') ?? '출처 없음';
    const right = field(after.passiveMods[index], 'source') ?? '출처 없음';
    return `공통 효과 · ${left === right ? left : `기준 출처: ${left} / 비교 출처: ${right}`}`;
  }
  return label(roots, root, '기타 설정');
}
