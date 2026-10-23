import { describe, expect, it } from 'vitest';
import { localApiAllowed } from '../scripts/local_api';

const url = '/api/armories/characters/' + encodeURIComponent('테스트캐릭터') + '/profiles';
const request = { method: 'GET', url, headers: { host: '127.0.0.1:5173' } };
describe('local credential proxy boundary', () => {
  it('allows local CLI and same-origin browser requests', () => {
    expect(localApiAllowed(request)).toBe(true);
    expect(localApiAllowed({ ...request, headers: { ...request.headers, origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin' } })).toBe(true);
  });
  it.each(['attacker.example', 'localhost.attacker.example', '192.168.1.2:5173'])('rejects non-local Host %s', host => {
    expect(localApiAllowed({ ...request, headers: { host } })).toBe(false);
  });
  it.each(['https://attacker.example', 'null', 'http://127.0.0.1:9999'])('rejects external Origin %s', origin => {
    expect(localApiAllowed({ ...request, headers: { ...request.headers, origin } })).toBe(false);
  });
  it.each(['cross-site', 'same-site'])('rejects cross-origin browser requests without Origin: %s', site => {
    expect(localApiAllowed({ ...request, headers: { ...request.headers, 'sec-fetch-site': site } })).toBe(false);
  });
  it.each(['/api/markets/items', '/api/armories/characters/../profiles', '/api/armories/characters/%2e%2e/profiles', '/api/armories/characters/%252f/profiles', '/api/armories/characters/a%2fb/profiles', '/api/armories/characters/a%5cb/profiles', '/api/armories/characters/%/profiles', url + '?extra=1'])('rejects unapproved paths: %s', path => {
    expect(localApiAllowed({ ...request, url: path })).toBe(false);
  });
  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('rejects method %s', method => {
    expect(localApiAllowed({ ...request, method })).toBe(false);
  });
});
