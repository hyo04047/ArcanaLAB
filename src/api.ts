// 브라우저에서 /api 프록시를 통해 armory 를 받는다 (vite.config.ts 의 프록시가 키를 붙임).
import type { RawArmory } from './engine/armory';

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { accept: 'application/json' }, signal });
  if (res.status === 429) throw new Error('API 요청 한도 초과(분당 100회). 잠시 후 다시 시도하세요.');
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`);
  const text = await res.text();
  if (!text) throw new Error(`빈 응답: ${path} (캐릭터명 확인)`);
  return JSON.parse(text) as T;
}

export async function fetchArmory(name: string, signal?: AbortSignal): Promise<RawArmory> {
  const enc = encodeURIComponent(name);
  const base = `/armories/characters/${enc}`;
  const [profiles, combatSkills, arkpassive, arkgrid, engravings, gems, equipment, cards] = await Promise.all([
    get<RawArmory['profiles']>(`${base}/profiles`, signal),
    get<RawArmory['combatSkills']>(`${base}/combat-skills`, signal),
    get<RawArmory['arkpassive']>(`${base}/arkpassive`, signal),
    get<RawArmory['arkgrid']>(`${base}/arkgrid`, signal),
    get<RawArmory['engravings']>(`${base}/engravings`, signal),
    get<RawArmory['gems']>(`${base}/gems`, signal),
    get<RawArmory['equipment']>(`${base}/equipment`, signal),
    get<RawArmory['cards']>(`${base}/cards`, signal),
  ]);
  if (!profiles) throw new Error('캐릭터를 찾을 수 없습니다');
  return { profiles, combatSkills, arkpassive, arkgrid, engravings, gems, equipment, cards };
}
