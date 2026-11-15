import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { empressInkomsu440 } from '../presets';
import { runOnce } from '../sim';

const invalid: unknown[] = [null, undefined, '1', true, {}, [], 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1];
const modes = ['legacy', 'partitioned-v1'] as const;
describe('safe integer seeds at direct RNG entry', () => {
  it.each(modes.flatMap(mode => invalid.flatMap(seed => [false, true].map(single => ({ mode, seed, single })) )))(
    'rejects $seed in $mode with single=$single', ({ mode, seed, single }) => {
      const build = empressInkomsu440(); build.skills = []; build.rotation = { ruinPriority: [], stackPriority: [], fillers: [] };
      expect(() => single ? runOnce(build, [], seed as number, 0.1, mode) : createRng(seed as number, mode)).toThrow('시드');
    });
  it.each(modes.flatMap(mode => [0, 1, -1, 42, 0x100000001, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0xffffffff].map(seed => ({ mode, seed })) ))(
    'preserves integer normalization for $seed in $mode', ({ mode, seed }) => {
      const actual = createRng(seed, mode), control = createRng(seed >>> 0, mode);
      for (let i = 0; i < 20; i++) expect(actual.next()).toBe(control.next());
      if (mode === 'partitioned-v1') {
        const a = actual.stream!('["control"]'), b = control.stream!('["control"]');
        for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
      }
    });
});
