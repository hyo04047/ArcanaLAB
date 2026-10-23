import { expect, it } from 'vitest';
import { cardsFor, empressInkomsu440, simulate } from './engine';
import { compareResults, parseResultInput } from './resultComparison';

const build = empressInkomsu440(), cards = cardsFor(build.variant);
const config = { durationSec: 1, iterations: 2, seed: 1 };
const legacy = { build, config, result: simulate(build, cards, config) };
const pairedConfig = { ...config, randomMode: 'partitioned-v1' as const };
const paired = { build, config: pairedConfig, result: simulate(build, cards, pairedConfig) };
const read = (input: unknown) => parseResultInput(JSON.stringify(input), '난수 결과.json')!;

it('round trips the selected random mode and blocks a mixed-mode comparison', () => {
  const restored = read(paired);
  expect(restored.config.randomMode).toBe('partitioned-v1');
  expect(restored.result).toEqual(paired.result);
  expect(compareResults(restored, read(legacy)).metrics).toBeNull();
  expect(compareResults(restored, read(legacy)).blockers.join(' ')).toContain('난수 방식');
  expect(compareResults(restored, restored).metrics!.every(metric => metric.delta === 0)).toBe(true);
});
it('treats an absent mode and explicit legacy as the same historical mode', () => {
  expect(compareResults(read(legacy), read({ ...legacy, config: { ...config, randomMode: 'legacy' } })).blockers).toEqual([]);
});
it.each(['unknown', null, 0])('rejects an invalid saved mode %j', randomMode => {
  expect(() => read({ ...legacy, config: { ...config, randomMode } })).toThrow('저장 결과 형식');
});
it('rejects a result whose declared mode does not match its config', () => {
  expect(() => read({ ...paired, config })).toThrow('저장 결과 형식');
  expect(() => read({ ...legacy, config: pairedConfig })).toThrow('저장 결과 형식');
});
