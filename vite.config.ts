// 개발 서버: /api → 로스트아크 Open API 프록시. API 키는 .env 에서 서버 쪽에서만 붙인다(클라이언트 번들에 포함되지 않음).
import { defineConfig, loadEnv } from 'vite';
import { modelIdentityPlugin } from './scripts/model_identity';
import { localApiGuard } from './scripts/local_api';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const key = env.LOSTARK_API_KEY ?? '';
  return {
    // Browser code has no package dependencies; avoid dependency discovery in CLI runners.
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [localApiGuard(Boolean(key) && !key.includes('붙여넣기')), modelIdentityPlugin(process.cwd())],
    worker: { plugins: () => [modelIdentityPlugin(process.cwd())] },
    server: {
      host: '127.0.0.1',
      cors: false,
      allowedHosts: ['localhost', '127.0.0.1'],
      fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx}',
        ...['.git', '.claude', '.publication', 'data/raw', 'docs/audit', 'tests/fixtures'].map(path => resolve(process.cwd(), path).replaceAll('\\', '/') + '/**')] },
      proxy: {
        '/api': {
          target: 'https://developer-lostark.game.onstove.com',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/api/, ''),
          headers: { authorization: `bearer ${key}`, accept: 'application/json' },
        },
      },
    },
    preview: { host: '127.0.0.1', cors: false, proxy: {} },
    test: { include: ['src/**/*.test.ts'] },
  };
});
