import { afterEach, describe, expect, it, vi } from 'vitest';
import { empressInkomsu440, cardsFor } from '../presets';
import { SimState, simulate } from '../sim';

afterEach(() => vi.restoreAllMocks());
const build = empressInkomsu440(), cards = cardsFor('empress');
const config = { durationSec: 1, iterations: 1, seed: 0 };

describe('simulation configuration', () => {
  it.each([
    ...[0, -1, NaN, Infinity].map(value => ({ field: 'durationSec', value, message: '전투 시간' })),
    ...[0, -1, 0.5, NaN, Infinity].map(value => ({ field: 'iterations', value, message: '반복 수' })),
    ...[NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1].map(value => ({ field: 'seed', value, message: '시드' })),
  ])('rejects $field=$value before entering any run', ({ field, value, message }) => {
    // 무한 값도 실제 루프에 진입하지 않고 검사 실패를 재현합니다.
    const run = vi.spyOn(SimState.prototype, 'run').mockImplementation(() => { throw new Error('entered simulation'); });
    expect(() => simulate(build, cards, { ...config, [field]: value })).toThrow(message);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([0, -7, 42])('retains deterministic runs for integer seed %s', seed => {
    const cfg = { ...config, durationSec: 0.5, seed };
    const a = simulate(build, cards, cfg), b = simulate(build, cards, cfg);
    expect(a).toEqual(b);
    expect(a.samples).toHaveLength(1);
    expect(Number.isFinite(a.dps.mean)).toBe(true);
    expect(Number.isFinite(a.cardsPerMin)).toBe(true);
  });
});
