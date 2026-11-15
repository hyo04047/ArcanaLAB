import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { damageWarnings } from '../skilldata';

function warnings(reference: unknown, json = false) {
  const build = empressInkomsu440(); build.passiveMods = []; build.onDestiny = [];
  build.skills = [{ id: 'control', name: '출처 통제', kind: 'normal', level: 10, cooldown: 10, castTime: 0.5, hits: 1, directCoef: 1 }];
  Object.assign(build.skills[0]!, { damageReference: reference });
  return damageWarnings(json ? JSON.parse(JSON.stringify(build)) : build);
}
const unknownReferences = [undefined, null, false, 0, true, 1, 'codex-tooltip', [], {}, { source: undefined },
  { source: null }, { source: false }, { source: 0 }, { source: '' }, { source: 'future-source' }, { source: ['codex-tooltip'] }];

describe.each([false, true])('damage source registration warning after JSON roundtrip: %s', json => {
  it.each(unknownReferences.map(reference => ({ reference })))('marks unregistered reference $reference', ({ reference }) => {
    const result = warnings(reference, json);
    expect(result).toContain('출처 통제: 직접 피해 입력값의 출처 미등록');
    expect(result.filter(warning => warning === '출처 통제: 직접 피해 입력값의 출처 미등록')).toHaveLength(1);
    expect(result.some(warning => warning.startsWith('피해 기준 미검증:'))).toBe(true);
  });
});

it.each([
  { reference: { source: 'codex-tooltip', level: 10 }, expected: [] },
  { reference: { source: 'wiki-tooltip' }, expected: ['출처 통제: 위키 툴팁 임시값 — 기준 스펙·패치 시점 미확인'] },
  { reference: { source: 'missing' }, expected: ['출처 통제: 직접 피해 자료 없음 — 0 자리값 사용(실제 무피해 아님)'] },
  { reference: { source: 'public-coefficient-candidate', level: 10, url: 'about:blank', effectIds: [1] },
    expected: ['출처 통제 Lv10: 고정 피해·공격력 계수는 공개 자료 후보입니다. 현재 패치·인게임 실측 및 특화·트포 적용 범위는 미검증입니다.'] },
])('preserves registered source $reference.source', ({ reference, expected }) => {
  const result = warnings(reference, true);
  expect(result.filter(warning => warning.startsWith('출처 통제'))).toEqual(expected);
  expect(result.some(warning => warning.startsWith('피해 기준 미검증:'))).toBe(true);
});

it('preserves the codex level fallback warning', () => {
  const result = warnings({ source: 'codex-tooltip', level: 14 });
  expect(result.filter(warning => warning.startsWith('출처 통제'))).toEqual(['출처 통제 Lv10: 해당 레벨 피해 미확인 — Lv14 대체값 사용']);
});
