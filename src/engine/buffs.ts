// 시간 제한 버프 관리. 같은 id 는 갱신(지속시간 리셋), maxStacks 가 있으면 중첩.
import type { Modifier, TimedEffect } from './types';
import { modifierValue } from './damage';

interface Active {
  id: string;
  mod: Modifier;
  expiresAt: number;
  stacks: number;
  maxStacks: number;
}

export class BuffManager {
  private active = new Map<string, Active>();

  apply(e: TimedEffect, now: number): void {
    const expiresAt = now + e.duration;
    if (!Number.isFinite(e.duration) || e.duration < 0 || !Number.isFinite(expiresAt))
      throw new RangeError('버프 지속시간은 0 이상의 유한한 수이고 만료 시각도 유한해야 합니다.');
    const cur = this.active.get(e.id);
    const max = e.maxStacks === undefined ? 1 : e.maxStacks;
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('버프 중첩 상한은 1 이상의 안전한 정수여야 합니다.');
    if (cur && cur.expiresAt > now) {
      cur.expiresAt = expiresAt;
      cur.stacks = Math.min(max, cur.stacks + 1);
      cur.mod = e.mod;
    } else {
      // Start a new activation in the same order whether modsAt already removed the expired entry or not.
      this.active.delete(e.id);
      this.active.set(e.id, { id: e.id, mod: e.mod, expiresAt, stacks: 1, maxStacks: max });
    }
  }

  remove(id: string): void {
    this.active.delete(id);
  }

  has(id: string, now: number): boolean {
    const a = this.active.get(id);
    return !!a && a.expiresAt > now;
  }

  remaining(id: string, now: number): number {
    const a = this.active.get(id);
    return a ? Math.max(0, a.expiresAt - now) : 0;
  }

  nextExpiryAfter(now: number): number {
    let next = Infinity;
    for (const a of this.active.values()) if (a.expiresAt > now) next = Math.min(next, a.expiresAt);
    return next;
  }

  /** 현재 유효한 수정치 목록(중첩은 value × stacks) */
  modsAt(now: number): Modifier[] {
    const out: Modifier[] = [];
    for (const [id, a] of this.active) {
      if (a.expiresAt <= now) {
        this.active.delete(id);
        continue;
      }
      const value = modifierValue(a.mod);
      out.push(a.stacks === 1 ? a.mod : { ...a.mod, value: value * a.stacks });
    }
    return out;
  }
}
