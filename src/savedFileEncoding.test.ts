import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { cardsFor, empressInkomsu440, simulate } from './engine';
import modelId from 'virtual:arcanalab-model';

const directory = mkdtempSync(join(tmpdir(), 'arcanalab-encoding-'));
afterAll(() => {
  if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'arcanalab-encoding-')))) throw new Error('임시 경로 범위 오류');
  rmSync(directory, { recursive: true });
});
const build = empressInkomsu440();
build.name = '인코딩~검사\uFEFF\uFFFD';
const config = { durationSec: 1, iterations: 2, seed: 1, randomMode: 'partitioned-v1' as const };
const saved = { build, config, result: simulate(build, cardsFor(build.variant), config), modelId };
const valid = Buffer.from('\uFEFF' + JSON.stringify(saved));
const invalid = Buffer.from(valid.map(byte => byte === 0x7e ? 0xff : byte));
const goodPath = join(directory, 'valid.json'), badPath = join(directory, 'invalid.json');
writeFileSync(goodPath, valid); writeFileSync(badPath, invalid);

describe('public file CLIs preserve bytes and reject invalid UTF-8', () => {
  it.each(['simulate_build', 'replay_result', 'compare_results', 'compare_builds'])('%s rejects malformed bytes and accepts a normal BOM file afterward', script => {
    const run = (path: string) => spawnSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', `scripts/${script}.ts`, path,
      ...(script.startsWith('compare_') ? [path] : script === 'simulate_build' ? ['1', '2', '1', 'partitioned-v1'] : [])],
    { encoding: 'utf8', timeout: 20000, maxBuffer: 10 * 1024 * 1024 });
    const rejected = run(badPath);
    expect(rejected.error).toBeUndefined();
    expect(rejected.status, rejected.stderr).toBe(1);
    expect(rejected.stdout).toBe('');
    expect(rejected.stderr).toContain('UTF-8');
    expect(readFileSync(badPath)).toEqual(invalid);
    const recovered = run(goodPath);
    expect(recovered.error).toBeUndefined();
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(recovered.stderr).toBe('');
    expect(recovered.stdout).toContain(build.name);
    expect(readFileSync(goodPath)).toEqual(valid);
  }, 45000);
});
