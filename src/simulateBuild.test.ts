import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { compareResults, parseResultInput } from './resultComparison';
import { cardSupplyWarnings } from './engine/cards';
import { damageWarnings } from './engine/skilldata';

const sourcePaths = ['tests/fixtures/audit/2026-10-17-multi-setting-diff-before.json', 'tests/fixtures/audit/2026-10-17-multi-setting-diff-after.json'];
const run = (path: string, args = ['30', '10', '42']) => {
  const command = spawnSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/simulate_build.ts', path, ...args],
    { encoding: 'utf8', timeout: 45000, maxBuffer: 10 * 1024 * 1024 });
  const diagnostic = JSON.stringify({ error: command.error && { message: command.error.message, code: (command.error as NodeJS.ErrnoException).code },
    signal: command.signal, stderr: command.stderr });
  expect(command.error, diagnostic).toBeUndefined();
  expect(command.signal, diagnostic).toBeNull();
  return command;
};

describe('complete saved Build execution CLI', () => {
  it('executes both input-only builds and connects their complete results to comparison', () => {
    const snapshots = sourcePaths.map(path => readFileSync(path));
    const expected = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-18-result-comparison-after.json', 'utf8')).comparisons[1];
    const inputs = sourcePaths.map((path, index) => {
      const command = run(path);
      expect(command.status, command.stderr).toBe(0);
      expect(readFileSync(path).equals(snapshots[index]!)).toBe(true);
      const parsed = parseResultInput(command.stdout, path)!;
      const prior = index === 0 ? expected.before : expected.after;
      expect(parsed.result).toEqual({ ...prior.result, cardSupplyWarnings: cardSupplyWarnings(prior.build),
        damageWarnings: damageWarnings(prior.build) });
      expect(parsed.modelId).toMatch(/^sha256:[a-f0-9]{64}$/);
      return parsed;
    });
    const comparison = compareResults(inputs[0]!, inputs[1]!);
    expect(comparison.modelStatus).toBe('same');
    expect(comparison.differences).toHaveLength(10);
    expect(comparison.metrics).toHaveLength(56);
    expect(inputs.map(input => input.warnings?.length)).toEqual([44, 46]);
  }, 60000);

  it.each([
    ['NaN', '10', '1'], ['30', '0', '1'], ['30', '20001', '1'], ['30', '10', '1.5'],
  ])('rejects invalid configuration %s / %s / %s without creating a result', (duration, iterations, seed) => {
    const command = run(sourcePaths[0]!, [duration, iterations, seed]);
    expect(command.status).toBe(1);
    expect(command.stdout).toBe('');
    expect(command.stderr).toContain('실행 조건을 확인하세요');
  }, 15000);

  it('keeps raw Build input warnings unknown while retaining current engine warnings', () => {
    const command = run('tests/fixtures/audit/2026-10-18-saved-build-run-raw-input.json');
    expect(command.status, command.stderr).toBe(0);
    const parsed = parseResultInput(command.stdout, '원시 Build 결과')!;
    expect(parsed.warnings).toBeNull();
    expect(parsed.result.damageWarnings.length).toBeGreaterThan(0);
    expect(parsed.result.cardSupplyWarnings.length).toBeGreaterThan(0);
  }, 15000);
});
