import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cardsFor, empressInkomsu440, simulate } from './engine';
import { runSavedBuild } from '../scripts/run_saved_build';

const { spawnSync, modelIdentity } = vi.hoisted(() => ({ spawnSync: vi.fn(), modelIdentity: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync }));
vi.mock('../scripts/model_identity', () => ({ modelIdentity }));
const modelId = 'sha256:' + '1'.repeat(64), otherModel = 'sha256:' + '2'.repeat(64);
const build = empressInkomsu440(), config = { durationSec: 1, iterations: 2, seed: 1 };
const result = { build, config, result: simulate(build, cardsFor(build.variant), config), modelId };
const success = { status: 0, stderr: '', stdout: JSON.stringify(result) };
beforeEach(() => { spawnSync.mockReset(); modelIdentity.mockReset().mockReturnValue(modelId); });

describe('saved calculation process failures do not return a completed result', () => {
  it.each([
    ['start', { error: new Error('ENOENT: worker missing') }],
    ['timeout', { error: Object.assign(new Error('spawn timeout'), { code: 'ETIMEDOUT' }) }],
    ['buffer', { error: Object.assign(new Error('output limit'), { code: 'ENOBUFS' }) }],
    ['exit', { ...success, status: 1, stderr: '계산 입력 오류' }],
    ['signal', { ...success, status: null, signal: 'SIGKILL' }],
    ['invalid JSON', { ...success, stdout: '{' }],
    ['missing result', { ...success, stdout: JSON.stringify({ build }) }],
    ['model', { ...success, stdout: JSON.stringify({ ...result, modelId: otherModel }) }],
  ])('rejects %s and permits a later normal process', (_label, failure) => {
    spawnSync.mockReturnValueOnce(failure).mockReturnValueOnce(success);
    expect(() => runSavedBuild({ build, warnings: null }, config)).toThrow();
    const recovered = runSavedBuild({ build, warnings: null }, config);
    expect(recovered.result).toEqual(result.result);
    expect(recovered.modelId).toBe(modelId);
    expect(spawnSync).toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.objectContaining({ timeout: 30000, killSignal: 'SIGKILL' }));
  });

  it('rejects a source change during execution and permits a later stable run', () => {
    modelIdentity.mockReturnValueOnce(modelId).mockReturnValueOnce(otherModel);
    spawnSync.mockReturnValue(success);
    expect(() => runSavedBuild({ build, warnings: null }, config)).toThrow('실행 중 계산 소스');
    expect(runSavedBuild({ build, warnings: null }, config).result).toEqual(result.result);
  });
});
