// 변형(황후/황제)별 기본 로테이션 템플릿. 장착 스킬에 맞춰 필터링한다. (docs/mechanics.md §4.4)
import type { Build, SkillDef } from './types';

const EMPRESS_RUIN = ['the_devil', 'celestial_rain', 'secret_garden', 'four_of_a_kind', 'serendipity'];
const EMPRESS_RUIN_CULL = ['the_devil', 'serendipity', 'celestial_rain', 'secret_garden', 'four_of_a_kind'];
const STACKERS = ['stream_of_edge', 'spiral_edge', 'scratch_dealer', 'quadra_accelerate', 'back_flush', 'checkmate', 'dancing_of_spineflower'];
const EMPEROR_NORMALS = ['dark_resurrection', 'evoke', 'unlimited_shuffle', 'return', 'mysterious_stampede', 'call_of_destiny', 'dancing_of_spineflower', 'back_flush'];

export function defaultRotation(variant: Build['variant'], skills: SkillDef[]): Build['rotation'] {
  const ids = new Set(skills.map((s) => s.id));
  const has = (id: string) => ids.has(id);
  const kindOf = (id: string) => skills.find((s) => s.id === id)?.kind;
  if (variant === 'empress') {
    const finisher = has('call_of_destiny') && kindOf('call_of_destiny') === 'stack' ? 'call_of_destiny' : undefined;
    return {
      ruinPriority: EMPRESS_RUIN.filter(has),
      cullRuinPriority: EMPRESS_RUIN_CULL.filter(has),
      stackPriority: [...STACKERS, ...(finisher ? [] : ['call_of_destiny'])].filter((id) => has(id) && kindOf(id) === 'stack'),
      finisher,
      fishing: skills.filter((s) => s.id === 'four_of_a_kind' && s.cdResetChance).map((s) => s.id),
      wheelTargets: ['celestial_rain', 'the_devil', 'serendipity'].filter(has),
      fillers: skills.filter((s) => s.kind === 'normal').map((s) => s.id),
    };
  }
  // 황제: 선택한 리턴·스트림 버프를 준비한 뒤 일반기를 사용합니다. 완성된 사이클은 아닙니다.
  const setupSkill = skills.find(s => s.id === 'return' && s.onHit?.some(e =>
    e.id === 'arcana_crit_damage' || e.id === 'arcana_crit_resistance'))?.id;
  return {
    ruinPriority: EMPRESS_RUIN.filter(has),
    stackPriority: [...STACKERS, 'call_of_destiny'].filter((id) => has(id) && kindOf(id) === 'stack'),
    fillers: ['the_sun', ...EMPEROR_NORMALS].filter((id) => id !== setupSkill && has(id) && (id === 'the_sun' || kindOf(id) === 'normal')),
    setupSkill,
    critSetupSkill: skills.find(s => s.id === 'stream_of_edge' && s.kind === 'stack' && s.onHit?.some(e =>
      e.id === 'darkness_edge' && e.mod.bucket === 'critRate' && e.mod.value > 0))?.id,
    wheelTargets: ['dark_resurrection', 'the_sun'].filter(has),
  };
}
