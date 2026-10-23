import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareResults, parseResultInput } from './resultComparison';
import { summarize } from './engine/stats';

const original = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-ui-result-export-downloaded.json', 'utf8'));
const read = (value: typeof original) => parseResultInput(JSON.stringify(value), '결과.json')!;

describe('saved model result comparison', () => {
  it('blocks different known models and keeps missing identity explicit without retrofitting old files', () => {
    const legacy = read(original), first = read({ ...original, modelId: 'sha256:' + 'a'.repeat(64) });
    const second = read({ ...original, modelId: 'sha256:' + 'b'.repeat(64) });
    expect(compareResults(first, second)).toMatchObject({ modelStatus: 'different', metrics: null });
    expect(compareResults(first, first).modelStatus).toBe('same');
    expect(compareResults(first, first).metrics).not.toBeNull();
    expect(compareResults(legacy, first).modelStatus).toBe('unknown');
    expect(compareResults(legacy, first).boundary).toContain('엔진 버전 정보가 없어');
    expect(legacy.modelId).toBeUndefined();
  });

  it.each([null, '', 'current', 'sha256:12', 1])('rejects malformed model identity %j', modelId => {
    expect(() => read({ ...original, modelId })).toThrow('저장 결과 형식');
  });

  it('compares the real saved result to itself without mutation and preserves every warning', () => {
    const input = read(original), saved = JSON.stringify(input);
    const compared = compareResults(input, input);
    expect(compared.differences).toEqual([]);
    expect(compared.blockers).toEqual([]);
    expect(compared.metrics!.every(row => row.delta === 0)).toBe(true);
    expect(compared.before).toEqual(input);
    expect(compared.after).toEqual(input);
    expect(compared.boundary).toContain('엔진 버전');
    expect(JSON.stringify(input)).toBe(saved);
  });

  it('compares all skills by ID across reordering, additions and removals', () => {
    const changed = structuredClone(original);
    const renamed = changed.result.breakdown[0];
    const oldId = renamed.id;
    renamed.id = 'added'; renamed.name = '추가 <script>';
    changed.result.breakdown.reverse();
    changed.build.stats.crit += 1;
    const compared = compareResults(read(original), read(changed));
    expect(compared.differences.map(change => change.path)).toEqual(['/stats/crit']);
    const added = compared.metrics!.find(row => row.path === '/breakdown/added/direct')!;
    expect(added).toMatchObject({ before: 0, after: renamed.direct, delta: renamed.direct, relativeChange: null });
    expect(compared.metrics!.find(row => row.path === `/breakdown/${oldId}/direct`)!.after).toBe(0);
    expect(compared.metrics!.filter(row => !row.path.includes(oldId) && !row.path.includes('/added/')).every(row => row.delta === 0)).toBe(true);
  });

  it.each(['durationSec', 'iterations', 'seed'] as const)('blocks numeric comparison for mismatched %s', key => {
    const before = read(original), after = read(original);
    after.config[key] += 1;
    const compared = compareResults(before, after);
    expect(compared.blockers.join(' ')).toContain(key);
    expect(compared.metrics).toBeNull();
    expect(compared.before.warnings).toEqual(original.warnings);
  });

  it('distinguishes an input-only file from a malformed result file', () => {
    expect(parseResultInput(JSON.stringify({ build: original.build, warnings: [] }), '입력.json')).toBeNull();
    expect(() => read({ ...original, result: null })).toThrow('저장 결과 형식을 확인하세요: 결과.json');
    expect(() => read({ ...original, config: undefined })).toThrow('저장 결과 형식을 확인하세요: 결과.json');
  });

  it.each([
    ['sample count', (x: typeof original) => x.result.samples.pop()],
    ['summary', (x: typeof original) => x.result.dps.mean++],
    ['name', (x: typeof original) => x.result.build = '다른 입력'],
    ['duration', (x: typeof original) => x.result.durationSec++],
    ['warnings', (x: typeof original) => x.result.damageWarnings = null],
    ['input warnings', (x: typeof original) => x.result.inputWarnings = []],
    ['duplicate skill', (x: typeof original) => x.result.breakdown.push(x.result.breakdown[0])],
    ['damage sum', (x: typeof original) => x.result.breakdown[0].direct++],
    ['card source', (x: typeof original) => x.result.cardsPerMinBySource.gauge++],
    ['card balance', (x: typeof original) => x.result.cardsUsedPerMin++],
    ['negative', (x: typeof original) => x.result.breakdown[0].casts = -1],
    ['null', (x: typeof original) => x.result.ruinAt4Rate = null],
  ])('rejects inconsistent %s', (_name, edit) => {
    const changed = structuredClone(original); edit(changed);
    expect(() => read(changed)).toThrow('저장 결과 형식을 확인하세요: 결과.json');
  });

  it('accepts zero damage and reports undefined relative change without losing the absolute difference', () => {
    const zero = structuredClone(original);
    zero.result.samples.fill(0); zero.result.dps = summarize(zero.result.samples);
    for (const skill of zero.result.breakdown) { skill.direct = 0; skill.stackEffect = 0; if (skill.dot !== undefined) skill.dot = 0; }
    const compared = compareResults(read(zero), read(original));
    expect(compared.metrics!.find(row => row.path === '/dps/mean')).toMatchObject({ before: 0, delta: original.result.dps.mean, relativeChange: null });
  });

  it('blocks a one-sample result and rejects overflowing or unsafe numeric input', () => {
    const input = read(original);
    input.config.iterations = 1;
    expect(compareResults(input, input).metrics).toBeNull();
    const changed = structuredClone(original);
    changed.config.seed = Number.MAX_SAFE_INTEGER + 1;
    expect(() => read(changed)).toThrow('저장 결과 형식');
    changed.config.seed = 'overflow';
    expect(() => parseResultInput(JSON.stringify(changed).replace('"overflow"', '1e999'), '범위.json')).toThrow('JSON 숫자가 지원 범위');
  });
});
