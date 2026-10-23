import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { parseResultInput } from './resultComparison';
import { summarize } from './engine/stats';
import { cardSupplyWarnings } from './engine/cards';
import { damageWarnings } from './engine/skilldata';

const originalPath = 'tests/fixtures/audit/2026-10-17-ui-result-export-downloaded.json';
const original = JSON.parse(readFileSync(originalPath, 'utf8'));
// 과거 원본 수치는 고정하고 현재 안내 문구만 별도로 대조합니다.
const current = { ...original, result: { ...original.result, cardSupplyWarnings: cardSupplyWarnings(original.build),
  damageWarnings: damageWarnings(original.build) } };
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'arcanalab-replay-')))) throw new Error('임시 검증 경로 범위 오류');
    rmSync(directory, { recursive: true });
  }
});
function save(value: typeof original) {
  const directory = mkdtempSync(join(tmpdir(), 'arcanalab-replay-')); directories.push(directory);
  const path = join(directory, 'result.json'); writeFileSync(path, JSON.stringify(value)); return path;
}
const run = (path: string) => {
  const command = spawnSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/replay_result.ts', path],
    { encoding: 'utf8', timeout: 45000, maxBuffer: 10 * 1024 * 1024 });
  const diagnostic = JSON.stringify({ error: command.error && { message: command.error.message, code: (command.error as NodeJS.ErrnoException).code },
    signal: command.signal, stderr: command.stderr });
  expect(command.error, diagnostic).toBeUndefined();
  expect(command.signal, diagnostic).toBeNull();
  return command;
};

describe('saved result replay CLI', () => {
  it('preserves historical numbers and reports changed warnings without modifying the original', () => {
    const bytes = readFileSync(originalPath), command = run(originalPath);
    expect(command.status, command.stderr).toBe(1);
    const saved = JSON.parse(command.stdout);
    expect(saved.replay.matchesSavedResult).toBe(false);
    expect(saved.replay.matchesSavedCalculation).toBe(true);
    expect(saved.replay.changedWarningGroups).toEqual(['damageWarnings', 'cardSupplyWarnings']);
    expect(saved.replay.savedModelId).toBeNull();
    expect(saved.modelId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(saved.result).toEqual(current.result);
    expect(parseResultInput(command.stdout, '재실행.json')!.warnings).toEqual(original.warnings);
    expect(readFileSync(originalPath).equals(bytes)).toBe(true);
  }, 15000);

  it('fully reproduces a result saved with the current warnings', () => {
    const command = run(save(current));
    expect(command.status, command.stderr).toBe(0);
    const saved = JSON.parse(command.stdout);
    expect(saved.replay.matchesSavedResult).toBe(true);
    expect(saved.replay.matchesSavedCalculation).toBe(true);
    expect(saved.replay.changedWarningGroups).toEqual([]);
    expect(saved.result).toEqual(current.result);
  }, 15000);

  it('returns the fresh result with failure status when a consistent stored summary differs', () => {
    const changed = structuredClone(current);
    changed.result.samples = changed.result.samples.map((x: number) => x * 2);
    changed.result.dps = summarize(changed.result.samples);
    for (const skill of changed.result.breakdown) { skill.direct *= 2; skill.stackEffect *= 2; if (skill.dot !== undefined) skill.dot *= 2; }
    const command = run(save(changed));
    expect(command.status).toBe(1);
    expect(JSON.parse(command.stdout).replay.matchesSavedResult).toBe(false);
    expect(JSON.parse(command.stdout).replay.matchesSavedCalculation).toBe(false);
    expect(JSON.parse(command.stdout).replay.changedWarningGroups).toEqual([]);
    expect(JSON.parse(command.stdout).result).toEqual(current.result);
  }, 15000);

  it('preserves missing top-level warning provenance and warnings stored inside the result', () => {
    const changed = structuredClone(current); delete changed.warnings;
    const command = run(save(changed));
    expect(command.status, command.stderr).toBe(0);
    const parsed = parseResultInput(command.stdout, '재실행.json')!;
    expect(parsed.warnings).toBeNull();
    expect(parsed.result.inputWarnings).toEqual(original.result.inputWarnings);
  }, 15000);

  it('distinguishes an explicitly empty input-warning array from an omitted array', () => {
    const changed = structuredClone(current);
    changed.warnings = []; changed.result.inputWarnings = [];
    const command = run(save(changed));
    expect(command.status, command.stderr).toBe(1);
    const saved = JSON.parse(command.stdout);
    expect(saved.replay.matchesSavedResult).toBe(false);
    expect(saved.replay.matchesSavedCalculation).toBe(true);
    expect(saved.replay.changedWarningGroups).toEqual(['inputWarnings']);
    expect(saved.warnings).toEqual([]);
    expect(saved.result.inputWarnings).toBeUndefined();
  }, 15000);

  it('rejects a valid saved result above the duration limit before calculating', () => {
    const changed = structuredClone(original);
    changed.config.durationSec = 901; changed.result.durationSec = 901;
    changed.result.cardsUsedPerMin = changed.result.cardsPerMin - changed.result.cardsHeldAtEnd * 60 / 901;
    for (const skill of changed.result.breakdown) {
      skill.direct *= 901 / 30; skill.stackEffect *= 901 / 30; if (skill.dot !== undefined) skill.dot *= 901 / 30;
    }
    const command = run(save(changed));
    expect(command.status).toBe(1);
    expect(command.stdout).toBe('');
    expect(command.stderr).toContain('900초');
  }, 15000);

  it('reports a calculation error without a partial export', () => {
    const changed = structuredClone(original);
    changed.build.rotation = { ruinPriority: ['missing'], stackPriority: [], fillers: [], fishing: ['missing'] };
    const command = run(save(changed));
    expect(command.status).toBe(1);
    expect(command.stdout).toBe('');
    expect(command.stderr).toContain('unknown skill missing');
  }, 15000);

  it('terminates a non-advancing edited build instead of running indefinitely', () => {
    const changed = structuredClone(original);
    changed.build.skills = [{ id: 'loop', name: 'loop', kind: 'normal', cooldown: 0, castTime: 0, directCoef: 0, hits: 1 }];
    changed.build.rotation = { ruinPriority: [], stackPriority: [], fillers: ['loop'] };
    const command = run(save(changed));
    expect(command.status).toBe(1);
    expect(command.stdout).toBe('');
    expect(command.stderr).toContain('30초 제한');
  }, 45000);
});
