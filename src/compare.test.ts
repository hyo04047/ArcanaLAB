import { describe, expect, it } from 'vitest';
import { diffBuilds, parseBuildInput } from './compare';
import { empressInkomsu440 } from './engine/presets';

describe('whole Build structural comparison', () => {
  it('reads a complete export and distinguishes missing warnings from an empty list', () => {
    const build = empressInkomsu440();
    expect(parseBuildInput(JSON.stringify({ build, warnings: ['미확인 효과'] }), '선택.json').warnings).toEqual(['미확인 효과']);
    expect(parseBuildInput(JSON.stringify(build), '선택.json').warnings).toBeNull();
    expect(parseBuildInput(JSON.stringify({ build, warnings: [] }), '선택.json').warnings).toEqual([]);
  });

  it.each([null, [], { name: '불완전 입력' }])('rejects an incomplete comparison input: %j', input => {
    expect(() => parseBuildInput(JSON.stringify(input), '실패.json')).toThrow('Build 형식을 확인하세요: 실패.json');
  });

  it.each([null, '경고', ['경고', 1]])('rejects invalid stored warnings: %j', warnings => {
    expect(() => parseBuildInput(JSON.stringify({ build: empressInkomsu440(), warnings }), '실패.json'))
      .toThrow('입력 경고 형식을 확인하세요: 실패.json');
  });

  it('identifies the selected file when JSON cannot be parsed', () => {
    expect(() => parseBuildInput('{broken', '실패.json')).toThrow('JSON 형식을 확인하세요: 실패.json');
  });

  it.each(['1e999', '-1e999'])('rejects %s instead of turning it into null during comparison', numericText => {
    const build = empressInkomsu440();
    const text = JSON.stringify({ build: { ...build, params: { ...build.params, atkBase: 'overflow-token' } }, warnings: [] })
      .replace('"overflow-token"', numericText);
    expect(() => parseBuildInput(text, '범위.json')).toThrow('JSON 숫자가 지원 범위를 벗어났습니다: 범위.json');
  });

  it('preserves finite boundary values and zero in comparison inputs', () => {
    const build = empressInkomsu440();
    build.params.atkBase = Number.MAX_VALUE;
    build.stats.crit = 0;
    const parsed = parseBuildInput(JSON.stringify(build), '정상.json');
    expect(parsed.build.params.atkBase).toBe(Number.MAX_VALUE);
    expect(parsed.build.stats.crit).toBe(0);
    expect(diffBuilds(build, parsed.build)).toEqual([]);
  });

  it('compares saved JSON without treating object key order or optional undefined as changes', () => {
    const before = empressInkomsu440();
    const after = Object.fromEntries(Object.entries(before).reverse()) as typeof before;
    after.attackPower = undefined;
    expect(diffBuilds(before, after)).toEqual([]);
    expect(diffBuilds(before, JSON.parse(JSON.stringify(before)))).toEqual([]);
  });

  it('reports simultaneous stat, effect, skill, card and rotation edits without mutating either input', () => {
    const before = empressInkomsu440(), after = structuredClone(before);
    after.stats.crit += 100;
    after.params.gaugeGainBonus += 0.1;
    after.skills[0]!.directCoef += 1;
    after.passiveMods[0]!.value += 0.02;
    after.rotation.ruinPriority.reverse();
    after.cardDurationBonus = { moon: 2 };
    const saved = JSON.stringify([before, after]);
    const diff = diffBuilds(before, after);
    expect(diff.map(item => item.path)).toEqual(expect.arrayContaining([
      '/stats/crit', '/params/gaugeGainBonus', '/skills/0/directCoef', '/passiveMods/0/value',
      '/rotation/ruinPriority/0', '/cardDurationBonus/moon',
    ]));
    expect(JSON.stringify([before, after])).toBe(saved);
  });

  it('keeps array order and distinguishes additions, removals and empty containers', () => {
    const before = empressInkomsu440(), after = structuredClone(before);
    before.deckOverrides = { add: ['cull', 'moon'], remove: ['star'] };
    after.deckOverrides = { add: ['moon'], remove: [] };
    expect(diffBuilds(before, after)).toEqual([
      { path: '/deckOverrides/add/0', change: 'changed', before: 'cull', after: 'moon' },
      { path: '/deckOverrides/add/1', change: 'removed', before: 'moon' },
      { path: '/deckOverrides/remove/0', change: 'removed', before: 'star' },
    ]);
    before.deckOverrides = undefined; after.deckOverrides = {};
    expect(diffBuilds(before, after)).toEqual([{ path: '/deckOverrides', change: 'added', after: {} }]);
    expect(diffBuilds(after, before)).toEqual([{ path: '/deckOverrides', change: 'removed', before: {} }]);
  });

  it('escapes JSON Pointer keys and preserves zero values', () => {
    const before = empressInkomsu440(), after = structuredClone(before);
    after.params.cardDamageCoef['a/b~c'] = 0;
    expect(diffBuilds(before, after)).toEqual([{ path: '/params/cardDamageCoef/a~1b~0c', change: 'added', after: 0 }]);
  });

  it('reports metadata-only edits as input differences without inventing a damage result', () => {
    const before = empressInkomsu440(), after = structuredClone(before);
    after.name = '변경 이름'; after.stats.crit = before.stats.crit + 1;
    expect(diffBuilds(before, after)).toEqual([
      { path: '/name', change: 'changed', before: before.name, after: after.name },
      { path: '/stats/crit', change: 'changed', before: before.stats.crit, after: after.stats.crit },
    ]);
  });
});
