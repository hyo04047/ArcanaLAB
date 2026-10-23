import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArmory } from './api';

afterEach(() => vi.unstubAllGlobals());
function serve(overrides: Record<string, Response> = {}) {
  const endpoints: Record<string, unknown> = { profiles: { CharacterName: '테스트' }, 'combat-skills': [], arkpassive: null,
    arkgrid: null, engravings: null, gems: { Effects: { Skills: [{ Name: '황제', Description: ['피해 44% 증가'] }] } }, equipment: [],
    cards: { Effects: [{ Items: [{ Name: '세상을 구하는 빛 6세트 (30각성합계)', Description: '성속성 피해 +4.00%' }] }] } };
  const fetch = vi.fn(async (path: string) => {
    const key = path.split('/').at(-1)!;
    return overrides[key] ?? new Response(JSON.stringify(endpoints[key]), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch); return fetch;
}
describe('Character import must distinguish missing data from failed requests', () => {
  it('passes cancellation to all eight pending endpoint requests', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal!;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })));
    const controller = new AbortController();
    const pending = fetchArmory('테스트', controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    await rejected;
    expect(signals).toHaveLength(8);
    expect(signals.every(signal => signal === controller.signal && signal.aborted)).toBe(true);
  });

  it('keeps successful gem and card set data and requests all eight endpoints', async () => {
    const fetch = serve(); const raw = await fetchArmory('테스트');
    expect(raw.gems?.Effects?.Skills?.[0]?.Name).toBe('황제');
    expect(raw.cards?.Effects[0]?.Items[0]?.Name).toBe('세상을 구하는 빛 6세트 (30각성합계)');
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it.each(['gems', 'equipment', 'cards'])('accepts an explicit successful null %s response', async endpoint => {
    serve({ [endpoint]: new Response('null', { status: 200 }) });
    expect((await fetchArmory('테스트'))[endpoint as 'gems' | 'equipment' | 'cards']).toBeNull();
  });
  it.each(['gems', 'equipment', 'cards'].flatMap(endpoint => [401, 429, 503].map(status => ({ endpoint, status }))))(
    'fails the import if $endpoint returns HTTP $status', async ({ endpoint, status }) => {
      serve({ [endpoint]: new Response('{}', { status }) });
      await expect(fetchArmory('테스트')).rejects.toThrow(status === 429 ? '요청 한도' : String(status));
    });
  it.each(['gems', 'equipment', 'cards'])('does not turn an empty %s body into unequipped data', async endpoint => {
    serve({ [endpoint]: new Response('', { status: 200 }) });
    await expect(fetchArmory('테스트')).rejects.toThrow('빈 응답');
  });
  it.each(['gems', 'cards'])('does not silently drop malformed %s JSON', async endpoint => {
    serve({ [endpoint]: new Response('{broken', { status: 200 }) });
    await expect(fetchArmory('테스트')).rejects.toThrow();
  });
});
