import type { RawArmory } from '../armory';

// 코어 단독 테스트용 활성 노드입니다. 수치 효과는 넣지 않아 코어 효과만 검사합니다.
export function coreTestPassives(emperor = false): NonNullable<RawArmory['arkpassive']> {
  return { Effects: [emperor ? '1티어 황제의 칙령' : '1티어 황후의 은총', emperor ? '4티어 또 다른 황제' : '4티어 황후의 속삭임']
    .map(node => ({ Name: '깨달음', Description: `깨달음 ${node} Lv.1` })) };
}
export function coreTestTooltip(options: string, emperor = false): string {
  return JSON.stringify({ options, label: '코어 옵션 발동 조건', condition: emperor
    ? '황제의 칙령 전용 아크 패시브 4티어 또 다른 황제 활성화 필요'
    : '황후의 은총 전용 아크 패시브 4티어 황후의 속삭임 활성화 필요' });
}
