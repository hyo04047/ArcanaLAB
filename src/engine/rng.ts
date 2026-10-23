// 시드 고정 난수. 같은 시드 → 같은 시뮬 결과 (재현성).
export interface Rng {
  next(): number; // [0, 1)
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  /** 비교용 판정별 난수열. 생략하면 기존 단일 난수열을 사용합니다. */
  stream?(key: string): Rng;
}

export type RandomMode = 'legacy' | 'partitioned-v1';

export function validRandomMode(value: unknown): value is RandomMode | undefined {
  return value === undefined || value === 'legacy' || value === 'partitioned-v1';
}

/** 판정 종류·스킬·성분별 실제 추첨 순번을 맞춥니다. 게임 RNG의 재현은 아닙니다. */
export function randomStream(rng: Rng, ...key: string[]): Rng {
  return rng.stream?.(JSON.stringify(key)) ?? rng;
}

// mulberry32
export function createRng(seed: number, mode: RandomMode = 'legacy'): Rng {
  if (!validRandomMode(mode)) throw new Error('지원하지 않는 난수 방식입니다.');
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    chance: (p) => next() < p,
    pick: (arr) => {
      if (arr.length === 0) throw new Error('pick from empty array');
      return arr[Math.floor(next() * arr.length)] as (typeof arr)[number];
    },
  };
  if (mode === 'partitioned-v1') {
    const streams = new Map<string, Rng>();
    rng.stream = key => {
      let stream = streams.get(key);
      if (!stream) {
        let hash = (2166136261 ^ (seed >>> 0)) >>> 0;
        for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
        hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
        hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
        stream = createRng((hash ^ (hash >>> 16)) >>> 0);
        streams.set(key, stream);
      }
      return stream;
    };
  }
  return rng;
}
