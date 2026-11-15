import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';

const scopes = ['legacy', 'partitioned-root', 'partitioned-child'] as const;
function rngFor(scope: typeof scopes[number]) {
  const rng = createRng(42, scope === 'legacy' ? 'legacy' : 'partitioned-v1');
  return scope === 'partitioned-child' ? rng.stream!('["quickDraw","control"]') : rng;
}
const invalid: unknown[] = [undefined, null, true, false, '0.5', 'bad', {}, [], NaN, Infinity, -Infinity, -0.1, 1.1];

describe('probability validity before consuming RNG', () => {
  it.each(scopes.flatMap(scope => invalid.map(value => ({ scope, value }))))('rejects $value in $scope without advancing', ({ scope, value }) => {
    const rng = rngFor(scope), control = rngFor(scope);
    expect(() => rng.chance(value as number)).toThrow('확률');
    expect(rng.next()).toBe(control.next());
  });
  it.each(scopes.flatMap(scope => [0, 0.2, 1].map(value => ({ scope, value }))))('preserves $value decisions and consumption in $scope', ({ scope, value }) => {
    const rng = rngFor(scope), control = rngFor(scope);
    for (let i = 0; i < 40; i++) expect(rng.chance(value)).toBe(control.next() < value);
    expect(rng.next()).toBe(control.next());
  });
});
