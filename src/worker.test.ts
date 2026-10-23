import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardsFor, empressInkomsu440, simulate } from './engine';
import type { WorkerRequest } from './worker';
import modelId from 'virtual:arcanalab-model';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
async function worker() {
  const scope = { postMessage: vi.fn(), onmessage: null as ((event: { data: WorkerRequest }) => void) | null };
  vi.stubGlobal('self', scope);
  await import('./worker');
  return scope;
}

describe('simulation worker responses', () => {
  it('preserves request-specific import warnings with unchanged calculation values', async () => {
    const scope = await worker(), build = empressInkomsu440();
    const config = { durationSec: 1, iterations: 1, seed: 1 };
    const inputWarnings = ['룬 출혈(도트) 미모델 (return)'];
    const request = { id: 1, build, config, inputWarnings };
    scope.onmessage!({ data: request });
    const response = JSON.parse(JSON.stringify(scope.postMessage.mock.calls[0]![0]));
    expect(response.modelId).toBe(modelId);
    expect(response.summary.inputWarnings).toEqual(inputWarnings);
    const numericSummary = { ...response.summary };
    delete numericSummary.inputWarnings;
    expect(numericSummary).toEqual(simulate(build, cardsFor(build.variant, build.deckOverrides), config));
    scope.onmessage!({ data: { id: 2, build, config } });
    expect(scope.postMessage.mock.calls[1]![0].summary.inputWarnings).toBeUndefined();
  });

  it('returns an invalid-input error with the original request id and can process a later valid request', async () => {
    const scope = await worker(), build = empressInkomsu440();
    const config = { durationSec: 1, iterations: 0, seed: 1 };
    expect(() => scope.onmessage!({ data: { id: 4, build, config } })).not.toThrow();
    expect(scope.postMessage).toHaveBeenLastCalledWith({ id: 4, error: expect.stringContaining('반복 수') });
    scope.onmessage!({ data: { id: 5, build, config: { ...config, iterations: 1 } } });
    expect(scope.postMessage).toHaveBeenLastCalledWith({ id: 5, summary: expect.objectContaining({ iterations: 1 }), modelId });
  });

  it('returns a calculation failure instead of leaving the request unresolved', async () => {
    const scope = await worker(), build = empressInkomsu440();
    build.rotation.ruinPriority = ['missing_skill'];
    build.rotation.stackPriority = [];
    build.rotation.fillers = [];
    build.rotation.fishing = ['missing_skill'];
    delete build.rotation.finisher;
    expect(() => scope.onmessage!({ data: { id: 8, build, config: { durationSec: 1, iterations: 1, seed: 1 } } })).not.toThrow();
    expect(scope.postMessage).toHaveBeenLastCalledWith({ id: 8, error: expect.stringContaining('unknown skill') });
  });
});
