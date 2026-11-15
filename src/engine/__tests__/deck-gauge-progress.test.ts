import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { Deck } from '../deck';
import { cardsFor } from '../presets';
import { createRng } from '../rng';

function runCase(mode: string): Promise<{ stdout: string; stderr: string; status: number | null; signal: string | null; error?: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/deck_gauge_case.ts', mode]);
    let stdout = '', stderr = '', error: string | undefined, started = false;
    const stop = (phase: string) => { error = `${phase} timeout`; child.kill('SIGKILL'); };
    let timer = setTimeout(() => stop('startup'), 30000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!started && stdout.includes('started\n')) {
        started = true; clearTimeout(timer); timer = setTimeout(() => stop('gauge'), 4000);
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', value => { error = value.message; });
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ stdout, stderr, status, signal, error }); });
  });
}

describe('deck gauge progress without drawable cards', () => {
  it.each(['empty', 'one', 'infinite'])('completes the isolated %s case instead of spinning forever', async mode => {
    const run = await runCase(mode);
    expect(run.stdout).toContain('started\n');
    expect(run.error, JSON.stringify(run)).toBeUndefined(); expect(run.signal).toBeNull();
    if (mode === 'infinite') {
      expect(run.status).toBe(1); expect(run.stderr).toContain('카드 게이지');
      expect(run.stdout).toBe('started\n');
    } else {
      expect(run.status).toBe(0); expect(run.stderr).toBe('');
      const result = JSON.parse(run.stdout.split('\n')[1]!);
      expect(result.gauge).toBe(0); expect(result.drawn).toEqual(mode === 'one' ? ['control'] : []);
      expect(result.hand).toEqual(result.drawn);
      const control = createRng(42); if (mode === 'one') control.next();
      expect(result.next).toBe(control.next());
    }
  }, 40000);

  it.each([-1, NaN, '1', null] as unknown[])('rejects invalid increase %s without changing gauge or hand', amount => {
    const deck = new Deck(cardsFor('empress')), rng = createRng(42);
    deck.gauge = 0.5;
    expect(() => deck.addGauge(amount as number, rng)).toThrow('카드 게이지');
    expect(deck.gauge).toBe(0.5); expect(deck.hand).toEqual([]);
    expect(rng.next()).toBe(createRng(42).next());
  });

  it.each([0, 0.7, 1.2, 3.25])('preserves the fractional remainder and RNG when no card can be drawn (%s)', amount => {
    for (const cards of [[], cardsFor('empress').slice(0, 1)]) {
      const deck = new Deck(cards), rng = createRng(42), control = createRng(42);
      if (cards.length) { deck.draw(rng); control.next(); }
      expect(deck.addGauge(amount, rng)).toEqual([]);
      expect(deck.gauge).toBeCloseTo(amount % 1);
      expect(deck.drawn).toBe(cards.length); expect(rng.next()).toBe(control.next());
    }
  });

  it('fills available slots with huge finite gauge and discards the overflow', () => {
    const deck = new Deck(cardsFor('empress')), rng = createRng(42), control = createRng(42);
    expect(deck.addGauge(1e20, rng)).toHaveLength(2);
    expect(new Set(deck.hand).size).toBe(2); expect(deck.gauge).toBe(0); expect(deck.drawn).toBe(2);
    control.next(); control.next(); expect(rng.next()).toBe(control.next());
  });
});
