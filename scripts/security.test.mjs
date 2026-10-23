import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'vite';

test('local proxy and private files stay behind the development boundary', async t => {
  const requests = [];
  const upstream = createHttpServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ CharacterName: 'FixtureCharacter' }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const prior = process.env.LOSTARK_API_KEY;
  process.env.LOSTARK_API_KEY = 'local-security-test-placeholder';
  const server = await createServer({ logLevel: 'silent', server: { port: 0, strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${upstream.address().port}` } } } });
  const privateFile = '.env.security-probe';
  writeFileSync(privateFile, 'PRIVATE_FILE_PROBE=not-a-real-secret\n');
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const path = '/api/armories/characters/FixtureCharacter/profiles';
    await t.test('same-origin GET reaches only the configured upstream', async () => {
      const response = await fetch(origin + path, { headers: { Origin: origin } });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { CharacterName: 'FixtureCharacter' });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].authorization, 'bearer local-security-test-placeholder');
    });
    await t.test('cross-origin, non-GET and unrelated API requests never reach upstream', async () => {
      for (const [route, options] of [
        [path, { headers: { Origin: 'https://attacker.example' } }],
        [path, { headers: { 'Sec-Fetch-Site': 'cross-site' } }],
        [path, { method: 'POST' }],
        ['/api/markets/items', {}],
        ['/api/armories/characters/a%2fb/profiles', {}],
      ]) assert.equal((await fetch(origin + route, options)).status, 403);
      assert.equal(requests.length, 1);
    });
    await t.test('private files are not served', async () => {
      for (const route of ['/' + privateFile, '/.git/config', '/tests/fixtures/audit/2026-10-17-fresh-armory-sources.json']) {
        const response = await fetch(origin + route);
        assert.ok([403, 404].includes(response.status), `${route}: ${response.status}`);
        assert.ok(!(await response.text()).includes('PRIVATE_FILE_PROBE'));
      }
    });
  } finally {
    unlinkSync(privateFile);
    await server.close();
    await new Promise(resolve => upstream.close(resolve));
    if (prior === undefined) delete process.env.LOSTARK_API_KEY; else process.env.LOSTARK_API_KEY = prior;
  }
});
