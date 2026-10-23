import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelIdentity, modelIdentityPlugin, modelSources } from '../scripts/model_identity';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'arcanalab-model-')))) throw new Error('임시 검증 경로 범위 오류');
    rmSync(directory, { recursive: true });
  }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'arcanalab-model-'));
  directories.push(root);
  for (const directory of ['src/engine/__tests__', 'data/raw', 'scripts']) mkdirSync(join(root, directory), { recursive: true });
  for (const path of ['src/engine/sim.ts', 'src/worker.ts', 'scripts/model_identity.ts', 'scripts/run_saved_build.ts', 'scripts/saved_build_worker.ts', 'data/cards.json']) writeFileSync(join(root, path), path);
  return root;
}

describe('model source identity', () => {
  it('changes for engine, worker, game data and source additions, but excludes secrets and audit inputs', () => {
    const root = fixture(), original = modelIdentity(root);
    expect(original).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const path of ['.env', 'data/raw/profile.json', 'src/engine/__tests__/sim.test.ts']) writeFileSync(join(root, path), 'excluded');
    expect(modelIdentity(root)).toBe(original);
    for (const path of modelSources(root)) {
      const saved = readFileSync(join(root, path));
      writeFileSync(join(root, path), 'changed');
      expect(modelIdentity(root)).not.toBe(original);
      writeFileSync(join(root, path), saved);
    }
    expect(modelIdentity(root)).toBe(original);
    writeFileSync(join(root, 'src/engine/new.ts'), 'new');
    expect(modelIdentity(root)).not.toBe(original);
  });

  it('reloads the page after a model change while leaving unrelated UI edits to normal HMR', () => {
    const root = fixture(), plugin = modelIdentityPlugin(root);
    const server = { moduleGraph: { invalidateAll: vi.fn() }, ws: { send: vi.fn() } };
    const update = plugin.handleHotUpdate as (context: unknown) => unknown;
    expect(update({ file: resolve(root, 'src/engine/sim.ts'), server })).toEqual([]);
    expect(server.moduleGraph.invalidateAll).toHaveBeenCalledOnce();
    expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' });
    update({ file: resolve(root, 'src/main.ts'), server });
    expect(server.ws.send).toHaveBeenCalledOnce();
  });

  it('invalidates identity when a model source is added or deleted', () => {
    const root = fixture(), handlers = new Map<string, (file: string) => void>();
    const watcher = { on(event: string, callback: (file: string) => void) { handlers.set(event, callback); return watcher; } };
    const server = { watcher, moduleGraph: { invalidateAll: vi.fn() }, ws: { send: vi.fn() } };
    const configure = modelIdentityPlugin(root).configureServer as (server: unknown) => unknown;
    configure(server);
    handlers.get('add')!(resolve(root, 'data/new.json'));
    handlers.get('unlink')!(resolve(root, 'src/engine/deleted.ts'));
    handlers.get('add')!(resolve(root, 'data/raw/private.json'));
    expect(server.moduleGraph.invalidateAll).toHaveBeenCalledTimes(2);
    expect(server.ws.send).toHaveBeenCalledTimes(2);
  });
});
