import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';

/** API credentials are available only to same-origin, loopback development requests. */
export function localApiAllowed(request: Pick<IncomingMessage, 'method' | 'url' | 'headers'>): boolean {
  if (request.method !== 'GET' || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.host ?? '')) return false;
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}`) return false;
  if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin'
    && request.headers['sec-fetch-site'] !== 'none') return false;
  const match = request.url?.match(/^\/api\/armories\/characters\/([^/?#]+)\/(profiles|combat-skills|arkpassive|arkgrid|engravings|gems|equipment|cards)$/);
  if (!match) return false;
  try { return /^[\p{L}\p{N}_-]{1,64}$/u.test(decodeURIComponent(match[1]!)); }
  catch { return false; }
}

export function localApiGuard(hasKey: boolean): Plugin {
  return {
    name: 'local-api-guard',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api')) return next();
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (!localApiAllowed(request)) {
          response.statusCode = 403;
          response.end(JSON.stringify({ error: '로컬 화면의 캐릭터 조회 요청만 허용합니다.' }));
        } else if (!hasKey) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: '.env에 LOSTARK_API_KEY를 설정하세요.' }));
        } else next();
      });
    },
  };
}
