// 로스트아크 Open API armory 응답 → 엔진 Build 변환기.
// 입력은 profiles / equipment / combat-skills / arkpassive / arkgrid / engravings / gems / cards 의 원본 JSON.
// 툴팁 문구를 정규식 규칙으로 수정치(Modifier)로 바꾼다. 해석 못 한 문구는 warnings 로 남긴다.
import { statMods } from './presets';
import { cardSupplyWarnings } from './cards';
import { defaultRotation } from './rotation';
import { HITS, SKILL_BY_NAME, damageWarnings, resolveCallOfDestinyDamage, resolveEvokePoison, resolveFearOfDeath, resolveFlowerReturnDamage, resolveReturnFirstDamage, resolveSkillDamage, resolveStampedeFocusDamage, resolveStream132Damage, type CallVariant } from './skilldata';
import evokeEffects from '../../data/evoke_effects.json';
import { parseSeconds, pct, strip, tooltipLines } from './tooltip';
import type { Build, Modifier, SimParams, SkillDef, SkillKind, TimedEffect } from './types';

// ---------- 입력 타입 (필요한 필드만) ----------
export interface RawArmory {
  profiles: { CharacterName: string; CharacterClassName: string; CharacterLevel?: number; ItemAvgLevel: string; Stats: { Type: string; Value: string; Tooltip?: string[] }[] };
  equipment?: { Type: string; Tooltip?: string }[] | null;
  cards?: { Effects: { Items: { Name: string; Description: string }[] }[] } | null;
  combatSkills: { Name: string; Level: number; Type: string; SkillType: number; Tripods?: { Tier: number; Slot: number; Name: string; IsSelected: boolean; Tooltip?: string }[]; Rune?: { Name: string; Grade: string; Tooltip?: string } | null; Tooltip: string }[];
  arkpassive: { Effects: { Name: string; Description: string; ToolTip?: string }[] } | null;
  arkgrid: { Slots: { Index: number; Name: string; Point: number; Tooltip?: string; Gems?: { Index: number; Grade: string; IsActive?: boolean; Tooltip?: string }[] }[]; Effects?: { Name: string; Tooltip?: string }[] } | null;
  engravings: { ArkPassiveEffects?: { Name: string; Grade: string; Level: number; AbilityStoneLevel: number | null; Description: string }[] } | null;
  gems: { Effects?: { Skills?: { Name: string; Description?: string[] }[] } | null } | null;
}

export interface ConvertResult {
  build: Build;
  warnings: string[];
  summary: string[];
}

const BY_NAME = SKILL_BY_NAME;
const CAST_DEFAULT = 0.7; // [PLACEHOLDER]

const num = (s: string, re: RegExp): number | null => { const m = s.match(re); return m ? Number(m[1]) : null; };

// ---------- 트라이포드 / 룬 ----------
interface SkillPatch { mods: Modifier[]; onCast: TimedEffect[]; set: Partial<SkillDef>; castSpeed: number; cdDelta: number;
  callVariant?: CallVariant; stampedeFocus?: number;
  poison?: { duration: number; maxStacks: number }; darkStage?: 0 | 1 | 2; fearDuration?: number; darkFinalMultiplier?: number; serendipityContinuous?: boolean; }

function manualEvoke(hits: { after: number; weight: number }[], overlap: boolean): NonNullable<SkillDef['manualEvoke']> {
  const m = evokeEffects.manual;
  return { duration: m.duration, placementAt: overlap ? m.placementAt : m.basicPlacementAt,
    minRecastDelay: m.minRecastDelay, lifetime: m.lifetime, recastRecovery: m.recastRecoveryFallback, hits };
}

function parseTripod(skillId: string, name: string, desc: string, p: SkillPatch, warn: (m: string) => void): void {
  const self = { ids: [skillId] };
  const src = `${name}`;
  let matched = false;
  const push = (m: Modifier) => { p.mods.push(m); matched = true; };
  let v: number | null;

  if (skillId === 'return' && name === '노출된 표적') {
    warn('리턴 / 노출된 표적: 이후 콤보 공격의 피해 증가입니다. 현재 첫 입력만 계산하므로 보너스 미반영');
    return;
  }
  if (skillId === 'dancing_of_spineflower' && name === '가시 집약') {
    warn('댄싱 오브 스파인플라워 / 가시 집약: 4회 타격·빠른 동작의 변형 프로필 미검증 — 피해 배율만 부분 적용하지 않고 변형 미반영');
    return;
  }
  if (skillId === 'dancing_of_spineflower' && name === '페이크 플립') {
    const flip = desc.match(/^\[일반 스킬\] 형태로 변경되고, 순간이동을 사용한 위치에 기본 피해의 ([\d.]+)% 에 해당하는 치명적 가시 피해를 준다\. 해당 스킬 적중 시 치명적 가시 피해는 ([\d.]+)% 증가되며 최대 4회 중첩된다\.$/);
    if (flip && flip.slice(1).every(v => Number.isFinite(Number(v)))) {
      p.set.kind = 'normal'; p.set.stacksGranted = 0; p.set.tags = ['flower_fake_flip'];
      p.set.flowerFakeFlip = { baseFraction: pct(flip[1]!), damagePerStack: pct(flip[2]!) };
    } else warn(`플라워 페이크 플립 해석 못함 — 변형 미반영: ${desc}`);
    return;
  }
  if (skillId === 'dancing_of_spineflower' && name === '밤에 피는 꽃') {
    const m = desc.match(/^\[암\] 속성으로 변경되고, 치명타 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) push({ bucket: 'critDmg', value: pct(m[1]!), filter: self, source: src });
    else warn(`밤에 피는 꽃 해석 못함 — 치피 미반영: ${desc}`);
    return;
  }
  if (skillId === 'back_flush' && name === '페이크 플립') {
    const m = desc.match(/^\[일반 스킬\] 형태로 변경되고, 적에게 주는 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) {
      p.set.kind = 'normal'; p.set.stacksGranted = 0;
      push({ bucket: 'skillDmg', value: Number(m[1]) / 100, filter: { ...self, component: 'direct' }, source: src });
    } else warn(`백 플러쉬 / ${name} 해석 못함 — 분류·피해 변형 미반영: ${desc}`);
    return;
  }
  if ((skillId === 'mysterious_stampede' && name === '신비한 전략') || (skillId === 'back_flush' && name === '더블 플러쉬')) {
    if (/^스택 가능하게 변경되며, 최대 2회 스택이 가능하다\.$/.test(desc)) {
      p.set.maxCharges = 2;
      if (skillId === 'back_flush') warn('백 플러쉬 더블 플러쉬: 2회 저장과 기존 순차 충전 후보를 연결합니다. 현행 충전 시간·쿨감 처리 순서는 실측 미검증입니다.');
    } else warn(`${name} 해석 못함 — 충전 미반영: ${desc}`);
    return;
  }
  if (skillId === 'mysterious_stampede' && name === '쇄도 집중') {
    const m = desc.match(/^매 판정마다 적에게 주는 피해가 ([\d.]+)% 씩 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) p.stampedeFocus = Number(m[1]) / 100;
    else warn(`신비한 쇄도 / 쇄도 집중 해석 못함 — 피해 증가 미반영: ${desc}`);
    return;
  }
  if (name === '퀵 드로') {
    const m = desc.match(/^(첫 번째 공격 |마지막 공격(?:에)? )?적중 시 ([\d.]+)% 확률로 아이덴티티 카드(?:를)? 1장을? 획득한다\.$/);
    if (m && Number(m[2]) >= 0 && Number(m[2]) <= 100) {
      p.set.quickDraw = { chance: Number(m[2]) / 100,
        trigger: m[1]?.startsWith('첫') ? 'first' : m[1]?.startsWith('마지막') ? 'last' : 'each', attempts: 1 };
    } else warn(`퀵 드로 해석 못함: ${skillId}: ${desc} — 확률을 추정하지 않고 미반영`);
    return;
  }

  if (skillId === 'call_of_destiny' && (name === '연속 공격' || name === '페이크 플립')) {
    const m = desc.match(name === '연속 공격'
      ? /^카드를 빠르게 2회 날려 적중된 적을 공중으로 띄우는 형태로 변경되며, 총 ([\d.]+)%증가된 피해를 준다\.$/
      : /^\[스택트 스킬\] 형태로 변경되어 스택트 중첩이 2회 부여되고 간결한 움직임으로 카드를 날려 시전 시간이 ([\d.]+)초 짧아지며, 공격이 1회로 변경되지만 적중된 적을 바로 공중에 띄워올리며 ([\d.]+)% 증가된 피해를 준다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v)))) {
      p.callVariant = name === '연속 공격' ? 'continuous' : 'fake_flip';
      p.set.hits = name === '연속 공격' ? 3 : 1;
      if (name === '페이크 플립') { p.set.kind = 'stack'; p.set.stacksGranted = 2; }
      // 연속 공격의 첫 타 추가분은 기본 총합의 40%입니다. 총 +70.8%를 다시 곱하지 않습니다.
      push({ bucket: 'skillDmg', value: name === '연속 공격' ? (1 + Number(m[1]) / 100) / 1.4 - 1 : Number(m[2]) / 100,
        filter: { ...self, component: 'direct' }, source: src });
    } else warn(`운명의 부름 / ${name} 해석 못함 — 변형 피해·타수 미반영: ${desc}`);
    return;
  }

  if ((skillId === 'call_of_destiny' && name === '어두운 운명') ||
      (skillId === 'return' && name === '노출된 어둠') || (skillId === 'spiral_edge' && name === '급소 포착')) {
    const pattern = name === '어두운 운명'
      ? /^\[암\] 속성으로 변경되고, 적에게 주는 피해가 ([\d.]+)% 증가한다\. 공격 적중 시 ([\d.]+)초간 적에게 주는 치명타 피해가 ([\d.]+)% 증가한다\.$/
      : name === '노출된 어둠'
        ? /^\[암\] 속성으로 변경되며, 치명타 적중률이 ([\d.]+)% 증가하고, 적중 시 ([\d.]+)초간 적에게 주는 치명타 피해가 ([\d.]+)% 증가한다\.$/
        : /^공격 적중 시 ([\d.]+)초간 자신에게 받는 치명타 피해가 ([\d.]+)% 증가한다\.$/;
    const m = desc.match(pattern);
    const offset = name === '급소 포착' ? 0 : 1;
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[1 + offset]) > 0 &&
        (name !== '노출된 어둠' || Number(m[1]) <= 100)) {
      (p.set.onHit ??= []).push({ id: 'arcana_crit_damage', duration: Number(m[1 + offset]),
        mod: { bucket: 'critDmg', value: Number(m[2 + offset]) / 100, source: src } });
      if (offset) push({ bucket: name === '어두운 운명' ? 'skillDmg' : 'critRate', value: Number(m[1]) / 100,
        filter: { ...self, component: 'direct' }, source: src });
    } else warn(`${name} 해석 못함 — 피해·적중 버프 미반영: ${desc}`);
    return;
  }
  if (name === '급소 노출') {
    const m = desc.match(/^공격 적중 시 대상이 자신 및 파티원에게 받는 피해의 치명타 저항률이 ([\d.]+)초간 ([\d.]+)% 감소한다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[1]) > 0 && Number(m[2]) <= 100)
      (p.set.onHit ??= []).push({ id: 'arcana_crit_resistance', duration: Number(m[1]),
      mod: { bucket: 'critRate', value: Number(m[2]) / 100, source: src } });
    else warn(`급소 노출 해석 못함 — 적중 시너지 미반영: ${desc}`);
    return;
  }

  if ((skillId === 'back_flush' || skillId === 'checkmate') && name === '카드 증가') {
    const valid = skillId === 'back_flush'
      ? /^백 플러쉬로 쌓을 수 있는 최대 스택트 중첩수가 2에서 3로 증가한다\.$/.test(desc)
      : /^체크메이트로 쌓을 수 있는 최대 스택트 중첩수가 3에서 4로 증가한다\.$/.test(desc);
    if (valid) p.set.stacksGranted = skillId === 'back_flush' ? 3 : 4;
    else warn(`트라이포드 해석 못함: ${skillId} / 카드 증가: ${desc}`);
    return;
  }
  if (skillId === 'quadra_accelerate' && name === '카드 증가') {
    const m = desc.match(/^피해가 ([\d.]+)% 증가하고, 적중 시 ([\d.]+)% 확률로 기본 피해량의 ([\d.]+)% 피해를 주며, 스택트가 4중첩이 된다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[2]) <= 100) {
      push({ bucket: 'skillDmg', value: Number(m[1]) / 100, filter: { ...self, component: 'direct' }, source: src });
      warn('쿼드라 엑셀레이트 / 카드 증가: 상시 직접 피해 증가만 반영합니다. 확률 추가타·4중첩 부여의 판정·적중 순서는 미검증으로 미반영');
    } else warn(`쿼드라 엑셀레이트 / 카드 증가 해석 못함 — 피해 증가 미반영: ${desc}`);
    return;
  }
  if (skillId === 'spiral_edge' && name === '무자비한 사격') {
    const m = desc.match(/^카드를 연속으로 뿌려 적에게 주는 피해가 총 ([\d.]+)% 증가하고, 최대 스택트 중첩수가 1회 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) {
      p.set.hits = 2; p.set.stacksGranted = 2;
      push({ bucket: 'skillDmg', value: Number(m[1]) / 100, filter: { ...self, component: 'direct' }, source: src });
    } else warn(`스파이럴 엣지 / 무자비한 사격 해석 못함 — 배율·타수·스택 증가 미반영: ${desc}`);
    return;
  }
  if (skillId === 'spiral_edge' && name === '카드 폭풍') {
    warn('스파이럴 엣지 / 카드 폭풍: 추가 착지·다른 트포 조합·타수·스택 부여 미검증 — 변형 효과 미반영');
    return;
  }

  if (skillId === 'scratch_dealer' && ['퍼스트 스크래치', '연속 공격'].includes(name)) {
    warn(`스크래치 딜러 / ${name}: 타격별 스택 조건·추가 콤보·공중 조건 미검증 — 변형 효과 미반영, 기본 두 입력 피해 후보만 사용`);
    return;
  }
  if (skillId === 'scratch_dealer' && name === '예리한 일격') {
    const m = desc.match(/^치명타 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) push({ bucket: 'critDmg', value: Number(m[1]) / 100, filter: { ...self, component: 'direct' }, source: src });
    else warn(`스크래치 딜러 / 예리한 일격 해석 못함 — 미반영: ${desc}`);
    return;
  }

  if (skillId === 'unlimited_shuffle' && name === '어둠의 핵') {
    const m = desc.match(/^\[암\] 속성으로 변경된다\. 적에게 주는 피해가 ([\d.]+)% 증가하고, 치명타 피해량이 ([\d.]+)% 증가한다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v)))) {
      push({ bucket: 'skillDmg', value: Number(m[1]) / 100, filter: { ...self, component: 'direct' }, source: src });
      push({ bucket: 'critDmg', value: Number(m[2]) / 100, filter: { ...self, component: 'direct' }, source: src });
    } else warn(`어둠의 핵 해석 못함 — 피해·치명타 피해 미반영: ${desc}`);
    return;
  }
  if (skillId === 'unlimited_shuffle' && ['파멸의 셔플', '얼티밋 셔플', '예견된 죽음', '파멸의 폭풍'].includes(name)) {
    warn(`언리미티드 셔플 / ${name}: 추가 공격·위치 조건·타수 변경 미검증 — 변형 피해·타수·모션 미반영, 기본 피해 후보만 사용`);
    return;
  }
  if (skillId === 'checkmate' && ['꿰뚫는 일격', '집중된 어둠', '썬더 메이트', '데드라인', '카드의 파도'].includes(name)) {
    warn(`체크메이트 / ${name}: 홀딩 중 누적·변형·추가 타격 미검증 — 단일 배율로 적용하지 않고 미반영`);
    return;
  }

  if ((skillId === 'dark_resurrection' || skillId === 'call_of_destiny') && name === '꿰뚫는 일격') {
    const m = desc.match(/^적중된 적의 모든 방어력을 ([\d.]+)% 무시한다\.$/);
    if (m && Number.isFinite(Number(m[1])) && Number(m[1]) <= 100) p.set.defenseIgnore = { chance: 1, fraction: Number(m[1]) / 100 };
    else warn(`${skillId === 'call_of_destiny' ? '운명의 부름' : '다크 리저렉션'} 꿰뚫는 일격 해석 못함 — 방어 무시 미반영: ${desc}`);
    return;
  }
  if (skillId === 'dark_resurrection' && name === '죽음의 공포') {
    const m = desc.match(/^더 이상 점프하지 않고 빠른 속도로 공격해, 마지막 공격에 적중 시 ([\d.]+)초 동안 매 초마다 [\d,]+의 중독 피해를 준다\.$/);
    if (m && Number.isFinite(Number(m[1])) && Number(m[1]) > 0) { p.darkStage = 1; p.fearDuration = Number(m[1]); }
    else warn(`죽음의 공포 해석 못함 — 모션 변경·중독 미반영: ${desc}`);
    return;
  }
  if (skillId === 'dark_resurrection' && name === '분노의 일격') {
    const m = desc.match(/^더 이상 공포를 걸지 않지만, 치명타 피해가 ([\d.]+)% 증가하고, 마지막 공격이 지면을 강타해 적중된 적을 가운데로 모아 넘어뜨리며, ([\d.]+)% 증가된 피해를 준다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v)))) {
      p.darkStage = 2; p.darkFinalMultiplier = 1 + Number(m[2]) / 100;
      push({ bucket: 'critDmg', value: Number(m[1]) / 100, filter: { ...self, component: 'direct' }, source: src });
    } else warn(`분노의 일격 해석 못함 — 모션·피해 변경 미반영: ${desc}`);
    return;
  }

  if (skillId === 'evoke' && name === '분할 마법진') {
    const m = desc.match(/^더 이상 원하는 타이밍에 터트리지 못하지만, ([\d.]+)초 동안 이보크를 2회 사용할 수 있다\.$/);
    // S51 공식 지연 2초, S53 공개 설치 모션 후보. 두 번째 설치도 같은 모션을 가정합니다.
    if (m && Number.isFinite(Number(m[1])) && Number(m[1]) > 0) p.set.splitEvoke = { duration: 1.3, placementAt: 0.326, delay: 2, window: Number(m[1]) };
    else warn(`분할 마법진 해석 못함: ${desc} — 두 번째 설치·지연 폭발 미반영`);
    return;
  }
  if (skillId === 'evoke' && name === '마나 중독') {
    const m = desc.match(/^적에게 주는 피해가 ([\d.]+)% 감소하고, 더 이상 공중으로 띄우지 않지만 ([\d.]+)초간 이동속도를 ([\d.]+)% 감소시키고 매 초마다 (\d+|\d{1,3}(?:,\d{3})+)의 중독 피해를 주며 최대 (\d+)회 중첩이 가능하다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v.replaceAll(',', '')))) &&
        Number(m[1]) <= 100 && Number(m[3]) <= 100 && Number(m[2]) > 0 && Number(m[5]) > 0 && Number.isSafeInteger(Number(m[5]))) {
      push({ bucket: 'skillDmg', value: -Number(m[1]) / 100, filter: { ...self, component: 'direct' }, source: src });
      p.poison = { duration: Number(m[2]), maxStacks: Number(m[5]) };
    } else warn(`이보크 마나 중독 해석 못함 — 직접 피해 감소·도트 미반영: ${desc}`);
    return;
  }
  if (skillId === 'evoke' && name === '중첩 마법진') {
    const m = desc.match(/^공격 횟수가 3회로 증가하지만, 2번째 공격의 피해 및 공격 범위가 ([\d.]+)%, 3번째 공격의 피해 및 공격 범위가 ([\d.]+)% 감소한다\.$/);
    if (m && [m[1], m[2]].every(x => Number(x) >= 0 && Number(x) <= 100)) {
      const weights = [1, 1 - Number(m[1]) / 100, 1 - Number(m[2]) / 100];
      p.set.manualEvoke = manualEvoke(evokeEffects.manual.explosionOffsets.map((after, i) => ({ after, weight: weights[i]! })), true);
    } else warn('중첩 마법진 해석 못함 — 수동 격발·3회 폭발 미반영');
    return;
  }

  if (skillId === 'serendipity' && name === '꿰뚫는 일격') {
    const m = desc.match(/^스킬 및 스택트 효과 적중 시 ([\d.]+)% 확률로 적의 모든 방어력을 ([\d.]+)% 무시한다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100))
      p.set.defenseIgnore = { chance: pct(m[1]!), fraction: pct(m[2]!) };
    else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }

  if (skillId === 'serendipity' && name === '연속된 어둠') {
    const m = desc.match(/^\[암\] 속성으로 변경되고, 스킬이 콤보 조작으로 변경되며 적에게 주는 총 스킬 피해량이 ([\d.]+)% 증가한다\.$/);
    // 추가 펼치기가 기본 직접 피해의 40%입니다. 총 증가율을 타격당 배율로 환산합니다(S39).
    if (m && Number.isFinite(Number(m[1]))) {
      p.serendipityContinuous = true;
      push({ bucket: 'skillDmg', value: (1 + Number(m[1]) / 100) / 1.4 - 1, filter: { ...self, component: 'direct' }, source: src });
    } else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }
  if (skillId === 'serendipity' && name === '강화된 일격') {
    const m = desc.match(/^적에게 주는 스킬 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1])))
      push({ bucket: 'skillDmg', value: Number(m[1]) / 100, filter: { ...self, component: 'direct' }, source: src });
    else warn(`세렌디피티 / ${name} 해석 못함 — 직접 피해 증가 미반영: ${desc}`);
    return;
  }
  if (skillId === 'serendipity' && name === '의도된 우연') {
    const m = desc.match(/^세렌디피티 트라이포드로 증가되는 발동 확률이 스택트의 중첩과 상관없이 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1])) && Number(m[1]) <= 100) p.set.tripodChanceBonus = Number(m[1]) / 100;
    else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }
  if (skillId === 'serendipity' && name === '눈속임') {
    const m = desc.match(/^스킬 적중 시 ([\d.]+)% 확률로 스택트를 소모하지 않는다\.$/);
    if (m && Number.isFinite(Number(m[1])) && Number(m[1]) <= 100) {
      p.set.keepStacksChance = Number(m[1]) / 100; p.set.keepStacksMin = 1;
    } else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }
  if (skillId === 'serendipity' && name === '우연한 일격') {
    const m = desc.match(/^스택트 중첩당 ([\d.]+)% 확률로 루인으로 주는 치명타 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[1]) <= 100)
      p.set.procCritDmg = { chancePerStack: pct(m[1]!), value: pct(m[2]!) };
    else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }

  if ((skillId === 'celestial_rain' && name === '강화된 일격') || (skillId === 'four_of_a_kind' && name === '카드 강화')) {
    const m = desc.match(skillId === 'celestial_rain'
      ? /^적에게 주는 스킬 및 스택트 피해가 ([\d.]+)% 증가한다\.$/
      : /^적에게 주는 스킬 및 스택트 효과의 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) push({ bucket: 'skillDmg', value: Number(m[1]) / 100, filter: self, source: src });
    else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }
  if (skillId === 'four_of_a_kind' && name === '풀 하우스') {
    const m = desc.match(/^스킬 및 스택트 효과의 치명타 적중률이 ([\d.]+)% 증가하고, 피격이상 면역인 적에게 주는 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[1]) <= 100) {
      push({ bucket: 'critRate', value: Number(m[1]) / 100, filter: self, source: src });
      push({ bucket: 'skillDmg', value: Number(m[2]) / 100, filter: self, source: `${src}(피면)` });
    } else warn(`포 카드 / 풀 하우스 해석 못함 — 치명타·피해 증가 미반영: ${desc}`);
    return;
  }
  if ((skillId === 'secret_garden' && ['급소 타격', '완전한 비밀', '시크릿 찬스'].includes(name)) ||
      (skillId === 'celestial_rain' && name === '급소 타격')) {
    const m = desc.match(name === '급소 타격'
      ? /^스킬 및 스택트 효과의 치명타 적중률이 ([\d.]+)% 증가한다\.$/
      : name === '완전한 비밀'
        ? /^기존 스택트 효과에 추가로 4중첩인 적에게 ([\d.]+)% 증가된 피해를 준다\.$/
        : /^적에게 주는 스택트 피해 효과가 ([\d.]+)% 증가한다\. 대상이 모험가일 경우 ([\d.]+)% 증가한다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && (name !== '급소 타격' || Number(m[1]) <= 100))
      push({ bucket: name === '급소 타격' ? 'critRate' : 'stackEffectDmg', value: Number(m[1]) / 100,
        filter: name === '완전한 비밀' ? { ...self, minStacks: 4 } : self, source: src });
    else warn(`${skillId === 'secret_garden' ? '시크릿 가든' : '셀레스티얼 레인'} / ${name} 해석 못함 — 미반영: ${desc}`);
    return;
  }
  if (skillId === 'secret_garden' && name === '다크니스 가든') {
    const m = desc.match(/^\[암\] 속성으로 변경되고, 적에게 주는 스킬 및 스택트 효과의 치명타 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) {
      for (const component of ['direct', 'stack'] as const)
        push({ bucket: 'critDmg', value: Number(m[1]) / 100, filter: { ...self, component }, source: src });
      warn('다크니스 가든: 암속성 변환·속성 상성은 미모델이며 직접 피해·스택트 효과의 치명타 피해만 반영합니다.');
    } else warn(`시크릿 가든 / ${name} 해석 못함 — 치명타 피해 미반영: ${desc}`);
    return;
  }
  if (skillId === 'secret_garden' && name === '스톰 가든') {
    const m = desc.match(/^\[뇌\] 속성으로 변경되고, 스택트 효과로 주는 피해가 ([\d.]+)% 감소하지만, 중첩에 상관없이 스택트가 걸린 적을 모두 넘어뜨린다\.$/);
    if (m && Number.isFinite(Number(m[1])) && Number(m[1]) <= 100) {
      push({ bucket: 'stackEffectDmg', value: -Number(m[1]) / 100, filter: { ...self, component: 'stack' }, source: src });
      warn('스톰 가든: 뇌속성 변환·속성 상성·넘어뜨리기는 미모델이며 스택트 효과의 피해 감소만 반영합니다.');
    } else warn(`시크릿 가든 / ${name} 해석 못함 — 스택트 피해 감소 미반영: ${desc}`);
    return;
  }
  if (skillId === 'celestial_rain' && name === '약점 포착') {
    const m = desc.match(/^기존 스택트 효과 대신 피격이상 면역인 적에게 스택트 효과 중첩에 따라 적에게 주는 스택트 효과 피해가 ([\d.]+)% ~ ([\d.]+)% 증가하지만 재사용 대기 시간이 ([\d.]+)초 증가한다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[1]) <= Number(m[2])) {
      p.cdDelta += Number(m[3]);
      push({ bucket: 'stackEffectDmg', value: Number(m[2]) / 100, filter: { ...self, minStacks: 4 }, source: `${src}(4중첩)` });
    } else warn(`셀레스티얼 레인 / ${name} 해석 못함 — 스택트 피해·쿨타임 증가 미반영: ${desc}`);
    return;
  }
  if (['약점 포착', '약점 공격'].includes(name)) {
    const m = desc.match(skillId === 'checkmate'
      ? /^무력화 단계가 \[중\]으로 상승하고, 피격이상 면역인 적에게 주는 피해가 ([\d.]+)% 증가한다\.$/
      : /^피격이상 면역인 적에게 주는 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) {
      push({ bucket: 'skillDmg', value: Number(m[1]) / 100, filter: self, source: `${src}(피면)` });
      if (skillId === 'checkmate') warn('체크메이트 / 약점 포착: 보스 대상 피해 증가만 반영하며 무력화 단계 변경은 미모델');
    } else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }
  if (skillId === 'return' && name === '집중된 카드') {
    const m = desc.match(/^공격 각도가 줄어들지만 공격 거리가 ([\d.]+)% 증가하고 주는 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v)))) {
      push({ bucket: 'skillDmg', value: Number(m[2]) / 100, filter: self, source: src });
      warn('리턴 / 집중된 카드: 피해 증가만 반영하며 공격 각도·거리 변경은 미모델');
    } else warn(`리턴 / 집중된 카드 해석 못함 — 피해 증가 미반영: ${desc}`);
    return;
  }
  if (skillId === 'serendipity' && name === '우연한 강타') {
    const m = desc.match(/^더 이상 날려버리지 않지만 공격 속도가 ([\d.]+)% 증가하고, 스택트 효과 적중 시 추가로 ([\d.]+)초간 기절시킨다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[2]) > 0) {
      p.castSpeed += Number(m[1]) / 100;
      warn('세렌디피티 / 우연한 강타: 스킬 공격 속도만 반영하며 날려버리기 제거·기절은 미모델');
    } else warn(`세렌디피티 / 우연한 강타 해석 못함 — 공격 속도 미반영: ${desc}`);
    return;
  }
  if (skillId === 'four_of_a_kind' && name === '스트레이트') {
    const m = desc.match(/^포 카드 사용 중 피격 이상에 면역이 되고, 적에게 주는 스택트 효과 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) {
      push({ bucket: 'stackEffectDmg', value: Number(m[1]) / 100, filter: self, source: src });
      warn('포 카드 / 스트레이트: 스택트 피해 증가만 반영하며 피격 이상 면역은 미모델');
    } else warn(`포 카드 / 스트레이트 해석 못함 — 스택트 피해 증가 미반영: ${desc}`);
    return;
  }
  if (name === '빠른 준비') {
    const m = desc.match(/^재사용 대기시간이 ([\d.]+)초 감소한다\.$/);
    if (m && Number.isFinite(Number(m[1]))) p.cdDelta -= Number(m[1]);
    else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }
  if (skillId === 'four_of_a_kind' && (name === '신속한 준비' || name === '눈속임')) {
    const m = desc.match(name === '신속한 준비'
      ? /^([\d.]+)% 확률로 재사용 대기시간이 FixtureCharacter25화 된다\.$/
      : /^스택트 4 중첩 일 경우 ([\d.]+)% 확률로 스택트가 소모되지 않는다\.$/);
    if (m && Number.isFinite(Number(m[1])) && Number(m[1]) <= 100) {
      if (name === '신속한 준비') p.set.cdResetChance = Number(m[1]) / 100;
      else p.set.keepStacksChance = Number(m[1]) / 100;
    } else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }

  // 보류 중인 스트림은 기존 공통 해석 경로를 유지합니다.
  if (skillId === 'stream_of_edge') {
    if (/\[스택트 스킬\] 형태로 변경/.test(desc)) {
      v = num(desc, /스택트 중첩이 (\d+)회 부여/);
      p.set.kind = 'stack';
      p.set.stacksGranted = v ?? 1;
      const d = num(desc, /([\d.]+)% 증가된 피해/);
      if (d !== null) push({ bucket: 'skillDmg', value: pct(String(d)), filter: self, source: src });
      matched = true;
    }
    if ((v = num(desc, /최대 스택트 중첩수가 (\d+)회 증가/)) !== null) { p.set.stacksGranted = (p.set.stacksGranted ?? 0) + v; matched = true; }
    if (/최대 스택트 중첩수가 \d+에서 (\d+)(?:으)?로 증가/.test(desc)) { p.set.stacksGranted = num(desc, /에서 (\d+)(?:으)?로/) ?? p.set.stacksGranted; matched = true; }
    if ((v = num(desc, /재사용 대기 ?시간이 ([\d.]+)초 증가/)) !== null) { p.cdDelta += v; matched = true; }
  }
  if (skillId === 'stream_of_edge' && name === '다크니스 엣지') {
    const m = desc.match(/^\[암\] 속성으로 변경되고, 적중 시 마다 아르카나의 치명타 적중률이 ([\d.]+)초간 ([\d.]+)% 씩 최대 ([\d.]+)% 까지 증가한다\.$/);
    // API 5.5%는 표시 반올림입니다. S88의 5중첩 및 총량으로 5.52%를 복원합니다.
    if (m && Math.abs(Number(m[2]) * 5 - Number(m[3])) < 0.3) (p.set.onHit ??= []).push({
      id: 'darkness_edge', duration: Number(m[1]), maxStacks: 5,
      mod: { bucket: 'critRate', value: Number(m[3]) / 500, source: src } });
    else warn('다크니스 엣지 해석 못함 — 적중 치적 미반영');
    return;
  }
  if (skillId === 'stream_of_edge' && name === '가속 스트림') {
    const m = desc.match(/^스트림 오브 엣지 사용 시 자신의 이동속도가 ([\d.]+)초간 ([\d.]+)% 증가한다\.$/);
    if (m) p.onCast.push({ id: 'stream_acceleration', duration: Number(m[1]), mod: { bucket: 'moveSpeed', value: pct(m[2]!), source: src } });
    else warn('가속 스트림 해석 못함 — 이동속도 미반영');
    return;
  }
  // S83의 전체 자기 속도 문구가 유효할 때만 시전 버프를 함께 적용합니다.
  if (name === '안전 장치') {
    const m = desc.match(/^콤보 조작이 (\d+)회로 증가한다\. 마지막 콤보를 사용 시 후방으로 ([\d.]+)m 순간이동을 하며 스킬 사용 시 ([\d.]+)초간 공격속도가 ([\d.]+)% 증가하고, 이동속도가 ([\d.]+)% 증가한다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[1]) > 0 && Number.isSafeInteger(Number(m[1])) && Number(m[3]) > 0) {
      p.onCast.push({ id: `${skillId}_${name}_as`, duration: Number(m[3]), mod: { bucket: 'atkSpeed', value: pct(m[4]!), source: src } });
      p.onCast.push({ id: `${skillId}_${name}_ms`, duration: Number(m[3]), mod: { bucket: 'moveSpeed', value: pct(m[5]!), source: src } });
    } else warn(`${src}: 속도 버프 툴팁 해석 못함 — 공격속도·이동속도 미반영`);
    return;
  }
  if (name === '가벼운 발걸음') {
    const m = desc.match(/^스킬 사용 후 이동속도가 ([\d.]+)초간 ([\d.]+)% 증가하고 이동 중 모험가 및 일반 몬스터와 충돌이 무시된다\.$/);
    if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[1]) > 0)
      p.onCast.push({ id: `${skillId}_${name}_ms`, duration: Number(m[1]), mod: { bucket: 'moveSpeed', value: pct(m[2]!), source: src } });
    else warn(`${src}: 이동속도 툴팁 해석 못함 — 미반영`);
    return;
  }
  if (['날렵한 움직임', '치명적 카드', '치명적 공격', '급소 타격', '강렬한 카드', '집속 마법진', '격렬한 춤'].includes(name)) {
    const speed = name === '날렵한 움직임';
    const crit = ['치명적 카드', '치명적 공격', '급소 타격'].includes(name);
    const m = desc.match(speed ? /^공격속도가 ([\d.]+)% 증가한다\.$/
      : crit ? /^치명타 적중률이 ([\d.]+)% 증가한다\.$/ : /^적에게 주는 피해가 ([\d.]+)% 증가한다\.$/);
    if (m && Number.isFinite(Number(m[1])) && (!crit || Number(m[1]) <= 100)) {
      if (speed) p.castSpeed += Number(m[1]) / 100;
      else push({ bucket: crit ? 'critRate' : 'skillDmg', value: Number(m[1]) / 100, filter: self, source: src });
    } else warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
    return;
  }
  if (skillId === 'stream_of_edge') {
    if (!/초간 공격 ?속도/.test(desc) && (v = num(desc, /공격 ?속도가 ([\d.]+)% 증가/)) !== null) { p.castSpeed += pct(String(v)); matched = true; }
    if ((v = num(desc, /시전 속도가 ([\d.]+)% 증가/)) !== null) { p.castSpeed += pct(String(v)); matched = true; }
    if (!/초간/.test(desc) && (v = num(desc, /치명타 적중률이 ([\d.]+)% 증가/)) !== null) push({ bucket: 'critRate', value: pct(String(v)), filter: self, source: src });
    { const m = desc.match(/4 ?중첩인 적에게 .*?([\d.]+)% 증가된 피해/); if (m) push({ bucket: 'stackEffectDmg', value: pct(m[1]!), filter: { ...self, minStacks: 4 }, source: src }); }
    { const m = desc.match(/스택트 효과 중첩에 따라 .*?([\d.]+)% ~ ([\d.]+)% 증가/); if (m) push({ bucket: 'stackEffectDmg', value: pct(m[2]!), filter: { ...self, minStacks: 4 }, source: `${src}(4중첩)` }); }
    if (!/4 ?중첩|중첩에 따라|스킬 및 스택트/.test(desc) && (v = num(desc, /스택트 (?:효과(?:의)? 피해|피해 효과)(?:가|량이) ([\d.]+)% 증가/)) !== null) push({ bucket: 'stackEffectDmg', value: pct(String(v)), filter: self, source: src });
    if ((v = num(desc, /스킬 및 스택트 (?:효과(?:의)? )?피해가 ([\d.]+)% 증가/)) !== null) push({ bucket: 'skillDmg', value: pct(String(v)), filter: self, source: src });
    else if ((v = num(desc, /총 (?:스킬 )?피해량이 ([\d.]+)% 증가/)) !== null) push({ bucket: 'skillDmg', value: pct(String(v)), filter: self, source: src });
    else if ((v = num(desc, /총 ([\d.]+)% 증가/)) !== null) push({ bucket: 'skillDmg', value: pct(String(v)), filter: self, source: src });
    else if (!/증가된 피해|스택트 효과|스택트 피해|치명타 피해|피격이상 면역/.test(desc) && (v = num(desc, /(?:적에게 주는 )?피해가 ([\d.]+)% 증가/)) !== null) push({ bucket: 'skillDmg', value: pct(String(v)), filter: self, source: src });
    if ((v = num(desc, /피격이상 면역인 적에게 주는 피해가 ([\d.]+)% 증가/)) !== null) push({ bucket: 'skillDmg', value: pct(String(v)), filter: self, source: `${src}(피면)` });
  }
  // 계산하지 않는 선택 효과도 개별 누락으로 표시합니다.
  if (!matched && /마나 소모량|부위파괴 레벨|이동속도가|충돌이 무시|방어력을 .*무시|콤보 조작|마나를 .*회복|피격 이상에 면역|홀딩|무력화|차원문을 하나 더|형태로 변경된다/.test(desc)) {
    // 스트림은 조합별 프로필에서 별도 처리하며 이번 공통 누락 표시는 적용하지 않습니다.
    if (skillId !== 'stream_of_edge') warn(`트라이포드 효과 미모델 — 미반영: ${skillId} / ${name}: ${desc}`);
    return;
  }
  if (!matched) warn(`트라이포드 해석 못함: ${skillId} / ${name}: ${desc}`);
}

function parseRune(skillId: string, rune: { Name: string; Grade: string; Tooltip?: string } | null | undefined, p: SkillPatch, warn: (m: string) => void): void {
  if (!rune) return;
  let effectText = tooltipLines(rune.Tooltip).join(' ');
  try {
    const sections: { type?: string; value?: { Element_000?: string } }[] = Object.values(JSON.parse(rune.Tooltip ?? ''));
    if (sections.some(s => s?.type === 'ItemPartBox')) {
      effectText = sections.filter(s => s?.type === 'ItemPartBox' && strip(s.value?.Element_000) === '스킬 룬 효과')
        .flatMap(s => tooltipLines(JSON.stringify(s.value)).filter(t => t !== '스킬 룬 효과')).join(' ');
    }
  } catch { /* 단순 텍스트 입력은 전체 문구를 검사합니다. */ }
  switch (rune.Name) {
    case '속행': case '질풍': case '풍요': {
      const pattern = rune.Name === '속행'
        ? /^스킬 사용 시 일정 확률로 전체 재사용 대기 시간이 (\d+(?:\.\d+)?)% 감소(?:합니다)?\.?$/
        : rune.Name === '질풍'
          ? /^스킬 시전 속도가 (\d+(?:\.\d+)?)% 증가(?:합니다)?\.?$/
          : /^스킬 적중 시 아이덴티티 게이지 획득량 (\d+(?:\.\d+)?)% 증가(?:합니다)?\.?$/;
      const effect = effectText.match(pattern);
      const value = effect ? Number(effect[1]) : NaN;
      if (!Number.isFinite(value) || value > 100) {
        warn(`룬 ${rune.Name} 해석 못함 (${skillId}) — 수치를 추정하지 않고 미반영`);
        break;
      }
      if (rune.Name === '질풍') p.castSpeed += value / 100;
      else if (rune.Name === '풍요') p.set.gaugeMultiplier = 1 + value / 100;
      else {
        p.set.runeCdReduce = { chance: 0.2, fraction: value / 100 };
      }
      break;
    }
    case '출혈': case '중독': warn(`룬 ${rune.Name}(도트) 미모델 (${skillId})`); break;
    case '단죄': case '심판': {
      const pattern = rune.Name === '단죄'
        ? /^스킬 적중 시 ([\d.]+)% 확률로 자신에게 ([\d.]+)초간 지속되는 '단죄' 상태 부여하며 해당 상태 일 때 '심판' 을 통해 추가 효과를 발동\.?$/
        : /^스킬 적중 시 ([\d.]+)% 확률로 자신의 '단죄' 상태를 제거하여 ([\d.]+)초간 전투자원 회복량 증가 및 스킬 재사용 대기시간 감소\.?$/;
      const m = effectText.match(pattern);
      if (m && m.slice(1).every(v => Number.isFinite(Number(v))) && Number(m[1]) >= 0 && Number(m[1]) <= 100 && Number(m[2]) > 0) {
        p.set.hitRune = { kind: rune.Name === '단죄' ? 'conviction' : 'judgment', chance: Number(m[1]) / 100, duration: Number(m[2]) };
      } else warn(`룬 ${rune.Name} 해석 못함 (${skillId}) — 확률·지속시간을 추정하지 않고 미반영`);
      break;
    }
    case '단심': warn(`룬 단심은 단죄·심판의 조합 이름입니다 (${skillId}) — 개별 룬 입력 필요·미반영`); break;
    default: warn(`룬 ${rune.Name} 미모델 (${skillId}) — 효과 미반영`); break;
  }
}

// ---------- 스킬 ----------
function convertSkills(raw: RawArmory, variant: Build['variant'], warn: (m: string) => void): SkillDef[] {
  const out: SkillDef[] = [];
  for (const s of raw.combatSkills) {
    if (s.SkillType >= 100) continue; // 각성기: 미모델
    const selected = (s.Tripods ?? []).filter((t) => t.IsSelected);
    const isHyper = s.SkillType === 1;
    if (!isHyper && s.Level <= 1 && selected.length === 0) continue;
    if (isHyper && s.Name !== (variant === 'empress' ? '더 데빌' : '더 썬')) continue;
    const row = BY_NAME.get(s.Name);
    if (!row) { warn(`data/skills.json 에 없는 스킬: ${s.Name}`); continue; }
    const lines = tooltipLines(s.Tooltip);
    const kindText = lines.find((l) => /^\[.*스킬\]$/.test(l)) ?? '';
    let kind: SkillKind = isHyper ? 'hyper_awakening' : kindText.includes('루인') ? 'ruin' : kindText.includes('스택트') ? 'stack' : 'normal';
    const cdLine = lines.find((l) => l.startsWith('재사용 대기시간'));
    const cooldown = (cdLine && parseSeconds(cdLine.replace('재사용 대기시간', ''))) || row.cooldown;
    const p: SkillPatch = { mods: [], onCast: [], set: kind === 'stack' ? { stacksGranted: row.maxStacks ?? 1 } : {}, castSpeed: 0, cdDelta: 0 };
    if (row.id === 'evoke' && !selected.some(t => ['분할 마법진', '중첩 마법진'].includes(t.Name))) {
      p.set.manualEvoke = manualEvoke([{ after: 0, weight: 1 }], false);
    }
    for (const t of selected) parseTripod(row.id, t.Name, strip(t.Tooltip), p, warn);
    parseRune(row.id, s.Rune, p, warn);
    if (p.set.kind) kind = p.set.kind;
    const stream132 = row.id === 'stream_of_edge' && p.set.stacksGranted === 3 &&
      ['카드 증가', '다크니스 엣지', '퍼펙트 스트림'].every(name => selected.some(t => t.Name === name));
    const damage: ReturnType<typeof resolveSkillDamage> = (stream132 ? resolveStream132Damage(s.Level) : undefined)
      ?? (p.callVariant ? resolveCallOfDestinyDamage(s.Level, p.callVariant) : undefined)
      ?? (row.id === 'return' ? resolveReturnFirstDamage(s.Level, !!p.set.onHit?.some(e => e.mod.source === '노출된 어둠')) : undefined)
      ?? resolveSkillDamage(row, s.Level, p.serendipityContinuous, p.darkStage);
    if (p.stampedeFocus !== undefined) {
      const focused = resolveStampedeFocusDamage(s.Level, p.stampedeFocus);
      if (selected.some(t => t.Name === '연속 공격')) warn('신비한 쇄도 / 쇄도 집중: 연속 공격의 세 번째 타격 프로필 미지원 — 집중 배율 미반영');
      else if (!focused) warn('신비한 쇄도 / 쇄도 집중: 지원 레벨의 기본 계수 없음 — 집중 배율 미반영');
      else {
        Object.assign(damage, focused);
        warn('신비한 쇄도 / 쇄도 집중: 첫·둘째 기본 판정에 표시 증가율의 1배·2배를 적용하는 후보입니다. 두 피해는 시전 종료에 합산하며 개별 치명 판정·시각·현행 실측은 미검증입니다.');
      }
    }
    if (p.darkFinalMultiplier !== undefined && damage.delayedHits) {
      const last = damage.delayedHits.hits.at(-1)!;
      last.directCoef *= p.darkFinalMultiplier; last.directFlat *= p.darkFinalMultiplier;
      damage.directCoef = damage.delayedHits.hits.reduce((sum, h) => sum + h.directCoef, 0);
      damage.directFlat = damage.delayedHits.hits.reduce((sum, h) => sum + h.directFlat, 0);
    }
    const def: SkillDef = {
      id: row.id, name: row.name, kind,
      cooldown: Math.max(1, cooldown + p.cdDelta),
      ...damage,
      castTime: (p.set.splitEvoke?.duration ?? p.set.manualEvoke?.duration ?? damage.castTime ?? (isHyper ? 1.5 : CAST_DEFAULT)) / (1 + p.castSpeed),
      hits: damage.hits ?? HITS[row.id] ?? Math.max(1, row.baseDamageLv10?.length ?? 1),
      mods: p.mods, onCast: p.onCast,
      ...(kind === 'stack' ? { stacksGranted: p.set.stacksGranted ?? row.maxStacks ?? 1 } : {}),
      ...p.set,
    };
    if (p.poison) {
      const poison = resolveEvokePoison(s.Level);
      if (poison && (def.splitEvoke || def.manualEvoke)) def.manaPoison = { ...poison, ...p.poison };
      else warn('이보크 마나 중독: 지원 레벨의 계수 또는 설치 프로필 없음 — 도트 미반영');
    }
    if (p.fearDuration) {
      const poison = resolveFearOfDeath(s.Level);
      if (poison && def.delayedHits) def.fearOfDeath = { ...poison, duration: p.fearDuration, maxStacks: 1 };
      else warn('죽음의 공포: 지원 레벨의 계수 또는 발사 프로필 없음 — 도트 미반영');
    }
    const manaLine = lines.find(l => /^마나 [\d,]+ 소모/.test(l));
    if (manaLine) def.usesMana = (num(manaLine.replaceAll(',', ''), /마나 (\d+) 소모/) ?? 0) > 0;
    else warn(`마나 사용 여부 [미확인]: ${s.Name} — 마나 전용 효과 미반영`);
    if (isHyper) {
      if (kindText.includes('루인')) def.tags = ['ruin'];
      else if (kindText.includes('일반')) def.tags = ['normal'];
      else warn(`초각성 스킬의 직업 분류 [미확인]: ${s.Name} — 루인/일반 전용 효과 미반영`);
    }
    if (selected.some((t) => t.Name === '퀵 드로')) {
      def.tags = [...(def.tags ?? []), 'quickdraw'];
      if (def.quickDraw?.trigger === 'each') {
        const has = (name: string) => selected.some(t => t.Name === name);
        if (row.id === 'call_of_destiny') def.quickDraw.attempts = def.hits;
        else if (row.id === 'evoke') {
          def.quickDraw.attempts = has('중첩 마법진') ? 3 : 1;
        } else {
          delete def.quickDraw;
          warn(`퀵 드로 판정 횟수 미확인: ${s.Name} — 미반영`);
        }
      }
    }
    out.push(def);
  }
  return out;
}

// ---------- 아크 패시브 ----------
interface PassiveCtx { mods: Modifier[]; onSkillCast: TimedEffect[]; onCardUse: TimedEffect[]; onRuinAt4: TimedEffect[]; cardDuration: Record<string, number>; deckAdd: string[]; deckRemove: string[]; bluntThorn?: Build['bluntThorn']; gaugeBonus: number; normalGaugePenalty: number; skillPatches: Map<string, Modifier[]>; hiddenHandChance?: number; darknessEdgeCritDmg?: Modifier; infinityDeck?: Build['infinityDeck']; ruinFullset?: boolean; chainDraw?: Build['chainDraw']; stackHold?: boolean; emperorHeartChance?: number; normalEnhanceCooldown?: number; normalEnhanceBuff?: TimedEffect; impactMateBuff?: TimedEffect; highTempoBuffs?: TimedEffect[]; anotherEmperorChance?: number; flowerCooldownDelta?: number; flowerThornBonus?: number; flowerThornChance?: number; hyperCastSpeed?: number; }

function parseArkPassive(raw: RawArmory, ctx: PassiveCtx, warn: (m: string) => void): void {
  for (const e of raw.arkpassive?.Effects ?? []) {
    const d = strip(e.Description);
    const m = d.match(/^(진화|깨달음|도약) (\d)티어 (.+) Lv\.(\d+)$/);
    const name = m?.[3] ?? d;
    const lines = tooltipLines(e.ToolTip).filter((t) => !['NameTagBox', 'CommonSkillTitle', 'MultiTextBox', '진화', '깨달음', '도약', name].includes(t));
    const desc = lines.join(' ').replace(/\|\|/g, ' ').trim();
    const src = `${name} Lv${m?.[4] ?? '?'}`;
    let ok = false;
    const push = (mod: Modifier) => { ctx.mods.push(mod); ok = true; };
    switch (name) {
      case '치명': case '특화': case '신속': case '제압': case '인내': case '숙련': ok = true; break; // 프로필 Stats 에 반영됨
      case '한계 돌파': case '예리한 감각': case '혼신의 강타': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const limit = name === '한계 돌파';
        const effect = text.match(limit ? /^진화형 피해가 ([\d.]+)% 증가합니다\.$/
          : /^치명타 적중률이 ([\d.]+)% 증가하고, 진화형 피해가 ([\d.]+)% 증가합니다\.$/);
        if (m?.[1] === '진화' && m[2] === (name === '혼신의 강타' ? '3' : '2') &&
            Number(m[4]) > 0 && Number(m[4]) <= (limit ? 3 : 2) && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          push({ bucket: 'evoDmg', value: Number(effect[limit ? 1 : 2]) / 100, source: src });
          if (!limit) push({ bucket: 'critRate', value: Number(effect[1]) / 100, source: src });
        }
        break;
      }
      case '파괴 전차': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^진화형 피해가 ([\d.]+)% 증가하고, 공격 속도가 ([\d.]+)% 증가합니다\.$/);
        if (m?.[1] === '진화' && m[2] === '3' && ['1', '2'].includes(m[4]!) && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          push({ bucket: 'evoDmg', value: Number(effect[1]) / 100, source: src });
          push({ bucket: 'atkSpeed', value: Number(effect[2]) / 100, source: src });
        }
        break;
      }
      case '일격': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^치명타 적중률이 ([\d.]+)% 증가하고, 방향성 공격 스킬의 치명타 피해가 ([\d.]+)% 증가합니다\.$/);
        if (m?.[1] === '진화' && m[2] === '3' && [1, 2].includes(Number(m[4])) && effect &&
            [effect[1], effect[2]].every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          const ids = raw.combatSkills.flatMap(s => {
            const id = BY_NAME.get(s.Name)?.id;
            return id && tooltipLines(s.Tooltip).some(l => /공격 타입\s*:\s*(?:백|헤드) 어택/.test(l)) ? [id] : [];
          });
          push({ bucket: 'critRate', value: Number(effect[1]) / 100, source: src });
          push({ bucket: 'critDmg', value: Number(effect[2]) / 100, filter: { ids, component: 'direct' }, source: src });
        }
        break;
      }
      case '금단의 주문': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const damage = text.match(/^진화형 피해가 ([\d.]+)% 증가, 마나 스킬의 진화형 피해는 ([\d.]+)% 더 증가하고, 마나 소모량이 ([\d.]+)% 감소합니다\.$/);
        if (m?.[1] === '진화' && m[2] === '2' && Number(m[4]) > 0 && Number(m[4]) <= 2 && damage &&
            [damage[1], damage[2], damage[3]].every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          push({ bucket: 'evoDmg', value: Number(damage[1]) / 100, source: src });
          push({ bucket: 'evoDmg', value: Number(damage[2]) / 100, filter: { usesMana: true }, dotScope: 'exclude', source: src });
        }
        break;
      }
      case '회심': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^공격이 치명타로 적중 시 적에게 주는 피해가 ([\d.]+)% 증가하며, 받는 피해가 ([\d.]+)% 감소합니다\.$/);
        if (m?.[1] === '진화' && m[2] === '4' && m[4] === '1' && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          push({ bucket: 'critHitDmg', value: Number(effect[1]) / 100, source: src });
        }
        break;
      }
      case '분쇄': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^진화형 피해가 ([\d.]+)% 증가하며, 받는 피해가 ([\d.]+)% 감소합니다\.$/);
        if (m?.[1] === '진화' && m[2] === '4' && m[4] === '1' && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          push({ bucket: 'evoDmg', value: Number(effect[1]) / 100, source: src });
        }
        break;
      }
      case '달인': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^받는 피해가 ([\d.]+)% 감소하며, 이동기 및 기상기를 제외한 스킬 사용\s?시 ([\d.]+)초간 '달인' 효과를 얻습니다\.\s*달인 : 치명타 적중률 \+([\d.]+)% \/ 추가 피해 \+([\d.]+)%, 최대 (\d+)중첩$/);
        if (m?.[1] === '진화' && m[2] === '4' && m[4] === '1' && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v))) && Number(effect[2]) > 0 &&
            Number.isSafeInteger(Number(effect[5])) && Number(effect[5]) > 0) {
          const duration = Number(effect[2]), maxStacks = Number(effect[5]);
          ctx.onSkillCast.push({ id: 'master_crit', duration, maxStacks, mod: { bucket: 'critRate', value: Number(effect[3]) / 100, source: src } },
            { id: 'master_damage', duration, maxStacks, mod: { bucket: 'addDmg', value: Number(effect[4]) / 100, source: src } });
          ok = true;
        }
        break;
      }
      case '뭉툭한 가시': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^진화형 피해가 ([\d.]+)% 증가합니다\. 치명타가 발생할 확률이 최대 ([\d.]+)%\s*로 제한됩니다\. 공격 시, 초과한 모든 치명타가 발생할 확률의 ([\d.]+)%가 진화형 피해로 전환됩니다\. 이 노드에 의한 진화형 피해는 최대 ([\d.]+)%까지 적용됩니다\.$/);
        if (m?.[1] === '진화' && m[2] === '5' && ['1', '2'].includes(m[4]!) && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v))) && Number(effect[2]) === 80) {
          ctx.bluntThorn = { base: Number(effect[1]) / 100, ratio: Number(effect[3]) / 100, cap: Number(effect[4]) / 100 };
          ok = true;
        }
        break;
      }
      case '입식 타격가': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^진화형 피해가 ([\d.]+)%, 낙인력이 ([\d.]+)% 증가합니다\.\s*전투 시작 후, '(입식 타격 I{1,2})' 효과를 최대로 얻습니다\. 피격 이상 시 중첩을 (\d+)회 잃습니다\. 이후 ([\d.]+)초가 지날 때마다 효과를 1중첩 회복합니다\.\s*\3 : 진화형 피해 \+([\d.]+)% \/ 낙인력 \+([\d.]+)% , 최대 (\d+)중첩$/);
        if (m?.[1] === '진화' && m[2] === '5' && [1, 2].includes(Number(m[4])) && effect &&
            [1, 2, 4, 5, 6, 7, 8].every(i => Number.isFinite(Number(effect[i]))) && Number(effect[8]) > 0) {
          push({ bucket: 'evoDmg', value: (Number(effect[1]) + Number(effect[6]) * Number(effect[8])) / 100,
            source: `${src}(${effect[8]}중첩 상시)` });
        }
        break;
      }
      case '황후의 계략': case '황후의 탐욕': case '황후의 연회': case '황후의 속삭임': case '황제의 자비': {
        const tier = name === '황후의 계략' ? '2' : name === '황후의 속삭임' ? '4' : '3';
        const maxLevel = name === '황후의 계략' ? 2 : name === '황후의 탐욕' || name === '황제의 자비' ? 5 : 3;
        if (m?.[1] !== '깨달음' || m[2] !== tier || Number(m[4]) < 1 || Number(m[4]) > maxLevel) break;
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const valid = (effect: RegExpMatchArray | null): effect is RegExpMatchArray => !!effect &&
          effect.slice(1).every(v => v === undefined || (Number.isFinite(Number(v)) && Number(v) <= 100));
        if (name === '황후의 계략') {
          const effect = text.match(/^카드덱에 도태 카드의 지속시간이 ([\d.]+)초 증가한다\.\s*(?:카드덱에 심판 카드의 지속시간이 ([\d.]+)초 증가한다\.)?$/);
          if (valid(effect) && (m[4] === '1' || effect[2] !== undefined)) {
            ctx.cardDuration['cull'] = Number(effect[1]);
            if (effect[2] !== undefined) ctx.cardDuration['judgment'] = Number(effect[2]);
            ok = true;
          }
        } else if (name === '황후의 탐욕') {
          const effect = text.match(/^루인 스킬의 피해량이 ([\d.]+)% 증가하며 덱 게이지 획득량이 ([\d.]+)% 증가하지만, 일반 스킬의 덱 게이지 획득량이 ([\d.]+)% 감소한다\.$/);
          if (valid(effect)) {
            push({ bucket: 'skillDmg', value: Number(effect[1]) / 100, filter: { kinds: ['ruin'] }, source: src });
            ctx.gaugeBonus += Number(effect[2]) / 100; ctx.normalGaugePenalty -= Number(effect[3]) / 100;
          }
        } else if (name === '황후의 연회') {
          const effect = text.match(/^4스택 이상의 루인 피해량이 ([\d.]+)% 증가한다\.$/);
          if (valid(effect)) push({ bucket: 'skillDmg', value: Number(effect[1]) / 100, filter: { kinds: ['ruin'], minStacks: 4 }, source: src });
        } else if (name === '황후의 속삭임') {
          const effect = text.match(/^루인 스킬의 피해량이 ([\d.]+)% 증가하며 일반 스킬과 스택트 스킬의 재사용 대기시간이 ([\d.]+)% 감소한다\. 추가로 4스택 이상인 적에게 루인 스킬 적중 시 ([\d.]+)초간 자신의 공격속도를 ([\d.]+)% 증가 시키는 효과를 추가한다\.$/);
          if (valid(effect) && Number(effect[3]) > 0) {
            push({ bucket: 'skillDmg', value: Number(effect[1]) / 100, filter: { kinds: ['ruin'] }, source: src });
            push({ bucket: 'cooldown', value: Number(effect[2]) / 100, filter: { kinds: ['normal', 'stack'] }, source: src });
            ctx.onRuinAt4.push({ id: 'whisper_as', duration: Number(effect[3]), mod: { bucket: 'atkSpeed', value: Number(effect[4]) / 100, source: src } });
          }
        } else {
          const effect = text.match(/^카드 사용 시 ([\d.]+)초간 적에게 주는 피해가 ([\d.]+)% 증가한다\. 또한 이동기의 재사용 대기 시간이 즉시 ([\d.]+)초 감소한다\.$/);
          if (valid(effect) && Number(effect[1]) > 0) {
            ctx.onCardUse.push({ id: 'mercy', duration: Number(effect[1]), mod: { bucket: 'dmgToEnemy', value: Number(effect[2]) / 100, source: src } });
            ok = true;
          }
        }
        break;
      }
      case '황후의 기사': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^카드덱에 황후의 기사 카드가 추가되고, 황후의 기사 카드의 피해량이 ([\d.]+)% 증가한다\.$/);
        if (m?.[1] === '깨달음' && m[2] === '4' && Number(m[4]) >= 1 && Number(m[4]) <= 5 &&
            ((effect && Number.isFinite(Number(effect[1]))) || text === '카드덱에 황후의 기사 카드가 추가된다.')) {
          ctx.deckAdd.push('empress_knight');
          if (effect) push({ bucket: 'skillDmg', value: Number(effect[1]) / 100, filter: { ids: ['card_empress_knight'] }, source: src });
          warn('황후의 기사 기본 피해 계수의 기준 전투 레벨 [미확인] → 자동 입력 0'); ok = true;
        } else warn(`${src}: 카드 추가·피해 증가 문구 미확인 — 미반영`);
        break;
      }
      case '황후의 은총': ok = true; break; // 마나 미모델
      case '황제의 하사품': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^카드덱의 균형 카드가 재상 카드로 교체된다\.\s*(카드덱의 심판 카드가 제후 카드로 교체된다\.)?$/);
        if (m?.[1] === '깨달음' && m[2] === '2' && ['1', '2'].includes(m[4]!) && effect &&
            (m[4] === '1' || effect[1] !== undefined)) {
          ctx.deckAdd.push('chancellor'); ctx.deckRemove.push('balance');
          if (effect[1]) { ctx.deckAdd.push('sovereign'); ctx.deckRemove.push('judgment'); }
          ok = true;
        }
        break;
      }
      case '황제의 칙령': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^카드덱에 황제 카드가 추가되고, 황제 카드의 피해량이 ([\d.]+)% 증가한다\.$/);
        if (m?.[1] === '깨달음' && m[2] === '1' && Number(m[4]) >= 1 && Number(m[4]) <= 3 &&
            ((effect && Number.isFinite(Number(effect[1]))) || text === '카드덱에 황제 카드가 추가된다.')) {
          if (effect) push({ bucket: 'emperorCardDmg', value: Number(effect[1]) / 100, filter: { ids: ['card_emperor'] }, source: src });
          ok = true;
        } else warn(`${src}: 황제 피해 증가 문구 미확인 — 미반영`);
        warn('황제 카드 기본 피해 계수의 기준 전투 레벨 [미확인]'); break;
      }
      case '황제의 만찬': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^일반 스킬 사용 시 마나를 ([\d.]+)% 회복하며, 일반 스킬의 피해량이 ([\d.]+)% 증가한다\.$/);
        if (m?.[1] === '깨달음' && m[2] === '3' && Number(m[4]) >= 1 && Number(m[4]) <= 3 && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          push({ bucket: 'skillDmg', value: Number(effect[2]) / 100, filter: { kinds: ['normal'] }, source: src });
        }
        break;
      }
      case '또 다른 황제': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^적에게 주는 피해가 ([\d.]+)% 증가하며, 황제 카드의 효과가 다른 카드를 사용\s?시 ([\d.]+)% 확률로 발생하며, 황제\s?카드의 피해량이 추가로 ([\d.]+)% 더해진다\.$/)
          ?? (m?.[4] === '1' ? text.match(/^적에게 주는 피해가 ([\d.]+)% 증가하며, 황제 카드의 효과가 다른 카드를 사용\s?시 ([\d.]+)% 확률로 발생한다\.$/) : null);
        if (m?.[1] === '깨달음' && m[2] === '4' && Number(m[4]) >= 1 && Number(m[4]) <= 3 && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v))) && Number(effect[2]) <= 100) {
          push({ bucket: 'dmgToEnemy', value: Number(effect[1]) / 100, source: src });
          ctx.anotherEmperorChance = Number(effect[2]) / 100;
          if (effect[3] !== undefined) {
            push({ bucket: 'emperorCardDmg', value: Number(effect[3]) / 100, filter: { ids: ['card_emperor'] }, source: src });
            warn(`${src}: 추가 카드 피해 ${Number(effect[3])}%는 칙령과 합연산 후보로 직접 사용·추가 발동에 적용 [공식 문구·작성자 계산 대조, 실측 미검증]`);
          }
        }
        break;
      }
      case '황제의 심판': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^루인 스킬의 피해량이 ([\d.]+)% 감소하지만, 스택트 스킬과 일반 ?스킬이 적에게 주는 피해가 ([\d.]+)% 증가한다\.$/);
        if (m?.[1] === '깨달음' && m[2] === '4' && Number(m[4]) >= 1 && Number(m[4]) <= 5 && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          push({ bucket: 'skillDmg', value: -Number(effect[1]) / 100, filter: { kinds: ['ruin'] }, source: src });
          // 분류 전용 효과의 도트 적용은 문구만으로 확정하지 않습니다.
          push({ bucket: 'skillDmg', value: Number(effect[2]) / 100, filter: { kinds: ['normal', 'stack'] }, source: src });
        }
        break;
      }
      case '풀려난 힘': case '잠재력 해방': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(name === '풀려난 힘' ? /^초각성 스킬이 적에게 주는 피해가 ([\d.]+)% 증가한다\.$/
          : /^초각성 스킬의 재사용 대기 시간이 ([\d.]+)% 감소한다\.$/);
        if (m?.[1] === '도약' && m[2] === '1' && Number(m[4]) >= 1 && Number(m[4]) <= 5 && effect &&
            Number.isFinite(Number(effect[1])) && Number(effect[1]) <= 100) {
          push({ bucket: name === '풀려난 힘' ? 'dmgToEnemy' : 'cooldown', value: Number(effect[1]) / 100,
            filter: { kinds: ['hyper_awakening'] }, source: src });
        }
        break;
      }
      case '초월적인 힘': warn(`${src}: 초각성기 피해 [미모델·미반영] — T 스킬에는 적용하지 않습니다`); ok = true; break;
      case '즉각적인 주문': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const speed = text.match(/^초각성 스킬의 시전 속도가 ([\d.]+)% 증가하고, 마나 소모량이 ([\d.]+)% 감소한다\.$/);
        if (m?.[1] === '도약' && m[2] === '1' && Number(m[4]) > 0 && Number(m[4]) <= 3 && speed &&
            Number(speed[1]) > 0 && Number(speed[1]) <= 100 && Number(speed[2]) <= 100) {
          ctx.hyperCastSpeed = Number(speed[1]) / 100;
          warn(`${src}: T 스킬 시전시간을 1 / (1 + ${speed[1]}%)로 보정하는 후보이며 공속·질풍 조합과 실제 타격 시각은 미검증입니다. 마나 소모 ${speed[2]}% 감소는 미모델·미반영`);
          ok = true;
        }
        break;
      }
      case '각성 증폭기': case '충전된 분노': ok = true; break;
      case '쿼즈': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(/^더 데빌의 피해가 ([\d.]+)% 증가하고, 4중첩인 적에게 기존 스택트 효과에 추가로 ([\d.]+)% 증가된 피해를 준다\.$/);
        if (m?.[1] === '도약' && m[2] === '2' && Number(m[4]) >= 1 && Number(m[4]) <= 3 && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          push({ bucket: 'skillDmg', value: Number(effect[1]) / 100, filter: { ids: ['the_devil'] }, source: src });
          push({ bucket: 'stackEffectDmg', value: Number(effect[2]) / 100, filter: { ids: ['the_devil'], minStacks: 4 }, source: `${src}(4중첩)` });
        }
        break;
      }
      case '폴스 딜': case '숨겨진 패': {
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const effect = text.match(name === '폴스 딜'
          ? /^더 썬이 적에게 주는 피해가 ([\d.]+)% 증가하고, 치명타 피해가 ([\d.]+)% 증가한다\.$/
          : /^더 썬이 적에게 주는 피해가 ([\d.]+)% 증가하고, 마지막 타격 적중 시 ([\d.]+)% 확률로 아이덴티티 카드를 1장 획득한다\.$/);
        if (m?.[1] === '도약' && m[2] === '2' && Number(m[4]) >= 1 && Number(m[4]) <= 3 && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          const filter = { ids: ['the_sun'], component: 'direct' as const };
          push({ bucket: 'skillDmg', value: Number(effect[1]) / 100, filter, source: src });
          if (name === '폴스 딜') push({ bucket: 'critDmg', value: Number(effect[2]) / 100, filter, source: src });
          else ctx.hiddenHandChance = Number(effect[2]) / 100;
        }
        break;
      }
      case '끝없는 마나': case '무한한 마력': case '최적화 훈련': case '타이밍 지배': {
        // 조건이나 대상이 바뀐 문구에서 수치만 떼어 상시 효과로 적용하지 않습니다.
        const text = lines.filter(l => !/^아크 패시브 레벨 \d+$/.test(l)).join(' ').replace(/\|\|/g, ' ').trim();
        const endless = name === '끝없는 마나', infinite = name === '무한한 마력';
        const effect = text.match(endless
          ? /^마나 사용 스킬의 재사용 대기시간이 ([\d.]+)% 감소하고, 마나 소모량이 ([\d.]+)% 감소합니다\.$/
          : infinite
            ? /^진화형 피해가 ([\d.]+)% 증가하고, 마나 스킬의 재사용 대기시간이 ([\d.]+)% 감소, 마나 소모량이 ([\d.]+)% 감소합니다\.$/
            : /^각성기, 이동 및 기상기를 제외한 스킬의 재사용 대기시간이 ([\d.]+)% 감소하고, 진화형 피해가? ([\d.]+)% 증가합니다\.$/);
        const tier = infinite || name === '타이밍 지배' ? '3' : '2';
        if (m?.[1] === '진화' && m[2] === tier && [1, 2].includes(Number(m[4])) && effect &&
            effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100)) {
          if (!endless) push({ bucket: 'evoDmg', value: Number(effect[infinite ? 1 : 2]) / 100, source: src });
          push({ bucket: 'cooldown', value: Number(effect[infinite ? 2 : 1]) / 100,
            filter: endless || infinite ? { usesMana: true } : { excludeKinds: ['awakening'] },
            source: src, cooldownGroup: endless || infinite ? 'manaEvolution' : 'nonAwakeningEvolution' });
        }
        break;
      }
      // 미지원 노드의 조건·대상을 지우고 일부 수치만 상시 적용하지 않습니다.
      default: break;
    }
    if (!ok) warn(`아크패시브 해석 못함: ${src}: ${desc}`);
  }
}

// ---------- 아크 그리드 ----------
function parseGridOption(core: string, p: number, text: string, ctx: PassiveCtx, params: Partial<SimParams>, destiny: { draw: boolean }, warn: (m: string) => void): void {
  const src = `${core} ${p}P`;
  const push = (mod: Modifier) => { ctx.mods.push(mod); };
  const skillPatch = (id: string, mod: Modifier) => { const arr = ctx.skillPatches.get(id) ?? []; arr.push(mod); ctx.skillPatches.set(id, arr); };
  const onCast = (id: string, e: TimedEffect) => { skillPatch(id, { bucket: 'skillDmg', value: 0, source: `__onCast__${JSON.stringify(e)}` }); };
  const unsupported = (part: string) => warn(`코어 옵션 [미모델·미반영]: ${src}: ${part}`);

  { const m = text.match(/^공격력이 ([\d.]+)% 증가하고, 추가로 ([\d,]+) 증가한다\.$/); if (m) { push({ bucket: 'atk', value: pct(m[1]!), source: src }); push({ bucket: 'atkFlat', value: Number(m[2]!.replaceAll(',', '')), source: src }); return; } }
  { const m = text.match(/^이보크의 재사용 대기 ?시간이 ([\d.]+)초 증가하지만, '마나 중독' 트라이포드 적용 시 마나 중독 피해량이 ([\d.]+)% 증가한다\.$/); if (m) {
    skillPatch('evoke', { bucket: 'cooldown', value: -1, source: `__cdDelta__${Number(m[1])}` });
    push({ bucket: 'skillDmg', value: pct(m[2]!), filter: { ids: ['evoke'], component: 'dot' }, dotScope: 'include', source: src });
    return;
  } }
  // 문장 전체를 처리한 조건부 효과는 상시 패턴으로 다시 해석하지 않습니다.
  if (core === '황제의 심장' && p === 14) {
    const use = text.match(/^스택트 스킬과 일반 스킬 사용 시 ([\d.]+)% 확률로 '운명'이 발동한다\.$/);
    if (use && Number(use[1]) <= 100) {
      ctx.emperorHeartChance = pct(use[1]!);
      warn(`${src}: 일반·스택트 첫 시전만 반영합니다. 이보크 재입력·수동 격발·엣지 두 번째 입력·T 스킬은 미확인·미반영이며 동일 시각 쿨 시작 순서는 미검증입니다.`);
      return;
    }
  }
  if (core === '황제의 심장' && p === 17) {
    const emperor = text.match(/^황제 카드의 피해량이 ([\d.]+)% 증가한다\.$/);
    if (emperor) { push({ bucket: 'skillDmg', value: pct(emperor[1]!), filter: { ids: ['card_emperor'] }, source: src }); return; }
  }
  if (core === '다크 콜렉션' && p === 14) {
    const poison = text.match(/^다크 리저렉션의 '죽음의 공포' 트라이포드 적용 시 중독 피해량이 ([\d.]+)% 증가한다\.$/);
    if (poison) { push({ bucket: 'skillDmg', value: pct(poison[1]!), filter: { ids: ['dark_resurrection'], component: 'dot' }, dotScope: 'include', source: src }); return; }
  }
  if (core === '셔플 댄스' && p === 10) {
    const flower = text.match(/^댄싱 오브 스파인플라워의 '페이크 플립' 트라이포드 적용 시 재사용 대기시간이 ([\d.]+)초 증가하지만, 치명적 가시 피해량이 ([\d.]+)% 증가한다\.$/);
    if (flower) {
      ctx.flowerCooldownDelta = Number(flower[1]);
      ctx.flowerThornBonus = pct(flower[2]!); return;
    }
  }
  if (core === '셔플 댄스' && p === 14) {
    const thorn = text.match(/^댄싱 오브 스파인플라워의 '페이크 플립' 트라이포드 적용 시 치명적 가시 피해 증가 효과가 2중첩씩 증가하고, 치명적 가시 공격이 적중 시 ([\d.]+)% 확률로 아이덴티티 카드를 1장을 획득한다\.$/);
    if (thorn && Number(thorn[1]) <= 100) { ctx.flowerThornChance = pct(thorn[1]!); return; }
  }
  if (core === '셔플 댄스' && p === 17) {
    const shuffle = text.match(/^언리미티드 셔플의 재사용 대기시간이 ([\d.]+)초 증가하지만, 피해량이 ([\d.]+)% 증가한다\.$/);
    if (shuffle) {
      skillPatch('unlimited_shuffle', { bucket: 'cooldown', value: -1, source: `__cdDelta__${Number(shuffle[1])}` });
      push({ bucket: 'skillDmg', value: pct(shuffle[2]!), filter: { ids: ['unlimited_shuffle'] }, source: src }); return;
    }
  }
  if (core === '스택 홀드') {
    if (p === 14 && /^아이덴티티 카드 2회 사용 시 '운명'이 발동한다\.?$/.test(text)) { ctx.stackHold = true; return; }
    const stacked = text.match(/^스택트 중첩 중인 적에게 주는 일반 스킬의 피해량이 ([\d.]+)% 증가한다\.$/);
    if (p === 17 && stacked) { push({ bucket: 'skillDmg', value: pct(stacked[1]!), filter: { kinds: ['normal'], minStacks: 1 }, source: src }); return; }
  }
  if (core === '노말 인핸스') {
    const cooldown = text.match(/^'운명' 발동 시 스택트 스킬과 일반 스킬의 재사용 대기시간이 ([\d.]+)% 즉시 감소한다\.$/);
    if (p === 14 && cooldown && Number(cooldown[1]) <= 100) { ctx.normalEnhanceCooldown = pct(cooldown[1]!); return; }
    const buff = text.match(/^'운명' 발동 시 ([\d.]+)초 동안 '운명: 노말 인핸스' 효과를 획득한다\.\s*'운명: 노말 인핸스' : 일반 스킬의 피해량이 ([\d.]+)% 증가한다\.$/);
    if (p === 17 && buff) { ctx.normalEnhanceBuff = { id: 'normal_enhance', duration: Number(buff[1]),
      mod: { bucket: 'skillDmg', value: pct(buff[2]!), filter: { kinds: ['normal'] }, source: src } }; return; }
  }
  if (core === '체인 드로우') {
    const use = text.match(/^아이덴티티 카드 사용 시 ([\d.]+)% 확률로 '운명' ?이 발동한다\.$/);
    if (p === 14 && use && Number(use[1]) <= 100) { (ctx.chainDraw ??= {}).chance = pct(use[1]!); return; }
    const gauge = text.match(/^스킬 적중으로 획득하는 덱 게이지가 ([\d.]+)% 증가한다\.$/);
    if (p === 17 && gauge) { (ctx.chainDraw ??= {}).gaugeBonus = pct(gauge[1]!); return; }
  }
  if (core === '임팩트 메이트') {
    const buff = text.match(/^'운명' 발동 시 ([\d.]+)\s*초 동안 '운명: 임팩트 메이트' 효과를 획득한다\.\s*'운명: 임팩트 메이트' : 적에게 주는 피해가 ([\d.]+)% 증가한다\.$/);
    if (p === 14 && buff) { ctx.impactMateBuff = { id: 'impact_mate', duration: Number(buff[1]),
      mod: { bucket: 'dmgToEnemy', value: pct(buff[2]!), source: src } }; return; }
    const replacement = text.match(/^'운명: 임팩트 메이트' 효과의 적에게 주는 피해 증가량을 ([\d.]+)%\s*로 변경한다\.$/);
    if (p === 17 && replacement && ctx.impactMateBuff) {
      ctx.impactMateBuff.mod = { ...ctx.impactMateBuff.mod, value: pct(replacement[1]!), source: src }; return;
    }
  }
  if (core === '하이 템포') {
    const buff = text.match(/^'운명' 발동 시 ([\d.]+)\s*초 동안 '운명: 하이 템포' 효과를 획득한다\.\s*'운명: 하이 템포' : 마나를 사용하는 스킬의 재사용 대기시간이 ([\d.]+)% 감소한다\.$/);
    if (p === 14 && buff && Number(buff[2]) <= 100) { ctx.highTempoBuffs = [{ id: 'high_tempo', duration: Number(buff[1]),
      mod: { bucket: 'cooldown', value: pct(buff[2]!), filter: { usesMana: true }, source: src } }]; return; }
    // 공식 17P 문구의 여는 따옴표가 두 개입니다. 확인한 표기만 허용합니다.
    const damage = text.match(/^'(?:\s*')?운명: 하이 템포' 효과에 마나를 사용하는 스킬의 피해량 ([\d.]+)% 증가 효과를 추가한다\.$/);
    const cooldown = ctx.highTempoBuffs?.[0];
    if (p === 17 && damage && cooldown) { ctx.highTempoBuffs!.push({ id: 'high_tempo_damage', duration: cooldown.duration,
      mod: { bucket: 'skillDmg', value: pct(damage[1]!), filter: { usesMana: true }, source: src } }); return; }
  }
  if (core === '루인 풀셋' && p === 14 && /^루인 스킬 4회 적중 시 '운명'이 발동한다\.?$/.test(text)) { ctx.ruinFullset = true; return; }
  if (core === '루인 마이너셋') {
    const seren = text.match(/^세렌디피티의 시전 속도가 ([\d.]+)% 증가하고, 피해량이 ([\d.]+)% 증가한다\.$/);
    if (p === 14 && seren) {
      skillPatch('serendipity', { bucket: 'skillDmg', value: 0, source: `__castSpeed__${pct(seren[1]!)}` });
      push({ bucket: 'skillDmg', value: pct(seren[2]!), filter: { ids: ['serendipity'] }, source: src }); return;
    }
    const four = text.match(/^포 ?카드의 피해량이 ([\d.]+)% 증가한다\.$/);
    if (p >= 17 && p <= 20 && four) { push({ bucket: 'skillDmg', value: pct(four[1]!), filter: { ids: ['four_of_a_kind'] }, source: src }); return; }
  }
  if (core === '인피니티 덱' && p === 17) {
    const judgment = text.match(/^심판 카드 사용 시 ([\d.]+)초 뒤 루인 스킬의 재사용 대기시간이 ([\d.]+)% 즉시 감소한다\.$/);
    if (judgment) { (ctx.infinityDeck ??= {}).judgment = { delay: Number(judgment[1]), fraction: pct(judgment[2]!) }; return; }
    const balance = text.match(/^균형 카드 사용 시 ([\d.]+)초 동안 루인 스킬의 피해량이 ([\d.]+)% 증가한다\.$/);
    if (balance) { (ctx.infinityDeck ??= {}).balance = { id: 'infinity_balance', duration: Number(balance[1]),
      mod: { bucket: 'skillDmg', value: pct(balance[2]!), filter: { kinds: ['ruin'] }, source: src } }; return; }
  }
  if (/^'운명' 발동 시 아이덴티티 카드를 1장 획득한다\.$/.test(text)) { destiny.draw = true; return; }
  if (/^스트림 오브 엣지 사용 시 '운명'이 발동한다\.$/.test(text)) { skillPatch('stream_of_edge', { bucket: 'skillDmg', value: 0, source: '__destiny__' }); return; }
  if (/^스트림 오브 엣지가 스택이 가능하게 변경되고, 최대 2회까지 충전된다\.$/.test(text)) { skillPatch('stream_of_edge', { bucket: 'skillDmg', value: 0, source: '__charges2__' }); return; }
  { const m = text.match(/^스트림 오브 엣지 사용 시 ([\d.]+)초 동안 루인 스킬의 피해량이 ([\d.]+)% 증가한다\.$/); if (m) { onCast('stream_of_edge', { id: 'edge_combo', duration: Number(m[1]), mod: { bucket: 'skillDmg', value: pct(m[2]!), filter: { kinds: ['ruin'] }, source: src } }); return; } }
  { const m = text.match(/^스트림 오브 엣지 사용 시 ([\d.]+)초 동안 공격 속도가 ([\d.]+)% 증가한다\.$/); if (m) { onCast('stream_of_edge', { id: 'soe_as', duration: Number(m[1]), mod: { bucket: 'atkSpeed', value: pct(m[2]!), source: src } }); return; } }
  { const m = text.match(/^스트림 오브 엣지의 '다크니스 엣지' 트라이포드 적용 시 획득하는 치명타 적중률 증가 버프 중첩 당 치명타 피해량이 ([\d.]+)% 증가한다\.$/); if (m) {
    ctx.darknessEdgeCritDmg = { bucket: 'critDmg', value: pct(m[1]!), source: src }; return;
  } }
  if (core === '페이탈 핸드') {
    const fate = text.match(/^뒤틀린 운명 카드 사용 시 스킬 피해가 증가하지 않을 확률이 대폭 감소하고, 지속 시간이 ([\d.]+)초 증가한다\.$/);
    if (p === 10 && fate) {
      ctx.cardDuration.twisted_fate = (ctx.cardDuration.twisted_fate ?? 0) + Number(fate[1]);
      params.twistedFateZeroChance = 0.05; // 정확한 확률은 공개되지 않아 기존 임시값을 유지합니다.
      return;
    }
    if (p === 14 && /^도태 카드의 치명타 피해량 증가 효과가 20(?:\.0)?% 증가한다\.$/.test(text)) { params.fatalHandCull = true; return; }
    const corrosion = text.match(/^부식 카드 효과로 적에게 부여하는 자신에게 받는 피해 증가량을 ([\d.]+)% ?로 변경한다\.$/);
    if (p === 17 && corrosion) { params.corrosionValue = pct(corrosion[1]!); return; }
  }

  // 앞에서부터 해석 가능한 상시 절만 소비합니다. 알 수 없는 조건은 잘라내지 않습니다.
  let rest = text;
  while (rest) {
    const clause = rest.match(/^(.+?)(?:한다\.|하고,)\s*/);
    if (!clause) { unsupported(rest); return; }
    const part = clause[1]!;
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^(초각성 스킬을 제외한 )?(루인|일반) 스킬의 피해량이 ([\d.]+)% (?:추가로 )?증가$/))) {
      push({ bucket: 'skillDmg', value: pct(m[3]!), filter: { kinds: [m[2] === '루인' ? 'ruin' : 'normal'], ...(m[1] ? { excludeKinds: ['hyper_awakening'] as SkillKind[] } : {}) }, source: src });
    } else if ((m = part.match(/^마나를 사용하는 스킬의 피해량이 ([\d.]+)% (?:추가로 )?증가$/))) {
      push({ bucket: 'skillDmg', value: pct(m[1]!), filter: { usesMana: true }, source: src });
    } else if ((m = part.match(/^(.+?)의 재사용 대기시간이 ([\d.]+)초 감소$/)) && BY_NAME.has(m[1]!)) {
      skillPatch(BY_NAME.get(m[1]!)!.id, { bucket: 'cooldown', value: -1, source: `__cdDelta__${-Number(m[2])}` });
    } else if ((m = part.match(/^(.+?)의 피해량이 ([\d.]+)% (?:추가로 )?증가$/)) && BY_NAME.has(m[1]!)) {
      push({ bucket: 'skillDmg', value: pct(m[2]!), filter: { ids: [BY_NAME.get(m[1]!)!.id] }, source: src });
    } else if ((m = part.match(/^(?:공격이 )?치명타(?:로 적중 시| 시) 적에게 주는 피해가 ([\d.]+)% (?:추가로 )?증가$/))) {
      push({ bucket: 'critHitDmg', value: pct(m[1]!), source: src });
    } else if ((m = part.match(/^(?:보스 이상 )?적에게 주는 피해가 ([\d.]+)% (?:추가로 )?증가$/))) {
      push({ bucket: 'dmgToEnemy', value: pct(m[1]!), source: src });
    } else if ((m = part.match(/^공격력이 ([\d.]+)% (?:추가로 )?증가$/))) {
      push({ bucket: 'atk', value: pct(m[1]!), source: src });
    } else if ((m = part.match(/^공격력이 ([\d,]+) 증가$/))) {
      push({ bucket: 'atkFlat', value: Number(m[1]!.replaceAll(',', '')), source: src });
    } else if ((m = part.match(/^치명타 피해가 ([\d.]+)% 증가$/))) {
      push({ bucket: 'critDmg', value: pct(m[1]!), source: src });
    } else if ((m = part.match(/^덱 게이지 획득량이 ([\d.]+)% 증가$/))) {
      ctx.gaugeBonus += pct(m[1]!);
    } else {
      unsupported(rest);
      return;
    }
    rest = rest.slice(clause[0].length).trim();
  }
}

function coreRequirementsMet(raw: RawArmory, name: string, lines: string[], warn: (m: string) => void): boolean {
  const index = lines.indexOf('코어 옵션 발동 조건');
  if (index < 0 && !name.startsWith('질서의 ')) return true;
  const text = index < 0 ? '' : lines[index + 1] ?? '';
  const m = text.match(/^(황후의 은총|황제의 칙령) 전용\s*아크 패시브 4티어 (황후의 속삭임|또 다른 황제) 활성화 필요$/);
  if (!m || (m[1] === '황후의 은총' ? m[2] !== '황후의 속삭임' : m[2] !== '또 다른 황제')) {
    warn(`${name}: 활성화 조건 해석 못함 — 코어 옵션 미반영: ${text || '조건 자료 없음'}`); return false;
  }
  const required = [`1티어 ${m[1]}`, `4티어 ${m[2]}`];
  const active = (raw.arkpassive?.Effects ?? []).filter(e => e.Name === '깨달음').flatMap(e => {
    const node = strip(e.Description).match(/^깨달음 ([1-4]티어 .+) Lv\.(\d+)$/);
    return node && Number(node[2]) > 0 && Number(node[2]) <= 3 ? [node[1]!] : [];
  });
  const missing = required.filter(r => !active.includes(r));
  if (raw.profiles.CharacterClassName !== '아르카나' || missing.length) {
    warn(`${name}: 활성화 조건 미충족 — 코어 옵션 미반영 (${missing.join(', ') || '아르카나 전용'})`); return false;
  }
  return true;
}

function parseArkGrid(raw: RawArmory, ctx: PassiveCtx, params: Partial<SimParams>, destiny: { draw: boolean }, warn: (m: string) => void): string[] {
  const names: string[] = [];
  const gemRules = [
    { name: '공격력', bucket: 'atk', pattern: /^공격력\s*\+([\d.]+)%$/ },
    { name: '추가 피해', bucket: 'addDmg', pattern: /^추가 피해\s*\+([\d.]+)%$/ },
    { name: '보스 피해', bucket: 'dmgToEnemy', pattern: /^보스 등급 이상 몬스터에게 주는 피해\s*\+([\d.]+)%$/ },
  ] as const;
  const aggregated = new Set<string>(), fallback = new Map<string, number>();
  for (const rule of gemRules) {
    const effect = raw.arkgrid?.Effects?.find(e => e.Name === rule.name);
    if (!effect) continue;
    aggregated.add(rule.name);
    const m = strip(effect.Tooltip).match(rule.pattern);
    if (m && Number.isFinite(Number(m[1])) && Number(m[1]) >= 0 && Number(m[1]) <= 100)
      ctx.mods.push({ bucket: rule.bucket, value: pct(m[1]!), source: `젬 ${rule.name} 합산` });
    else warn(`젬 ${rule.name} 합산 효과 해석 못함 — 개별 수치로 대체하지 않고 미반영`);
  }
  for (const s of raw.arkgrid?.Slots ?? []) {
    names.push(`${s.Name}(${s.Point})`);
    const lines = tooltipLines(s.Tooltip);
    const validPoint = Number.isSafeInteger(s.Point) && s.Point >= 0;
    if (!validPoint) warn(`코어 포인트 미확인 — 코어 옵션 미반영: ${s.Name}`);
    const opts = validPoint && coreRequirementsMet(raw, s.Name, lines, warn) ? lines.find((l) => /^\[10P\]/.test(l)) ?? '' : '';
    for (const m of opts.matchAll(/\[(\d+)P\]\s*([^\[]+)/g)) {
      const p = Number(m[1]);
      if (p > s.Point) continue;
      const core = s.Name.replace(/^.*: /, '');
      // 발동 조건과 버프 정의를 함께 검사해 조건부 피해가 상시 효과로 분리되지 않게 합니다.
      const parts = (['노말 인핸스', '황제의 심장'].includes(core) && p === 17) || (core === '다크 콜렉션' && p === 14) || (['임팩트 메이트', '하이 템포'].includes(core) && (p === 14 || p === 17)) ? [m[2]!] : m[2]!.split(/(?<=다\.)/);
      for (const part of parts.map((x) => x.trim()).filter(Boolean)) parseGridOption(core, p, part, ctx, params, destiny, warn);
    }
    for (const g of s.Gems ?? []) {
      if (g.IsActive !== true) {
        if (g.IsActive !== false) warn(`젬 활성 상태 미확인 — 개별 효과 미반영: ${s.Name} / 슬롯 ${g.Index}`);
        continue;
      }
      const eff = tooltipLines(g.Tooltip).find((l) => /필요 의지력/.test(l)) ?? '';
      for (const mm of eff.matchAll(/\[([^\]]+)\] Lv\.\d[^+]*\+([\d.]+)%/g)) {
        const rule = gemRules.find(r => r.name === mm[1]);
        if (!rule || aggregated.has(rule.name)) continue;
        const value = Number(mm[2]);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          warn(`젬 ${rule.name} 개별 효과 해석 못함 — 미반영`); continue;
        }
        fallback.set(rule.name, (fallback.get(rule.name) ?? 0) + value / 100);
      }
    }
  }
  for (const rule of gemRules) {
    const value = fallback.get(rule.name);
    if (value === undefined) continue;
    ctx.mods.push({ bucket: rule.bucket, value, source: `젬 ${rule.name}(개별 합산 근사)` });
    warn(`젬 ${rule.name} 합산 효과 없음 — 활성 젬 툴팁의 합으로 근사합니다`);
  }
  return names;
}

// ---------- 각인 / 보석 ----------
function parseEngravings(raw: RawArmory, ctx: PassiveCtx, params: Partial<SimParams>, warn: (m: string) => void): string[] {
  const names: string[] = [];
  for (const e of raw.engravings?.ArkPassiveEffects ?? []) {
    const d = strip(e.Description);
    const src = `${e.Name}(${e.Grade}${e.Level})`;
    names.push(src);
    const n = (re: RegExp) => num(d, re);
    let v: number | null;
    switch (e.Name) {
      case '원한': case '저주받은 인형': case '질량 증가': case '아드레날린': {
        const effect = d.match(e.Name === '원한'
          ? /^보스 및 레이드 몬스터에게 주는 피해가 ([\d.]+)% 증가하지만, 받는 피해가 ([\d.]+)% 증가한다\.$/
          : e.Name === '저주받은 인형'
            ? /^적에게 주는 피해가 ([\d.]+)% 증가하지만, 받는 모든 회복 효과가 ([\d.]+)% 감소한다\.$/
            : e.Name === '질량 증가'
              ? /^공격속도가 ([\d.]+)% 감소하지만, 적에게 주는 피해가 ([\d.]+)% 증가한다\.$/
              : /^이동기 및 기본공격을 제외한 스킬 사용 후 ([\d.]+)초 동안 공격력이 ([\d.]+)% 증가하며 \(최대 (\d+)중첩\) 해당 효과가 최대 중첩 도달 시 치명타 적중률이 추가로 ([\d.]+)% 증가한다\. 해당 효과는 스킬 취소에 따른 재사용 대기시간 감소가 적용되는 경우, 스킬 종료 후 적용된다\.$/);
        if (!effect || !effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100) ||
            (e.Name === '아드레날린' && (Number(effect[1]) <= 0 || Number(effect[3]) <= 0))) {
          warn(`각인 해석 못함: ${src}: ${d}`); break;
        }
        if (e.Name === '아드레날린') {
          const stacks = Number(effect[3]);
          ctx.mods.push({ bucket: 'atk', value: Number(effect[2]) / 100 * stacks, source: `${src}(${stacks}중첩 상시)` },
            { bucket: 'critRate', value: Number(effect[4]) / 100, source: src });
        } else {
          ctx.mods.push({ bucket: 'dmgToEnemy', value: Number(effect[e.Name === '질량 증가' ? 2 : 1]) / 100, source: src });
          if (e.Name === '질량 증가') ctx.mods.push({ bucket: 'atkSpeed', value: -Number(effect[1]) / 100, source: src });
        }
        break;
      }
      case '돌격대장':
        if ((v = n(/^이동속도 증가량의 ([\d.]+)% 만큼 적에게 주는 피해량이 증가한다\.$/)) !== null && Number.isFinite(v) && v <= 100) params.raidCaptainRatio = v / 100;
        else warn(`각인 해석 못함: ${src}: ${d}`);
        break;
      case '마나 효율 증가': {
        const effect = d.match(/^마나 회복 속도가 ([\d.]+)% 증가하며, 마나를 사용하는 스킬이 적에게 주는 피해가 ([\d.]+)% 증가한다\.$/);
        if (effect && effect.slice(1).every(v => Number.isFinite(Number(v)) && Number(v) <= 100))
          ctx.mods.push({ bucket: 'skillDmg', value: Number(effect[2]) / 100, filter: { usesMana: true }, source: src });
        else warn(`각인 해석 못함: ${src}: ${d}`);
        break;
      }
      case '타격의 대가': {
        const effect = d.match(/^공격 타입이 백 어택 및 헤드 어택에 해당되지 않는 공격의 피해가 ([\d.]+)% 증가한다\. 각성기는 해당 효과가 적용되지 않는다\.$/);
        if (effect && Number.isFinite(Number(effect[1])) && Number(effect[1]) <= 100) {
          const ids = raw.combatSkills.flatMap(s => {
            const id = BY_NAME.get(s.Name)?.id, lines = tooltipLines(s.Tooltip);
            return id && s.SkillType < 100 && lines.some(l => /^\[(?:일반|스택트|루인) 스킬\]$/.test(l)) &&
              !lines.some(l => /공격 타입/.test(l)) ? [id] : [];
          });
          ids.push('card_emperor', 'card_empress_knight');
          const value = Number(effect[1]) / 100;
          ctx.mods.push({ bucket: 'skillDmg', value, filter: { ids, excludeKinds: ['awakening'], component: 'direct' }, source: src },
            { bucket: 'skillDmg', value, filter: { kinds: ['ruin'], excludeKinds: ['awakening'], component: 'stack' }, source: src });
        } else warn(`각인 해석 못함: ${src}: ${d}`);
        break;
      }
      case '예리한 둔기': {
        const effect = d.match(/^치명타 피해량이 ([\d.]+)% 증가하지만, 공격 시 일정 확률로 ([\d.]+)% 감소된 피해를 준다\.$/);
        if (effect && Number.isFinite(Number(effect[1])) && Number(effect[1]) <= 100 && Number(effect[2]) === 20)
          ctx.mods.push({ bucket: 'critDmg', value: Number(effect[1]) / 100, source: src },
            { bucket: 'dmgToEnemy', value: -0.02, source: `${src}(패널티 기대값)` });
        else warn(`각인 해석 못함: ${src}: ${d}`);
        break;
      }
      default: warn(`각인 미모델: ${src}: ${d}`);
    }
  }
  return names;
}

function parseGems(raw: RawArmory, ctx: PassiveCtx, warn: (m: string) => void): number {
  const skills = raw.gems?.Effects?.Skills ?? [];
  let count = 0;
  for (const g of skills) {
    const id = g.Name === '황제' ? 'card_emperor' : BY_NAME.get(g.Name)?.id;
    if (!id) { warn(`보석 대상 미지원: ${g.Name}`); continue; }
    if (!g.Description?.length) warn(`보석 설명 없음: ${g.Name}`);
    for (const line of (g.Description ?? []).map(strip)) {
      let v: number | null;
      if ((v = num(line, /^피해 ([\d.]+)% 증가$/)) !== null && Number.isFinite(v) && v <= 100) { ctx.mods.push({ bucket: 'skillDmg', value: pct(String(v)), filter: { ids: [id] }, ...(id === 'evoke' ? { dotScope: 'exclude' as const } : {}), source: `보석 ${g.Name}` }); count++; }
      else if ((v = num(line, /^재사용 대기시간 ([\d.]+)% 감소$/)) !== null && Number.isFinite(v) && v < 100 && id !== 'card_emperor') { ctx.mods.push({ bucket: 'cooldown', value: pct(String(v)), filter: { ids: [id] }, source: `보석 ${g.Name}` }); count++; }
      else warn(`보석 해석 못함: ${g.Name}: ${line}`);
    }
  }
  if (!raw.gems?.Effects) warn('보석 정보 없음(gems null) — 보석 효과 미반영');
  return count;
}

// ---------- 프로필 특성 / 장비 공격력 ----------
function parseProfileStats(raw: RawArmory, stats: Build['stats'], warn: (m: string) => void): ReturnType<typeof statMods> {
  const result = statMods(stats);
  let usedTooltip = false;
  const read = (type: string, label: string, pattern: RegExp, fallback: number, limit = Infinity, exclusive = false): number => {
    const lines = raw.profiles.Stats.find(s => s.Type === type)?.Tooltip ?? [];
    const matches = lines.map(line => strip(line).match(pattern)).filter(m => m !== null);
    const value = matches.length === 1 ? Number(matches[0]![1]) : NaN;
    if (Number.isFinite(value) && value >= 0 && (exclusive ? value < limit : value <= limit)) {
      usedTooltip = true;
      return value / 100;
    }
    warn(`전투 특성 툴팁 미확인: ${type} ${label} — 카탈로그 근사 계수 사용`);
    return fallback;
  };
  for (const mod of result.mods) {
    if (mod.source === '치명') mod.value = read('치명', '치명타 적중률', /^치명타 적중률이 (\d+(?:\.\d+)?)% 증가합니다\.$/, mod.value, 100);
    else if (mod.source === '신속' && mod.bucket === 'atkSpeed') mod.value = read('신속', '공격 속도', /^공격 속도가 (\d+(?:\.\d+)?)% 증가합니다\.$/, mod.value);
    else if (mod.source === '신속' && mod.bucket === 'moveSpeed') mod.value = read('신속', '이동 속도', /^이동 속도가 (\d+(?:\.\d+)?)% 증가합니다\.$/, mod.value);
    else if (mod.source === '신속' && mod.bucket === 'cooldown') mod.value = read('신속', '쿨타임', /^스킬 재사용 대기시간이 (\d+(?:\.\d+)?)% 감소합니다\.$/, mod.value, 100, true);
    else if (mod.source === '특화(루인)') mod.value = read('특화', '루인 피해', /^루인 스킬 피해량이 (\d+(?:\.\d+)?)% 증가합니다\.$/, mod.value);
    else if (mod.source === '특화(각성)') mod.value = read('특화', '각성 피해', /^각성 스킬의 피해량이 (\d+(?:\.\d+)?)% 증가합니다\.$/, mod.value);
  }
  result.gaugeBonus = read('특화', '카드 게이지', /^카드 게이지 획득량이 (\d+(?:\.\d+)?)% 증가합니다\.$/, result.gaugeBonus);
  if (usedTooltip) warn('전투 특성은 API 툴팁의 표시 정밀도로 적용하며 숨은 소수부는 미확인입니다');
  return result;
}

function parseEquipmentAttack(raw: RawArmory, mods: Modifier[], warn: (m: string) => void): void {
  if (!raw.equipment?.length) { warn('장비 정보 없음 — 장신구 공격력·무기 추가 피해·장신구 피해/치명 옵션 미반영'); return; }
  for (const item of raw.equipment) {
    if (!['목걸이', '귀걸이', '반지', '팔찌'].includes(item.Type)) continue;
    const title = item.Type === '팔찌' ? '팔찌 효과' : '연마 효과';
    let sections: { type?: string; value?: { Element_000?: string; Element_001?: string } }[];
    try { sections = Object.values(JSON.parse(item.Tooltip ?? '')); }
    catch { warn(`장신구 공격력 자료 없음: ${item.Type} / ${title}`); continue; }
    const section = sections.find(s => s?.type === 'ItemPartBox' && strip(s.value?.Element_000) === title);
    if (typeof section?.value?.Element_001 !== 'string') {
      warn(`장신구 공격력 자료 없음: ${item.Type} / ${title}`); continue;
    }
    // 옵션 시작 아이콘으로 분리하여 같은 옵션의 다음 줄 조건을 보존합니다.
    for (const html of section.value.Element_001.split(/<img\b[^>]*>/i)) {
      const line = strip(html.replace(/<br\s*\/?\s*>/gi, ' '));
      if (/^(무기|기본|아군)\s/.test(line)) continue;
      const m = line.match(/^공격력\s*\+\s*(\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)(%)?$/);
      const value = m ? Number(m[1]!.replaceAll(',', '')) : NaN;
      if (m && Number.isFinite(value) && (!m[2] || value <= 100)) {
        mods.push({ bucket: m[2] ? 'atk' : 'atkFlat', value: m[2] ? value / 100 : value, source: `장신구 ${item.Type}` });
      } else if (line.includes('공격력')) {
        warn(`장신구 공격력 해석 못함 — 미반영: ${item.Type} / ${line}`);
      }
    }
  }
}

function parseEquipmentDamage(raw: RawArmory, mods: Modifier[], warn: (m: string) => void): void {
  if (raw.equipment?.some(item => item.Type === '팔찌'))
    warn('팔찌 피해·치명·조건부 효과 미모델 — 전투 특성·공격력 변환과 별개입니다');
  const buckets = { '추가 피해': 'addDmg', '적에게 주는 피해': 'dmgToEnemy', '치명타 적중률': 'critRate', '치명타 피해': 'critDmg' } as const;
  for (const item of raw.equipment ?? []) {
    if (!['무기', '목걸이', '반지'].includes(item.Type)) continue;
    const title = item.Type === '무기' ? '추가 효과' : '연마 효과';
    const allowed = item.Type === '무기' ? ['추가 피해'] : item.Type === '목걸이'
      ? ['추가 피해', '적에게 주는 피해'] : ['치명타 적중률', '치명타 피해'];
    let sections: { type?: string; value?: { Element_000?: string; Element_001?: string } }[];
    try { sections = Object.values(JSON.parse(item.Tooltip ?? '')); }
    catch { warn(`장비 피해 옵션 자료 없음: ${item.Type} / ${title}`); continue; }
    const section = sections.find(s => s?.type === 'ItemPartBox' && strip(s.value?.Element_000) === title);
    if (typeof section?.value?.Element_001 !== 'string') {
      warn(`장비 피해 옵션 자료 없음: ${item.Type} / ${title}`); continue;
    }
    // 같은 옵션의 다음 줄 조건을 버리지 않습니다. 옵션 시작은 공식 아이콘으로 구분합니다.
    for (const html of section.value.Element_001.split(/<img\b[^>]*>/i)) {
      const line = strip(html.replace(/<br\s*\/?\s*>/gi, ' '));
      const m = line.match(/^(추가 피해|적에게 주는 피해|치명타 적중률|치명타 피해)\s*\+\s*(\d+(?:\.\d+)?)%$/);
      if (m && allowed.includes(m[1]!) && Number(m[2]) <= 100) {
        mods.push({ bucket: buckets[m[1] as keyof typeof buckets], value: Number(m[2]) / 100, source: `장비 ${item.Type} ${title}` });
      } else if (/(추가 피해|적에게 주는 피해|치명타)/.test(line)) {
        warn(`장비 피해 옵션 해석 못함 — 미반영: ${item.Type} / ${line}`);
      }
    }
  }
}

function reconstructAttack(raw: RawArmory, mods: Modifier[], warn: (m: string) => void): Build['attackPower'] {
  const stat = raw.profiles.Stats.find(s => s.Type === '공격력');
  const text = (stat?.Tooltip ?? []).map(strip).join(' ');
  const base = num(text.replaceAll(',', ''), /기본 공격력은 (\d+)/);
  const displayed = Number(stat?.Value.replaceAll(',', ''));
  if (base === null || !Number.isFinite(base) || base <= 0 || !Number.isFinite(displayed) || displayed <= 0) {
    warn('기본 공격력 툴팁 미확인 — 공격력 입력값 1을 유지합니다');
    return undefined;
  }
  const delta = text.replaceAll(',', '').match(/공격력이 (\d+) (증가|감소)/);
  const increase = delta && Number.isFinite(Number(delta[1])) ? Number(delta[1]) * (delta[2] === '감소' ? -1 : 1) : undefined;
  const sum = (bucket: 'atk' | 'atkFlat') => mods.filter(m => m.bucket === bucket && !m.filter).reduce((s, m) => s + m.value, 0);
  const flat = sum('atkFlat'), percent = sum('atk');
  const reconstructed = (base + flat) * (1 + percent);
  // 표시 정수에 숨은 소수부를 각각 [0, 1)로 가정한 구간 겹침만 검사합니다. 실측 검증은 아닙니다.
  const matched = increase !== undefined && base + increase === displayed &&
    reconstructed < displayed + 1 && reconstructed + (1 + percent) > displayed;
  if (!matched) warn(`공격력 재구성 불일치: API ${displayed}, 계산 ${reconstructed.toFixed(4)} — 누락 효과·프로필 상태를 확인해야 합니다`);
  return { base, displayed, increase, flat, percent, reconstructed, difference: reconstructed - displayed, status: matched ? 'matched-display' : 'mismatch' };
}

// ---------- 메인 ----------
export function buildFromArmory(raw: RawArmory): ConvertResult {
  if (raw.profiles.CharacterClassName !== '아르카나') {
    throw new Error(`아르카나 캐릭터만 지원합니다 (조회 직업: ${raw.profiles.CharacterClassName || '정보 없음'})`);
  }
  const warnings: string[] = [];
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m); };
  if (raw.arkpassive === null) warn('아크패시브 정보 없음 — 효과 미반영·황후 기본 분류 사용(T 스킬·운용 확인 필요)');
  if (raw.arkgrid === null) warn('아크그리드 정보 없음 — 코어·젬 효과 미반영');
  if (raw.engravings === null) warn('각인 정보 없음 — 각인 효과 미반영');
  if (!raw.cards) warn('장착 카드 정보 없음 — 카드 세트 효과 미반영');
  else for (const effect of raw.cards.Effects) {
    if (effect.Items.length) warn('장착 카드 세트 효과 미모델: ' + effect.Items
      .map(item => `${strip(item.Name)}: ${strip(item.Description)}`).join(' / '));
  }

  const statOf = (t: string) => {
    const text = raw.profiles.Stats.find(s => s.Type === t)?.Value ?? '0';
    const value = Number(text.replace(/,/g, ''));
    if (!text.trim() || !Number.isFinite(value) || value < 0) throw new Error(`전투 특성 값이 올바르지 않습니다: ${t}`);
    return value;
  };
  const stats = { crit: statOf('치명'), spec: statOf('특화'), swift: statOf('신속') };
  const emperorActive = (raw.arkpassive?.Effects ?? []).some(e =>
    e.Name === '깨달음' && /^깨달음 1티어 황제의 칙령 Lv\.[1-3]$/.test(strip(e.Description)));
  const variant: Build['variant'] = emperorActive ? 'emperor' : 'empress';

  const st = parseProfileStats(raw, stats, warn);
  const ctx: PassiveCtx = { mods: [...st.mods], onSkillCast: [], onCardUse: [], onRuinAt4: [], cardDuration: {}, deckAdd: [], deckRemove: [], gaugeBonus: st.gaugeBonus, normalGaugePenalty: 0, skillPatches: new Map() };
  const params: Partial<SimParams> = {};
  const destiny = { draw: false };

  parseArkPassive(raw, ctx, warn);
  const cores = parseArkGrid(raw, ctx, params, destiny, warn);
  parseEquipmentAttack(raw, ctx.mods, warn);
  parseEquipmentDamage(raw, ctx.mods, warn);
  const attackPower = reconstructAttack(raw, ctx.mods, warn);
  const engr = parseEngravings(raw, ctx, params, warn);
  const gemCount = parseGems(raw, ctx, warn);
  const skills = convertSkills(raw, variant, warn);
  if (ctx.hyperCastSpeed !== undefined) {
    for (const skill of skills) if (skill.kind === 'hyper_awakening') skill.castTime /= 1 + ctx.hyperCastSpeed;
  }
  for (const skill of skills) if (ctx.onSkillCast.length) (skill.onCast ??= []).push(...ctx.onSkillCast);
  if (ctx.hiddenHandChance !== undefined) {
    const sun = skills.find(s => s.id === 'the_sun');
    if (sun) sun.hiddenHandChance = ctx.hiddenHandChance;
    else warn('숨겨진 패: 더 썬 미장착 — 카드 획득 미반영');
  }

  // 코어에서 온 스킬별 패치 적용
  if (ctx.flowerCooldownDelta !== undefined) {
    const flower = skills.find(s => s.id === 'dancing_of_spineflower');
    if (flower?.tags?.includes('flower_fake_flip')) flower.cooldown += ctx.flowerCooldownDelta;
    else warn('셔플 댄스 10P: 페이크 플립 미장착 또는 해석 실패 — 쿨타임 증가 미반영');
  }
  if (ctx.flowerThornBonus !== undefined) {
    const flower = skills.find(s => s.id === 'dancing_of_spineflower');
    const damage = flower?.flowerFakeFlip?.baseFraction === 0.4 && ctx.flowerThornChance !== undefined
      ? resolveFlowerReturnDamage(flower.level ?? 0, flower.flowerFakeFlip.damagePerStack, ctx.flowerThornBonus) : undefined;
    if (flower && damage) Object.assign(flower, damage, { flowerThornChance: ctx.flowerThornChance });
    else warn(`셔플 댄스 10P: 빠른 복귀 14P·페이크 플립·지원 계수 조건 미충족 — 가시 전용 +${ctx.flowerThornBonus * 100}% 피해 미반영`);
  }
  if (ctx.darknessEdgeCritDmg) {
    const stream = skills.find(s => s.id === 'stream_of_edge');
    const darkness = stream?.onHit?.find(e => e.id === 'darkness_edge');
    if (darkness) stream!.onHit!.push({ ...darkness, id: 'darkness_edge_core', mod: ctx.darknessEdgeCritDmg });
    else warn(`${ctx.darknessEdgeCritDmg.source}: 다크니스 엣지 미장착 또는 해석 실패 — 중첩 치피 미반영`);
  }
  for (const [id, mods] of ctx.skillPatches) {
    const s = skills.find((x) => x.id === id);
    if (!s) { warn(`코어 효과 대상 스킬 미장착: ${id}`); continue; }
    for (const m of mods) {
      if (m.source === '__destiny__') s.tags = [...(s.tags ?? []), 'destiny'];
      else if (m.source === '__charges2__') s.maxCharges = 2;
      else if (m.source.startsWith('__onCast__')) (s.onCast ??= []).push(JSON.parse(m.source.slice('__onCast__'.length)) as TimedEffect);
      else if (m.source.startsWith('__cdDelta__')) s.cooldown = Math.max(1, s.cooldown + Number(m.source.slice('__cdDelta__'.length)));
      else if (m.source.startsWith('__castSpeed__')) s.castTime /= 1 + Number(m.source.slice('__castSpeed__'.length));
      else (s.mods ??= []).push(m);
    }
  }

  const build: Build = {
    name: `${raw.profiles.CharacterName} (${raw.profiles.ItemAvgLevel}, ${variant === 'empress' ? '황후' : '황제'})`,
    combatLevel: raw.profiles.CharacterLevel,
    attackPower,
    variant,
    stats,
    passiveMods: ctx.mods,
    bluntThorn: ctx.bluntThorn,
    cardDurationBonus: ctx.cardDuration,
    deckOverrides: ctx.deckAdd.length || ctx.deckRemove.length ? { add: ctx.deckAdd, ...(ctx.deckRemove.length ? { remove: ctx.deckRemove } : {}) } : undefined,
    skills,
    rotation: defaultRotation(variant, skills),
    onCardUse: ctx.onCardUse,
    anotherEmperorChance: ctx.anotherEmperorChance,
    infinityDeck: ctx.infinityDeck,
    ruinFullset: ctx.ruinFullset,
    chainDraw: ctx.chainDraw,
    stackHold: ctx.stackHold,
    emperorHeartChance: ctx.emperorHeartChance,
    normalEnhanceCooldown: ctx.normalEnhanceCooldown,
    onDestiny: [...(destiny.draw ? ['drawCard' as const] : []), ...(ctx.normalEnhanceBuff ? [ctx.normalEnhanceBuff] : []), ...(ctx.impactMateBuff ? [ctx.impactMateBuff] : []), ...(ctx.highTempoBuffs ?? [])],
    onRuinAt4: ctx.onRuinAt4,
    params: {
      stackEffectCoefPerStack: 600, // [PLACEHOLDER] Lv70 후보 적용 대상 밖에서만 사용합니다.
      gaugePerHit: { normal: 0.04, stack: 0.03, ruin: 0.03, hyper_awakening: 0.05, awakening: 0 }, // [PLACEHOLDER]
      gaugeGainBonus: ctx.gaugeBonus,
      normalGaugePenalty: ctx.normalGaugePenalty,
      atkBase: attackPower?.base ?? 1,
      raidCaptainRatio: params.raidCaptainRatio ?? 0,
      twistedFateZeroChance: params.twistedFateZeroChance ?? 0.25,
      fatalHandCull: params.fatalHandCull ?? false,
      corrosionValue: params.corrosionValue ?? 0.1,
      cardDamageCoef: {},
      stackEffectScale: [0, 1, 2, 3, 4],
    },
  };
  damageWarnings(build).forEach(warn);
  cardSupplyWarnings(build).forEach(warn);

  const summary = [
    `${build.name}  치명 ${stats.crit} / 특화 ${stats.spec} / 신속 ${stats.swift}`,
    attackPower ? `공격력: 기본 ${attackPower.base} / 상시 재구성 ${attackPower.reconstructed.toFixed(4)} / API 표시 ${attackPower.displayed} (${attackPower.status === 'matched-display' ? '표시 오차 범위 일치' : '불일치'})` : '공격력: 기본값 미확인, 입력 1 사용',
    `스킬: ${skills.map((s) => `${s.name} Lv${s.level}[${s.kind === 'stack' ? `S${s.stacksGranted}` : s.kind === 'ruin' ? 'R' : s.kind === 'hyper_awakening' ? 'H' : 'N'}]`).join(', ')}`,
    `코어: ${cores.join(' | ')}`,
    `각인: ${engr.join(', ')}   보석 효과 ${gemCount}개`,
    `상시 수정치 ${ctx.mods.length}개, 운명 드로우 ${destiny.draw ? 'O' : 'X'}, 뭉가 ${ctx.bluntThorn ? 'O' : 'X'}`,
  ];
  return { build, warnings, summary };
}

