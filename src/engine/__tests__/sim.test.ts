import { describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440 } from '../presets';
import { runOnce, simulate } from '../sim';

describe('sim', () => {
  it('runs deterministically and produces damage', () => {
    const b = empressInkomsu440();
    const cards = cardsFor('empress');
    const r1 = runOnce(b, cards, 7, 180);
    const r2 = runOnce(b, cards, 7, 180);
    expect(r1.totalDamage).toBeGreaterThan(0);
    expect(r1.totalDamage).toBe(r2.totalDamage);
    expect(r1.ruinCasts).toBeGreaterThan(10);
    expect(r1.cardsDrawn).toBeGreaterThan(0);
  });

  it('never casts a ruin below 4 stacks except judgment or 0-stack fishing', () => {
    const b = empressInkomsu440();
    const s = simulate(b, cardsFor('empress'), { durationSec: 180, iterations: 30, seed: 1 });
    expect(s.ruinAt4Rate).toBeGreaterThan(0.5);
    // 낚시(0스택 포카)를 뺀 루인은 전부 4스택이어야 한다
    const r = runOnce(b, cardsFor('empress'), 11, 300);
    const fishing = r.breakdown.find((x) => x.id === 'four_of_a_kind')!;
    const partial = r.ruinCasts - r.ruinAt4;
    expect(partial).toBeLessThanOrEqual(fishing.casts);
    expect(s.dps.p10).toBeLessThanOrEqual(s.dps.median);
    expect(s.dps.median).toBeLessThanOrEqual(s.dps.p90);
    expect(s.breakdown.length).toBeGreaterThan(5);
  });

  it('a pure damage buff raises mean DPS', () => {
    const base = empressInkomsu440();
    const buffed = empressInkomsu440();
    buffed.passiveMods.push({ bucket: 'dmgToEnemy', value: 0.1, source: 'test' });
    const cfg = { durationSec: 120, iterations: 20, seed: 3 };
    const a = simulate(base, cardsFor('empress'), cfg);
    const c = simulate(buffed, cardsFor('empress'), cfg);
    expect(c.dps.mean / a.dps.mean).toBeCloseTo(1.1, 1);
  });
});
