import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import type { Plugin } from 'vite';

const moduleId = 'virtual:arcanalab-model';
const resolvedId = '\0' + moduleId;
const normalized = (path: string) => path.replace(/\\/g, '/');
const entrypoints = ['src/worker.ts', 'scripts/model_identity.ts', 'scripts/run_saved_build.ts', 'scripts/saved_build_worker.ts'];
const isModelSource = (path: string) => entrypoints.includes(path)
  || /^data\/[^/]+\.json$/.test(path)
  || (path.startsWith('src/engine/') && path.endsWith('.ts') && !path.includes('/__tests__/') && !path.endsWith('.test.ts'));

export function modelSources(root: string): string[] {
  const engine = (directory: string): string[] => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : engine(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
  return [...engine('src/engine'), ...entrypoints,
    ...readdirSync(join(root, 'data'), { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => `data/${entry.name}`)].sort();
}

export function modelIdentity(root: string): string {
  const inputs = modelSources(root).map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]);
  return 'sha256:' + createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

export function modelIdentityPlugin(root: string): Plugin {
  return {
    name: 'arcanalab-model-identity',
    resolveId(id) { if (id === moduleId) return resolvedId; },
    load(id) {
      if (id !== resolvedId) return;
      for (const path of modelSources(root)) this.addWatchFile(resolve(root, path));
      return `export default ${JSON.stringify(modelIdentity(root))};`;
    },
    configureServer(server) {
      const reload = (file: string) => {
        if (!isModelSource(normalized(relative(root, file)))) return;
        server.moduleGraph.invalidateAll();
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload).on('unlink', reload);
    },
    handleHotUpdate(context) {
      const path = normalized(relative(root, context.file));
      if (!isModelSource(path)) return;
      context.server.moduleGraph.invalidateAll();
      context.server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
