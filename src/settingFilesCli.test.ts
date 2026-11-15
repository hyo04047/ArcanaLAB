import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import modelId from 'virtual:arcanalab-model';
import { captureSettingBaseline } from './engine/settings';
import { readSettingInput, saveSettingInput } from './settingFiles';
import { parseResultInput } from './resultComparison';

let directory: string, inputPath: string, resultPath: string, inputText: string, resultText: string;
const run = (script: string, args: string[]) => {
  const result = spawnSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', `scripts/${script}.ts`, ...args],
    { encoding: 'utf8', timeout: 45000, maxBuffer: 10 * 1024 * 1024 });
  expect(result.error, result.stderr).toBeUndefined(); expect(result.signal, result.stderr).toBeNull();
  return result;
};

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'arcanalab-setting-files-'));
  const raw = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-22-four-axis-inputs.json', 'utf8')).inputs[0].raw;
  const baseline = await captureSettingBaseline(raw);
  inputText = await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId, { kind: 'synthetic' });
  inputPath = join(directory, 'input.json'); resultPath = join(directory, 'result.json');
  writeFileSync(inputPath, inputText);
  const calculated = run('simulate_build', [inputPath, '30', '2', '1', 'partitioned-v1']);
  expect(calculated.status, calculated.stderr).toBe(0);
  resultText = calculated.stdout; writeFileSync(resultPath, resultText);
}, 20000);

afterAll(() => {
  if (!directory) return;
  if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'arcanalab-setting-files-')))) throw new Error('임시 경로 범위 오류');
  rmSync(directory, { recursive: true });
});

describe('selection-aware saved input CLI', () => {
  it('preserves selections through calculation and replay without changing either source file', async () => {
    const original = JSON.parse(inputText), result = JSON.parse(resultText);
    expect(result.setting).toEqual(original.setting); expect(result.summary).toEqual(original.summary);
    expect((await readSettingInput(resultText, 'CLI 결과', modelId)).status).toBe('editable');
    const replayed = run('replay_result', [resultPath]);
    expect(replayed.status, replayed.stderr).toBe(0);
    const parsed = JSON.parse(replayed.stdout);
    expect(parsed.setting).toEqual(original.setting); expect(parsed.replay.matchesSavedResult).toBe(true);
    expect(parseResultInput(replayed.stdout, '재실행')!.result).toEqual(parseResultInput(resultText, '기준')!.result);
    expect(readFileSync(inputPath, 'utf8')).toBe(inputText); expect(readFileSync(resultPath, 'utf8')).toBe(resultText);
  }, 15000);

  it('compares the same saved result without duplicate selection notices', () => {
    const compared = run('compare_results', [resultPath, resultPath]);
    expect(compared.status, compared.stderr).toBe(0);
    const result = JSON.parse(compared.stdout);
    expect(result.selectionNotices).toEqual([{ path: resultPath, notices: [] }, { path: resultPath, notices: [] }]);
    expect(result.paired.dps.mean).toBe(0);
  }, 15000);

  it.each(['model-changed', 'unsupported-version'])('preserves %s selections while replaying stored calculation input', async status => {
    const original = JSON.parse(inputText);
    if (status === 'model-changed') original.setting.compiledWith = 'sha256:' + '0'.repeat(64);
    else original.setting = { version: 2, opaque: { preserve: true } };
    const file = join(directory, status + '.json'), text = JSON.stringify(original);
    writeFileSync(file, text);
    const calculated = run('simulate_build', [file, '30', '2', '1']);
    expect(calculated.status, calculated.stderr).toBe(0);
    const parsed = JSON.parse(calculated.stdout);
    expect(parsed.setting).toEqual(original.setting); expect(parsed.selectionNotices).toHaveLength(1);
    expect((await readSettingInput(calculated.stdout, '호환 결과', modelId)).status).toBe(status);
    expect(readFileSync(file, 'utf8')).toBe(text);
  }, 15000);

  it.each(['simulate_build', 'replay_result', 'compare_results'])('rejects inconsistent selections before %s uses them', script => {
    const invalid = JSON.parse(resultText); invalid.build.stats.swift++;
    const file = join(directory, script + '-invalid.json'); writeFileSync(file, JSON.stringify(invalid));
    const args = script === 'simulate_build' ? [file, '30', '2', '1'] : script === 'compare_results' ? [file, file] : [file];
    const result = run(script, args);
    expect(result.status).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).toContain('일치하지 않습니다');
  }, 15000);
});
