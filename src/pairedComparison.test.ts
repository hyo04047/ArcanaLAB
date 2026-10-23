import { expect, it } from 'vitest';
import { cardsFor, empressInkomsu440, simulate } from './engine';
import { summarize } from './engine/stats';
import { compareResults, parseResultInput } from './resultComparison';

function saved(samples: number[]) {
  const build = empressInkomsu440();
  const config = { durationSec: 1, iterations: samples.length, seed: 1, randomMode: 'partitioned-v1' as const };
  const result = simulate(build, cardsFor(build.variant), config);
  result.samples = samples; result.dps = summarize(samples);
  result.breakdown = [{ id: 'fixture', name: '합성 표본', casts: 1, direct: result.dps.mean, stackEffect: 0 }];
  return parseResultInput(JSON.stringify({ build, config, result, modelId: 'sha256:' + 'a'.repeat(64) }), '합성 표본')!;
}
it('computes signed paired differences, sample spread, standard error and exact sign counts', () => {
  const before = saved([10, 20, 30, 40]), after = saved([12, 19, 30, 47]);
  const snapshot = JSON.stringify([before, after]);
  const result = compareResults(before, after);
  expect(result.pairedBlockers).toEqual([]);
  expect(result.paired!.samples).toEqual([2, -1, 0, 7]);
  expect(result.paired!.dps).toEqual(summarize([2, -1, 0, 7]));
  expect(result.paired!.standardError).toBeCloseTo(Math.sqrt(38 / 3) / 2, 12);
  expect(result.paired).toMatchObject({ positive: 2, equal: 1, negative: 1 });
  expect(JSON.stringify([before, after])).toBe(snapshot);
});
it('makes A/A exactly zero and reverses the direction for B/A', () => {
  const a = saved([10, 30, 20]), b = saved([12, 29, 21]);
  const same = compareResults(a, a).paired!;
  expect(same.standardError).toBe(0); expect(same.dps.mean).toBe(0); expect(same.equal).toBe(3);
  const forward = compareResults(a, b).paired!, backward = compareResults(b, a).paired!;
  expect(backward.samples).toEqual(forward.samples.map(value => -value));
  expect(backward.dps.mean).toBe(-forward.dps.mean);
  expect(backward.standardError).toBe(forward.standardError);
});
it('uses matched sample order instead of subtracting independently sorted quantiles', () => {
  const result = compareResults(saved([1, 9]), saved([9, 1])).paired!;
  expect(result.samples).toEqual([8, -8]);
  expect(result.dps.stdev).toBeGreaterThan(0);
  expect(result.standardError).toBe(8);
});
it.each(['variant', 'model', 'unknown model', 'mode', 'seed', 'duration', 'iterations', 'one sample'])
  ('withholds paired statistics for %s', condition => {
    const a = saved([10, 20]), b = saved([11, 21]);
    if (condition === 'variant') b.build.variant = 'emperor';
    if (condition === 'model') b.modelId = 'sha256:' + 'b'.repeat(64);
    if (condition === 'unknown model') delete b.modelId;
    if (condition === 'mode') { a.config.randomMode = 'legacy'; a.result.randomMode = 'legacy'; b.config.randomMode = 'legacy'; b.result.randomMode = 'legacy'; }
    if (condition === 'seed') b.config.seed++;
    if (condition === 'duration') b.config.durationSec++;
    if (condition === 'iterations') b.config.iterations++;
    if (condition === 'one sample') { a.config.iterations = 1; b.config.iterations = 1; }
    const result = compareResults(a, b);
    expect(result.paired).toBeNull(); expect(result.pairedBlockers.length).toBeGreaterThan(0);
    if (['variant', 'unknown model', 'mode'].includes(condition)) expect(result.metrics).not.toBeNull();
  });
