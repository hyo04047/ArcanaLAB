// 아이덴티티 카드 덱 (docs/mechanics.md §3). 손패 2장, 무작위 추출은 손패 종류 제외. 광대 복제는 중복 허용.
import type { Rng } from './rng';

export interface CardDef {
  id: string;
  name: string;
  duration: number | null; // null = 지속 개념 없음, 0 = 즉시형
  weight: number;
  availability: string[];
}

export class Deck {
  readonly hand: string[] = [];
  gauge = 0; // 0..1, 1 이면 드로우
  drawn = 0;
  private lastDrawn: string | null = null;

  constructor(
    readonly cards: CardDef[],
    readonly handSize = 2,
  ) {
    if (!Number.isSafeInteger(handSize) || handSize < 0) throw new RangeError('손패 한도는 0 이상의 안전한 정수여야 합니다.');
  }

  private drawable(): CardDef[] {
    return this.cards.filter((c) => !this.hand.includes(c.id));
  }

  get isFull(): boolean {
    return this.hand.length >= this.handSize;
  }

  /** 게이지 추가. 가득 차면 드로우. 손패가 꽉 차 있으면 게이지는 0 고정. */
  addGauge(amount: number, rng: Rng): string[] {
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(this.gauge + amount))
      throw new RangeError('카드 게이지 증가는 0 이상의 유한한 수여야 합니다.');
    const got: string[] = [];
    if (this.isFull) {
      this.gauge = 0;
      return got;
    }
    this.gauge += amount;
    while (this.gauge >= 1 && !this.isFull) {
      this.gauge -= 1;
      const c = this.draw(rng);
      if (!c) { this.gauge %= 1; break; }
      got.push(c);
    }
    if (this.isFull) this.gauge = 0;
    return got;
  }

  /** 즉시 드로우 (퀵 드로, 운명 발동, 각성기 등). 손패 꽉 차면 null. */
  draw(rng: Rng, forcedId?: string): string | null {
    if (this.isFull) return null;
    let id: string;
    if (forcedId) id = forcedId;
    else {
      const pool = this.drawable().filter(c => c.weight !== 0);
      if (pool.length === 0) return null;
      if (pool.some(c => !Number.isFinite(c.weight) || c.weight < 0)) throw new RangeError('카드 가중치는 0 이상의 유한한 숫자여야 합니다.');
      const total = pool.reduce((s, c) => s + c.weight, 0);
      if (!Number.isFinite(total)) throw new RangeError('추첨 가능한 카드의 가중치 합계는 유한해야 합니다.');
      let r = rng.next() * total;
      id = pool[pool.length - 1]!.id;
      for (const c of pool) {
        r -= c.weight;
        if (r < 0) {
          id = c.id;
          break;
        }
      }
    }
    this.hand.push(id);
    if (this.isFull) this.gauge = 0;
    this.drawn++;
    this.lastDrawn = id;
    return id;
  }

  /** 손패에서 카드 제거(사용) */
  use(id: string): boolean {
    const i = this.hand.indexOf(id);
    if (i < 0) return false;
    this.hand.splice(i, 1);
    return true;
  }

  get last(): string | null {
    return this.lastDrawn;
  }
}
