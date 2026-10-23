// 시뮬레이션 루프 (docs/mechanics.md §3·§4). 고정 사이클 로봇 플레이어.
// 마나·평타·보스 패턴 미모델. 타격/투사체 후보가 없는 스킬은 시전 종료에 합산 피해.
import { BuffManager } from './buffs';
import { HELD_CARDS, cardSupplyWarnings, emptyCardDraws, useCard, type CardHost } from './cards';
import { computeMultipliers, rollDefenseIgnore, rollHit, skillMatches, type DamageEnv } from './damage';
import { Deck, type CardDef } from './deck';
import { createRng, randomStream, validRandomMode, type Rng, type RandomMode } from './rng';
import { summarize } from './stats';
import { damageWarnings, resolveStackDamage } from './skilldata';
import type { Build, CardDrawSource, Modifier, SimConfig, SimRunResult, SimSummary, SkillBreakdown, SkillDef, SkillFilter, TimedEffect } from './types';

const MAX_STACKS = 4;

export class SimState implements CardHost {
  now = 0;
  readonly buffs = new BuffManager();
  readonly deck: Deck;
  stacks = 0;
  readyAt = new Map<string, number>();
  private charges = new Map<string, number>();
  nextSkillCdReset = false;
  total = 0;
  cardsDrawn = 0;
  cardsUsed = 0;
  cardDraws = emptyCardDraws();
  ruinCasts = 0;
  ruinAt4 = 0;
  breakdown = new Map<string, SkillBreakdown>();
  private lastUsed: string | null = null;
  twistedFateZeroChance: number;
  fatalHandCull: boolean;
  cardDamageCoef: Record<string, number>;
  private env: DamageEnv;
  private pendingHits: { at: number; skill: SkillDef; breakdown: SkillBreakdown; first?: boolean; last?: boolean }[] = [];
  private evokeChain?: { skill: SkillDef; availableAt: number; expiresAt: number };
  private poisons = new Map<string, { skill: SkillDef; stacks: number; expiresAt: number; nextTick: number }>();
  private convictionUntil = 0;
  private judgmentRuneReadyAt = 0;
  private pendingRuinCooldowns: { at: number; fraction: number }[] = [];
  private fullsetHits = 0;
  private stackHoldUses = 0;

  constructor(
    readonly build: Build,
    readonly rng: Rng,
    cards: CardDef[],
  ) {
    this.deck = new Deck(cards);
    this.twistedFateZeroChance = build.params.twistedFateZeroChance;
    this.fatalHandCull = build.params.fatalHandCull;
    this.cardDamageCoef = build.params.cardDamageCoef;
    this.env = { atkBase: build.params.atkBase, bluntThorn: build.bluntThorn, raidCaptainRatio: build.params.raidCaptainRatio };
    for (const s of build.skills) {
      if (this.breakdown.has(s.id)) throw new Error(`스킬 ID가 중복되었습니다: ${s.id}`);
      this.breakdown.set(s.id, { id: s.id, name: s.name, casts: 0, direct: 0, stackEffect: 0 });
      if (s.maxCharges && s.maxCharges > 1) this.charges.set(s.id, s.maxCharges);
    }
  }

  // ---- CardHost ----
  applyBuff(e: TimedEffect): void {
    this.buffs.apply(e, this.now);
  }
  removeBuff(id: string): void {
    this.buffs.remove(id);
  }
  drawCards(n: number, forcedId?: string, source: Exclude<CardDrawSource, 'gauge'> = 'manual'): void {
    for (let i = 0; i < n; i++) {
      const c = this.deck.draw(randomStream(this.rng, 'cardDraw'), forcedId);
      if (c) { this.cardsDrawn++; this.cardDraws[source]++; }
      else break;
    }
  }
  lastUsedCard(): string | null {
    return this.lastUsed;
  }
  reduceAllCooldowns(fraction: number, filter?: SkillFilter): void {
    for (const [id, t] of this.readyAt) {
      const s = this.build.skills.find((x) => x.id === id);
      if (s?.kind === 'awakening') continue;
      if (filter && (!s || !skillMatches(filter, s))) continue;
      if (t > this.now) {
        const remaining = (t - this.now) * (1 - fraction);
        if (!Number.isFinite(remaining) || remaining < 0) throw new RangeError(`${s?.name ?? id}의 남은 쿨타임은 0 이상의 유한한 수여야 합니다.`);
        this.readyAt.set(id, this.now + remaining);
      }
    }
  }
  setNextSkillCooldownReset(): void {
    this.nextSkillCdReset = true;
  }
  dealCardDamage(cardId: string, coef: number, proc = false): void {
    const flat = this.build.params.cardDamageFlat?.[cardId] ?? 0;
    if (coef <= 0 && flat <= 0) return;
    const pseudo: SkillDef = { id: `card_${cardId}`, name: cardId, kind: 'identity_card', usesMana: false,
      cooldown: 0, castTime: 0, directCoef: coef, directFlat: flat, hits: 1 };
    const m = computeMultipliers(this.env, this.activeMods(), { skill: pseudo, stacks: this.stacks, component: 'direct' });
    const { dmg } = rollHit(randomStream(this.rng, 'cardCrit', cardId, proc ? 'proc' : 'use'), coef, m, flat);
    this.total += dmg;
    // 피해 필터는 같은 황제를 가리키고, 결과 집계만 직접 사용과 추가 발동을 구별합니다.
    const id = proc ? `${pseudo.id}_proc` : pseudo.id;
    const b = this.breakdown.get(id) ?? { id, name: proc ? '또 다른 황제 발동' : `카드:${cardId}`, casts: 0, direct: 0, stackEffect: 0 };
    b.casts++;
    b.direct += dmg;
    this.breakdown.set(id, b);
  }
  durationBonus(cardId: string): number {
    return this.build.cardDurationBonus?.[cardId] ?? 0;
  }

  // ---- helpers ----
  activeMods(): Modifier[] {
    return [...this.build.passiveMods, ...this.buffs.modsAt(this.now)];
  }
  cooldownMultiplier(skill: SkillDef): number {
    let p = 1;
    const groups: Partial<Record<NonNullable<Modifier['cooldownGroup']>, number>> = {};
    for (const m of this.activeMods()) {
      if (m.bucket !== 'cooldown') continue;
      if (!skillMatches(m.filter, skill)) continue;
      if (m.cooldownGroup) groups[m.cooldownGroup] = (groups[m.cooldownGroup] ?? 0) + m.value;
      else p *= 1 - m.value;
    }
    for (const value of Object.values(groups)) p *= 1 - value;
    return p;
  }
  private cooldownDuration(skill: SkillDef): number {
    const cd = skill.cooldown * this.cooldownMultiplier(skill);
    if (!Number.isFinite(cd) || cd < 0) throw new RangeError(`${skill.name}의 적용 쿨타임은 0 이상의 유한한 수여야 합니다.`);
    return cd;
  }
  private startCooldown(skill: SkillDef, input = true): void {
    let cd = this.cooldownDuration(skill);
    if (input && this.nextSkillCdReset) {
      cd = 0;
      this.nextSkillCdReset = false;
    }
    if (input && skill.cdResetChance && randomStream(this.rng, 'cooldownReset', skill.id).chance(skill.cdResetChance)) cd = 0;
    const charges = this.charges.get(skill.id);
    if (charges !== undefined) {
      // 운수는 해당 사용만 면제하는 임시 가정. 이미 돌던 회복을 덮어쓰지 않습니다.
      if (cd === 0) return;
      this.charges.set(skill.id, charges - 1);
      if (charges === skill.maxCharges) this.readyAt.set(skill.id, this.now + cd);
      return;
    }
    this.readyAt.set(skill.id, this.now + cd);
  }
  atkSpeed(): number {
    let s = 0;
    for (const m of this.activeMods()) if (m.bucket === 'atkSpeed') s += m.value;
    if (!Number.isFinite(s) || s <= -1) throw new RangeError('공격 속도 배율은 0보다 큰 유한한 수여야 합니다.');
    // 일반 공속 상한 140%(S81·S82). 질풍/트포의 스킬 자체 속도는 castTime에 별도로 적용합니다.
    return Math.min(s, 0.4);
  }
  isReady(id: string): boolean {
    if (this.evokeChain?.skill.id === id) return this.now >= this.evokeChain.availableAt && this.now < this.evokeChain.expiresAt;
    const charges = this.charges.get(id);
    if (charges !== undefined) return charges > 0 || (this.readyAt.get(id) ?? Infinity) <= this.now;
    return (this.readyAt.get(id) ?? 0) <= this.now;
  }
  skill(id: string): SkillDef {
    const s = this.build.skills.find((x) => x.id === id);
    if (!s) throw new Error(`unknown skill ${id}`);
    return s;
  }
  judgmentActive(): boolean {
    return this.buffs.has('judgment', this.now);
  }
  private nextPoisonTime(): number {
    return Math.min(...[...this.poisons.values()].map(p => Math.min(p.nextTick, p.expiresAt)));
  }
  private nextChargeTime(): number {
    return Math.min(...[...this.charges.keys()].map(id => this.readyAt.get(id) ?? Infinity));
  }

  /** 시간을 진행하며 예약 폭발과 체인 만료를 차례로 처리합니다. */
  advanceTo(time: number): void {
    while (true) {
      const expiry = this.evokeChain?.expiresAt ?? Infinity;
      const hitAt = this.pendingHits[0]?.at ?? Infinity;
      const poisonAt = this.nextPoisonTime();
      const chargeAt = this.nextChargeTime();
      const ruinCooldownAt = this.pendingRuinCooldowns[0]?.at ?? Infinity;
      const at = Math.min(expiry, hitAt, poisonAt, chargeAt, ruinCooldownAt);
      if (at > time) break;
      this.now = at;
      // 같은 시각의 예약 폭발은 도트보다 먼저 처리합니다. 서버 틱 순서는 미검증입니다.
      if (expiry === at) {
        const chain = this.evokeChain!;
        // 미사용 만료는 쿨 시작만 처리하며 운수는 소비하지 않는 가정입니다.
        this.startCooldown(chain.skill, false);
        this.evokeChain = undefined;
      } else if (hitAt === at) {
        const event = this.pendingHits.shift()!;
        this.hit(event.skill, event.breakdown, event.first ?? true, event.last ?? true);
      } else if (poisonAt === at) {
        const p = [...this.poisons.values()].find(p => Math.min(p.nextTick, p.expiresAt) === at)!;
        if (this.now >= p.expiresAt) { this.poisons.delete(p.skill.id); continue; }
        const effect = (p.skill.manaPoison ?? p.skill.fearOfDeath)!;
        const nextTick = p.nextTick + effect.interval;
        if (nextTick <= p.nextTick) throw new RangeError(`${p.skill.name}의 도트 반복 간격이 현재 시각을 증가시키지 못합니다.`);
        const m = computeMultipliers(this.env, [...this.activeMods(), ...(p.skill.mods ?? [])],
          { skill: { ...p.skill, usesMana: false }, stacks: this.stacks, component: 'dot' });
        const damage = rollHit(randomStream(this.rng, 'dotCrit', p.skill.id), effect.coef * p.stacks, m, effect.flat * p.stacks).dmg;
        this.total += damage;
        const b = this.breakdown.get(p.skill.id)!;
        b.dot = (b.dot ?? 0) + damage;
        p.nextTick = nextTick;
      } else if (chargeAt === at) {
        const id = [...this.charges.keys()].find(id => this.readyAt.get(id) === at)!;
        const skill = this.skill(id), count = this.charges.get(id)! + 1;
        this.charges.set(id, count);
        if (count < skill.maxCharges!) this.readyAt.set(id, this.now + this.cooldownDuration(skill));
        else this.readyAt.delete(id);
      } else {
        const event = this.pendingRuinCooldowns.shift()!;
        this.reduceAllCooldowns(event.fraction, { kinds: ['ruin'] });
      }
    }
    this.now = time;
  }

  private applyPoison(skill: SkillDef): void {
    const effect = (skill.manaPoison ?? skill.fearOfDeath)!;
    if (!Number.isFinite(effect.duration) || effect.duration < 0 || !Number.isFinite(effect.firstTick) || effect.firstTick < 0 ||
        !Number.isFinite(effect.interval) || effect.interval <= 0)
      throw new RangeError(`${skill.name}의 도트 시간을 확인하세요: 지속·첫 틱은 0 이상, 반복 간격은 0보다 커야 합니다.`);
    const current = this.poisons.get(skill.id);
    if (current && this.now < current.expiresAt) {
      current.stacks = Math.min(effect.maxStacks, current.stacks + 1);
      current.expiresAt = this.now + effect.duration;
      current.skill = skill;
    } else {
      this.poisons.set(skill.id, { skill, stacks: 1, expiresAt: this.now + effect.duration, nextTick: this.now + effect.firstTick });
    }
  }

  private detonateEvoke(skill: SkillDef, endTime: number): void {
    const profile = skill.manualEvoke!;
    for (const h of profile.hits) this.pendingHits.push({ at: this.now + h.after,
      skill: { ...skill, hits: 1, directCoef: skill.directCoef * h.weight, directFlat: (skill.directFlat ?? 0) * h.weight,
        ...(skill.quickDraw ? { quickDraw: { ...skill.quickDraw, attempts: 1 } } : {}) }, breakdown: this.breakdown.get(skill.id)! });
    this.pendingHits.sort((a, b) => a.at - b.at);
    this.advanceTo(Math.min(this.now + profile.recastRecovery, endTime));
  }

  private placeSplitEvoke(skill: SkillDef, b: SkillBreakdown, endTime: number): void {
    const profile = skill.splitEvoke!;
    const duration = skill.castTime / (1 + this.atkSpeed());
    const placementAt = this.now + profile.placementAt * duration / profile.duration;
    if (placementAt <= endTime) {
      this.pendingHits.push({ at: placementAt + profile.delay, skill: { ...skill, hits: 1,
        ...(skill.quickDraw ? { quickDraw: { ...skill.quickDraw, attempts: 1 } } : {}) }, breakdown: b });
      this.pendingHits.sort((a, b) => a.at - b.at);
    }
    this.advanceTo(Math.min(this.now + duration, endTime));
  }

  useCardNow(id: string): void {
    if (!this.deck.use(id)) return;
    this.cardsUsed++;
    useCard(id, this);
    const infinity = this.build.infinityDeck;
    if (id === 'balance' && infinity?.balance) this.applyBuff(infinity.balance);
    if (id === 'judgment' && infinity?.judgment) {
      if (!Number.isFinite(infinity.judgment.delay) || infinity.judgment.delay < 0) throw new RangeError('인피니티 덱의 쿨 감소 지연은 0 이상의 유한한 수여야 합니다.');
      // 카드 지속과 별개로, 사용마다 독립 예약하는 후보입니다. 중복 심판 실측은 미검증입니다.
      this.pendingRuinCooldowns.push({ at: this.now + infinity.judgment.delay, fraction: infinity.judgment.fraction });
      this.pendingRuinCooldowns.sort((a, b) => a.at - b.at);
    }
    // 광대가 직전 사용 카드를 읽은 다음 현재 카드로 갱신합니다.
    this.lastUsed = id;
    for (const e of this.build.onCardUse ?? []) this.applyBuff(e);
    const emperorChance = this.build.anotherEmperorChance;
    if (id !== 'emperor' && emperorChance !== undefined && randomStream(this.rng, 'anotherEmperor', id).chance(emperorChance)) {
      this.dealCardDamage('emperor', this.cardDamageCoef['emperor'] ?? 0, true);
    }
    const chance = this.build.chainDraw?.chance;
    if (chance !== undefined && randomStream(this.rng, 'chainDraw', id).chance(chance)) this.triggerDestiny();
    if (this.build.stackHold && ++this.stackHoldUses === 2) { this.stackHoldUses = 0; this.triggerDestiny(); }
  }

  /** 즉시형·장기 버프 카드는 바로 사용 */
  flushInstantCards(): void {
    for (const id of [...this.deck.hand]) if (!HELD_CARDS.has(id)) this.useCardNow(id);
  }

  /**
   * 루인 직전 카드 정책 (가이드 S6·S2):
   * - 심판: 스택 없이 루인을 쓰려는 상황에서만(스택 스킬이 모두 쿨일 때) 사용. 4스택이면 아낀다.
   * - 도태: 4스택 또는 심판 중 루인 직전. 더 데빌을 사용하거나 루인 2개 이상이 준비됐을 때, 또는 손패가 꽉 찼을 때 사용합니다.
   * - 뒤틀린 운명: 4스택 루인 직전 즉시 사용(아낄 가치 낮음).
   */
  playHeldCardsForRuin(readyRuins: number, devilReady: boolean): void {
    const hand = [...this.deck.hand];
    if (hand.includes('judgment') && this.stacks < MAX_STACKS && !this.judgmentActive()) this.useCardNow('judgment');
    const at4 = this.stacks >= MAX_STACKS || this.judgmentActive();
    if (!at4) return;
    if (hand.includes('cull') && (devilReady || readyRuins >= 2 || this.deck.isFull)) this.useCardNow('cull');
    if (hand.includes('twisted_fate')) this.useCardNow('twisted_fate');
  }

  /** 황제 보유 딜카드 사용. 자동 운용이 시전 전/쿨 시작 직후를 선택하며 입력 지연은 미모델입니다. */
  private playHeldCardsForEmperor(skill: SkillDef): void {
    if (!['the_sun', 'unlimited_shuffle', 'dark_resurrection', 'evoke'].includes(skill.id) || !skillMatches({ kinds: ['normal'] }, skill)) return;
    // 설치만 하는 첫 입력에서는 아끼고, 격발/두 번째 설치 직전에 사용합니다.
    if ((skill.manualEvoke || skill.splitEvoke) && this.evokeChain?.skill.id !== skill.id) return;
    for (const [card, buff] of [['cull', 'cull_rate'], ['twisted_fate', 'twisted_fate'], ['sovereign', 'sovereign']] as const) {
      if (this.deck.hand.includes(card) && !this.buffs.has(buff, this.now)) this.useCardNow(card);
    }
  }

  /** 기본은 실제 운용 정책입니다. full은 기본 계수·전체 타격 구조를 검산할 때만 지정합니다. */
  cast(skill: SkillDef, endTime: number, mode: 'auto' | 'full' = 'auto', emperorCardsAfterStart = false): void {
    const sequence = skill.hitSequence;
    if (sequence && !skill.splitEvoke && !skill.manualEvoke && !skill.delayedHits) {
      if (!Number.isFinite(sequence.duration) || sequence.duration <= 0 || !Number.isFinite(skill.castTime) || skill.castTime < 0 ||
          !Array.isArray(sequence.hits) || sequence.hits.some((hit, i) => !hit || !Number.isFinite(hit.at) ||
            hit.at < 0 || hit.at > sequence.duration || (i > 0 && hit.at < sequence.hits[i - 1]!.at)) ||
          (sequence.firstHitEnd !== undefined && (!Number.isFinite(sequence.firstHitEnd) ||
            sequence.firstHitEnd < (sequence.hits[0]?.at ?? 0) || sequence.firstHitEnd > sequence.duration)))
        throw new RangeError(`${skill.name}의 개별 적중 시각을 확인하세요: 동작 구간 안의 시간순 목록이어야 합니다.`);
    }
    const delayed = skill.delayedHits;
    if (delayed && !skill.splitEvoke && !skill.manualEvoke) {
      if (!Number.isFinite(delayed.duration) || delayed.duration <= 0 || !Number.isFinite(skill.castTime) || skill.castTime < 0 ||
          !Number.isFinite(delayed.spawnAt) || delayed.spawnAt < 0 || delayed.spawnAt > delayed.duration ||
          !Array.isArray(delayed.hits) || delayed.hits.some((hit, i) => !hit || !Number.isFinite(hit.after) ||
            hit.after < 0 || (i > 0 && hit.after < delayed.hits[i - 1]!.after)))
        throw new RangeError(`${skill.name}의 지연 적중 시각을 확인하세요: 발사는 동작 구간 안, 지연은 0 이상의 시간순 목록이어야 합니다.`);
    }
    for (const profile of [skill.splitEvoke, skill.manualEvoke]) {
      if (profile && (!Number.isFinite(profile.duration) || profile.duration <= 0 ||
          !Number.isFinite(skill.castTime) || skill.castTime < 0 || !Number.isFinite(profile.placementAt) ||
          profile.placementAt < 0 || profile.placementAt > profile.duration))
        throw new RangeError(`${skill.name}의 설치·격발 시각을 확인하세요: 설치는 동작 구간 안이어야 합니다.`);
    }
    const split = skill.splitEvoke, manual = skill.manualEvoke;
    if ((split && [split.delay, split.window].some(value => !Number.isFinite(value) || value < 0)) ||
        (manual && ([manual.minRecastDelay, manual.lifetime, manual.recastRecovery].some(value => !Number.isFinite(value) || value < 0) ||
          !Array.isArray(manual.hits) || manual.hits.some(hit => !hit || !Number.isFinite(hit.after) || hit.after < 0))))
      throw new RangeError(`${skill.name}의 설치·격발 시각을 확인하세요: 대기·존속·후딜·폭발 지연은 0 이상의 시간이어야 합니다.`);
    if (!Number.isFinite(skill.castTime) || skill.castTime < 0) throw new RangeError(`${skill.name}의 시전시간은 0 이상의 유한한 수여야 합니다.`);
    this.advanceTo(this.now);
    if (!this.isReady(skill.id)) throw new Error(`skill on cooldown: ${skill.id}`);
    const b = this.breakdown.get(skill.id)!;
    if (this.evokeChain?.skill.id === skill.id) {
      this.startCooldown(skill);
      this.evokeChain = undefined;
      if (skill.manualEvoke) this.detonateEvoke(skill, endTime);
      else this.placeSplitEvoke(skill, b, endTime);
      return;
    }
    b.casts++;
    // 이보크는 재입력 때의 쿨감·운수를 사용합니다. 일반 스킬의 시작 순서는 유지합니다.
    if (!skill.splitEvoke && !skill.manualEvoke) this.startCooldown(skill);
    // S132: 노말 인핸스 더 썬·셔플의 기존 손패만 쿨 시작 직후 사용합니다. 입력 간격 0초 후보입니다.
    if (emperorCardsAfterStart) this.playHeldCardsForEmperor(skill);
    // 사용한 스킬의 쿨을 등록한 뒤, 발동 시점에 남은 전체 쿨을 줄입니다(각성기 제외).
    if (skill.runeCdReduce && randomStream(this.rng, 'quickRecharge', skill.id).chance(skill.runeCdReduce.chance)) this.reduceAllCooldowns(skill.runeCdReduce.fraction);
    // 광기 중첩
    if (this.buffs.has('mayhem_window', this.now)) this.applyBuff({ id: 'mayhem_stack', duration: 4, maxStacks: 3, mod: { bucket: 'atkSpeed', value: 0.05, source: '광기' } });
    for (const e of skill.onCast ?? []) this.applyBuff(e);
    if (skill.tags?.includes('destiny')) this.triggerDestiny();
    // 재입력은 위에서 반환합니다. T 스킬의 일반 태그까지 발동 자격으로 확장하지 않습니다.
    if (this.build.emperorHeartChance !== undefined && (skill.kind === 'normal' || skill.kind === 'stack') &&
      randomStream(this.rng, 'emperorHeart', skill.id).chance(this.build.emperorHeartChance)) this.triggerDestiny();
    // 시전
    const start = this.now;
    const speed = 1 + this.atkSpeed();
    let duration = skill.castTime / speed;
    if (skill.splitEvoke) {
      this.evokeChain = { skill, availableAt: start + skill.splitEvoke.placementAt * duration / skill.splitEvoke.duration,
        expiresAt: start + skill.splitEvoke.placementAt * duration / skill.splitEvoke.duration + skill.splitEvoke.window };
      this.placeSplitEvoke(skill, b, endTime);
      return;
    } else if (skill.manualEvoke) {
      const p = skill.manualEvoke;
      const placedAt = start + p.placementAt * duration / p.duration;
      if (placedAt <= endTime) this.evokeChain = { skill,
        availableAt: placedAt + p.minRecastDelay, expiresAt: placedAt + p.lifetime };
      this.advanceTo(Math.min(start + duration, endTime));
      return;
    } else if (skill.delayedHits) {
      const profile = skill.delayedHits;
      const spawnAt = start + profile.spawnAt * duration / profile.duration;
      if (spawnAt <= endTime) {
        for (const [i, h] of profile.hits.entries()) this.pendingHits.push({ at: spawnAt + h.after,
          skill: { ...skill, directCoef: h.directCoef, directFlat: h.directFlat, hits: 1,
            stacksGranted: h.stacksGranted ?? skill.stacksGranted }, breakdown: b,
          first: i === 0, last: i === profile.hits.length - 1 });
        this.pendingHits.sort((a, b) => a.at - b.at);
      }
    } else if (skill.hitSequence) {
      const scale = (skill.castTime / skill.hitSequence.duration) / speed;
      // 카드를 사용한 뒤 시전 시작 시점에 결정합니다. 도태·눈속임은 추가타 조건이 아닙니다.
      const firstOnly = mode === 'auto' && skill.id === 'serendipity' && !this.judgmentActive();
      const hits = firstOnly ? skill.hitSequence.hits.slice(0, 1) : skill.hitSequence.hits;
      if (firstOnly) duration = (skill.hitSequence.firstHitEnd ?? skill.hitSequence.duration) * scale;
      for (const [i, h] of hits.entries()) {
        const hitAt = start + h.at * scale;
        if (hitAt > endTime) break;
        this.advanceTo(hitAt);
        this.hit({ ...skill, directCoef: h.directCoef, directFlat: h.directFlat, hits: 1 }, b, i === 0, i === skill.hitSequence.hits.length - 1);
      }
    } else {
      const hitAt = start + skill.castTime / speed;
      this.advanceTo(Math.min(hitAt, endTime));
      if (hitAt <= endTime) this.hit(skill, b);
    }
    this.advanceTo(Math.min(start + duration, endTime));
  }

  triggerDestiny(): void {
    if (this.build.normalEnhanceCooldown !== undefined) this.reduceAllCooldowns(this.build.normalEnhanceCooldown, { kinds: ['normal', 'stack'] });
    for (const e of this.build.onDestiny ?? []) {
      if (e === 'drawCard') this.drawCards(1, undefined, 'destiny');
      else this.applyBuff(e);
    }
  }

  private triggerHitRune(skill: SkillDef): void {
    const rune = skill.hitRune;
    if (!rune || this.now < this.judgmentRuneReadyAt) return;
    if (rune.kind === 'judgment' && this.now >= this.convictionUntil) return;
    for (let i = 0; i < skill.hits; i++) {
      if (!randomStream(this.rng, 'hitRune', skill.id, rune.kind).chance(rune.chance)) continue;
      if (rune.kind === 'conviction') this.convictionUntil = this.now + rune.duration;
      else {
        this.convictionUntil = 0;
        // 원 작성자 실험 S69: 심판 성공 시 30초 공유 내부쿨, 이후 쿨 시작에 15%.
        this.judgmentRuneReadyAt = this.now + 30;
        this.applyBuff({ id: 'judgment_rune', duration: rune.duration,
          mod: { bucket: 'cooldown', value: 0.15, source: '심판 룬' } });
        break;
      }
    }
  }

  hit(skill: SkillDef, b: SkillBreakdown, firstHit = true, lastHit = true): void {
    const judgment = this.judgmentActive();
    const stacksForHit = this.isRuin(skill) && judgment ? MAX_STACKS : this.stacks;
    const mods = this.activeMods();
    const all = [...mods, ...(skill.mods ?? [])];

    // 직접 피해
    const md = computeMultipliers(this.env, all, { skill, stacks: stacksForHit, component: 'direct' });
    const direct = rollHit(randomStream(this.rng, 'directCrit', skill.id), skill.directCoef, md, skill.directFlat).dmg
      * rollDefenseIgnore(randomStream(this.rng, 'directDefense', skill.id), skill, this.build.params.targetDefense);
    this.total += direct;
    b.direct += direct;
    // 동일 적중을 소급 증폭하지 않는 순서입니다. 서버의 동일 프레임 선후는 미검증입니다.
    if (skill.hits > 0) for (const e of skill.onHit ?? []) {
      for (let i = 0; i < (e.maxStacks ? skill.hits : 1); i++) this.applyBuff(e);
    }
    if (skill.manaPoison || (lastHit && skill.fearOfDeath)) this.applyPoison(skill);

    // 루인: 스택트 효과 피해 + 스택 소모
    if (this.isRuin(skill)) {
      if (firstHit) {
        this.ruinCasts++;
        if (stacksForHit >= MAX_STACKS) this.ruinAt4++;
      }
      if (stacksForHit > 0) {
        // 폭발마다 한 번 추첨합니다. 4스택 80%, 의도된 우연 선택 시 +20%p.
        if (skill.procCritDmg && randomStream(this.rng, 'procCritDmg', skill.id).chance(Math.min(1, skill.procCritDmg.chancePerStack * stacksForHit + (skill.tripodChanceBonus ?? 0)))) {
          all.push({ bucket: 'critDmg', value: skill.procCritDmg.value, filter: { component: 'stack' }, source: '우연한 일격' });
        }
        const ms = computeMultipliers(this.env, all, { skill, stacks: stacksForHit, component: 'stack' });
        const { coef, flat } = resolveStackDamage(this.build, skill, stacksForHit);
        const se = rollHit(randomStream(this.rng, 'stackCrit', skill.id), coef, ms, flat).dmg
          * rollDefenseIgnore(randomStream(this.rng, 'stackDefense', skill.id), skill, this.build.params.targetDefense);
        this.total += se;
        b.stackEffect += se;
      }
      if (!judgment || this.stacks > 0) {
        const keep = skill.keepStacksChance && this.stacks >= (skill.keepStacksMin ?? MAX_STACKS)
          && randomStream(this.rng, 'keepStacks', skill.id).chance(Math.min(1, skill.keepStacksChance + (skill.tripodChanceBonus ?? 0)));
        if (!keep) this.stacks = 0;
      }
      if (stacksForHit >= MAX_STACKS) for (const e of this.build.onRuinAt4 ?? []) this.applyBuff(e);
    }
    // 스택트: 스택 부여
    if (skill.kind === 'stack' && skill.stacksGranted) {
      const bonus = this.buffs.has('balance', this.now) ? 1 : 0;
      this.stacks = Math.min(MAX_STACKS, this.stacks + skill.stacksGranted + bonus);
    }
    // 부식
    if (this.buffs.has('corrosion_window', this.now)) {
      for (let i = 0; i < skill.hits; i++) if (randomStream(this.rng, 'corrosion', skill.id).chance(0.3)) this.applyBuff({ id: 'corrosion', duration: 5, mod: { bucket: 'dmgToEnemy', value: this.build.params.corrosionValue, source: '부식' } });
    }
    // 덱 게이지
    const p = this.build.params;
    let gain = (skill.kind === 'identity_card' ? 0 : p.gaugePerHit[skill.kind]) * skill.hits
      * (1 + p.gaugeGainBonus + (this.build.chainDraw?.gaugeBonus ?? 0)) * (skill.gaugeMultiplier ?? 1);
    if (skill.kind === 'normal') gain *= 1 + p.normalGaugePenalty;
    const got = this.deck.addGauge(gain, randomStream(this.rng, 'cardDraw'));
    this.cardsDrawn += got.length;
    this.cardDraws.gauge += got.length;
    const q = skill.quickDraw;
    if (q && (q.trigger === 'each' || (q.trigger === 'first' ? firstHit : lastHit))) {
      // 개별 직접 적중은 1회, 합산 적중은 선택 트포의 판정 수만큼 추첨합니다. 도트는 포함하지 않습니다.
      const attempts = skill.hitSequence ? 1 : q.attempts;
      for (let i = 0; i < attempts; i++) if (randomStream(this.rng, 'quickDraw', skill.id).chance(q.chance)) this.drawCards(1, undefined, 'quickDraw');
    }
    if (skill.id === 'the_sun' && lastHit && skill.hiddenHandChance !== undefined && randomStream(this.rng, 'hiddenHand', skill.id).chance(skill.hiddenHandChance)) {
      this.drawCards(1, undefined, 'hiddenHand');
    }
    if (skill.id === 'dancing_of_spineflower' && lastHit && skill.flowerThornChance !== undefined && randomStream(this.rng, 'flowerThorn', skill.id).chance(skill.flowerThornChance)) {
      this.drawCards(1, undefined, 'flowerThorn');
    }
    this.triggerHitRune(skill);
    // S100 사용자 관측에 따른 후보. 폭발·연속 타격을 중복 집계하지 않습니다.
    if (this.build.ruinFullset && firstHit && skill.hits > 0 && this.isRuin(skill)) {
      if (++this.fullsetHits === 4) { this.fullsetHits = 0; this.triggerDestiny(); }
    }
  }

  private isRuin(s: SkillDef): boolean {
    return s.kind === 'ruin' || !!s.tags?.includes('ruin');
  }

  /**
   * 다음 행동 선택 (docs/mechanics.md §4.4 로봇 정책).
   * 황제는 일반 스킬·더 썬을 스택과 무관하게 먼저 선택합니다.
   * 1) 4스택 또는 심판 중: 루인(도태 중이면 도태 순서). 운명의 부름이 준비돼 있고 치피 버프가 없으면 먼저 운부.
   *    준비된 루인이 없으면 기다립니다. 수레바퀴로 현재 쿨을 건너뛸 수 없습니다.
   * 2) 4스택 미만: 넘치지 않게 스택 스킬 선택. 2스택이면 피니셔(운부)로 4스택+버프.
   * 3) 스택 스킬이 전부 쿨이고 루인이 준비돼 있으면 심판 사용(있을 때).
   * 4) 0스택 + 할 게 없으면 포 카드 낚시.
   * 루인을 4스택 미만에서 던지는 일은 없다.
   */
  chooseAction(): SkillDef | null {
    // 두 번째 설치를 다음 행동으로 우선합니다. 시전 중 끼워 넣기·최적 운용은 미모델입니다.
    if (this.evokeChain && this.isReady(this.evokeChain.skill.id)) return this.evokeChain.skill;
    const r = this.build.rotation;
    const ready = (ids: string[] | undefined) => (ids ?? []).map((id) => this.skill(id)).filter((s) => this.isReady(s.id));
    const cull = this.buffs.has('cull_rate', this.now);
    const ruinOrder = cull && r.cullRuinPriority ? r.cullRuinPriority : r.ruinPriority;
    const judgment = this.judgmentActive();

    // 황제의 일반 스킬·더 썬은 스택을 소모하지 않으므로 4스택 분기 전에 선택합니다.
    if (this.build.variant === 'emperor') {
      const normals = ready(r.fillers);
      const setup = r.setupSkill ? this.skill(r.setupSkill) : null;
      if (normals.length && setup && this.isReady(setup.id) && setup.onHit?.some(e =>
        (e.id === 'arcana_crit_damage' || e.id === 'arcana_crit_resistance') && !this.buffs.has(e.id, this.now))) return setup;
      const critSetup = r.critSetupSkill ? this.skill(r.critSetupSkill) : null;
      if (normals.length && !cull && critSetup && this.isReady(critSetup.id) && critSetup.onHit?.some(e =>
        e.id === 'darkness_edge' && e.mod.bucket === 'critRate' && e.mod.value > 0 && !this.buffs.has(e.id, this.now))) return critSetup;
      if (normals.length) return normals[0]!;
    }

    // 1) 4스택 / 심판
    if (this.stacks >= MAX_STACKS || judgment) {
      const fin = r.finisher ? this.skill(r.finisher) : null;
      if (fin && !judgment && this.isReady(fin.id) && [...(fin.onCast ?? []), ...(fin.onHit ?? [])].some((e) => !this.buffs.has(e.id, this.now))) return fin;
      const ruins = ready(ruinOrder);
      if (ruins.length) return ruins[0]!;
      return null; // 루인 쿨 대기
    }

    // 2) 스택 쌓기: 넘치지 않는 조합 우선
    const need = MAX_STACKS - this.stacks;
    const fin = r.finisher ? this.skill(r.finisher) : null;
    if (fin && this.isReady(fin.id) && (fin.stacksGranted ?? 0) >= need) return fin;
    const stackers = ready(r.stackPriority).filter((s) => s.id !== r.finisher);
    const fit = stackers.filter((s) => (s.stacksGranted ?? 0) <= need);
    if (fit.length) return fit.sort((a, b) => (b.stacksGranted ?? 0) - (a.stacksGranted ?? 0))[0]!;
    if (stackers.length) return stackers[0]!;
    if (fin && this.isReady(fin.id)) return fin;

    // 3) 심판: 스택 스킬이 전부 쿨 + 루인 준비
    if (this.deck.hand.includes('judgment') && ready(ruinOrder).length) {
      this.useCardNow('judgment');
      return ready(ruinOrder)[0]!;
    }

    // 4) 일반 스킬 필러(황제) — 쿨마다
    const fillers = ready(r.fillers);
    if (fillers.length) return fillers[0]!;

    // 5) 0스택 낚시
    if (this.stacks === 0) {
      const fish = ready(r.fishing);
      if (fish.length) return fish[0]!;
    }
    return null;
  }

  run(duration: number): SimRunResult {
    while (this.now < duration) {
      this.flushInstantCards();
      const action = this.chooseAction();
      if (!action) {
        this.advanceTo(Math.min(this.now + 0.1, duration,
          ...[...this.readyAt.values()].filter(at => at > this.now),
          this.buffs.nextExpiryAfter(this.now),
          this.pendingHits[0]?.at ?? Infinity, this.evokeChain?.expiresAt ?? Infinity,
          this.evokeChain && this.now < this.evokeChain.availableAt ? this.evokeChain.availableAt : Infinity,
          this.nextPoisonTime(), this.nextChargeTime(), this.pendingRuinCooldowns[0]?.at ?? Infinity));
        continue;
      }
      if (this.isRuin(action) && (this.stacks > 0 || this.judgmentActive())) {
        const readyRuins = this.build.rotation.ruinPriority.filter((id) => this.isReady(id)).length;
        this.playHeldCardsForRuin(readyRuins, action.id === 'the_devil');
      }
      const emperorCardsAfterStart = this.build.variant === 'emperor' && (this.build.normalEnhanceCooldown ?? 0) > 0 &&
        ['the_sun', 'unlimited_shuffle'].includes(action.id) && skillMatches({ kinds: ['normal'] }, action);
      if (this.build.variant === 'emperor' && !emperorCardsAfterStart) this.playHeldCardsForEmperor(action);
      const wheelTargets = this.build.rotation.wheelTargets ?? this.build.rotation.ruinPriority;
      const startsCooldown = (!action.splitEvoke && !action.manualEvoke) || this.evokeChain?.skill.id === action.id;
      if (startsCooldown && wheelTargets.includes(action.id) && this.deck.hand.includes('wheel_of_fortune')) this.useCardNow('wheel_of_fortune');
      this.cast(action, duration, 'auto', emperorCardsAfterStart);
    }
    return {
      totalDamage: this.total,
      dps: this.total / duration,
      cardsDrawn: this.cardsDrawn,
      cardsUsed: this.cardsUsed,
      cardsHeldAtEnd: this.deck.hand.length,
      cardDraws: { ...this.cardDraws },
      ruinCasts: this.ruinCasts,
      ruinAt4: this.ruinAt4,
      breakdown: [...this.breakdown.values()],
    };
  }
}

export function runOnce(build: Build, cards: CardDef[], seed: number, duration: number, randomMode?: RandomMode): SimRunResult {
  return new SimState(build, createRng(seed, randomMode), cards).run(duration);
}

export function simulate(build: Build, cards: CardDef[], cfg: SimConfig): SimSummary {
  if (!validRandomMode(cfg.randomMode)) throw new Error('지원하지 않는 난수 방식입니다.');
  if (!Number.isFinite(cfg.durationSec) || cfg.durationSec <= 0) throw new RangeError('전투 시간은 0보다 큰 유한한 수여야 합니다.');
  if (!Number.isSafeInteger(cfg.iterations) || cfg.iterations < 1) throw new RangeError('반복 수는 1 이상의 안전한 정수여야 합니다.');
  if (!Number.isSafeInteger(cfg.seed)) throw new RangeError('시드는 안전한 정수여야 합니다.');
  const samples: number[] = [];
  let cards_ = 0;
  let cardsUsed = 0;
  let cardsHeldAtEnd = 0;
  const cardDraws = emptyCardDraws();
  let ruin = 0;
  let ruin4 = 0;
  const agg = new Map<string, SkillBreakdown>();
  for (let i = 0; i < cfg.iterations; i++) {
    const seed = ((cfg.seed >>> 0) + Math.imul(i, 7919)) >>> 0;
    const r = runOnce(build, cards, seed, cfg.durationSec, cfg.randomMode);
    samples.push(r.dps);
    cards_ += r.cardsDrawn;
    cardsUsed += r.cardsUsed;
    cardsHeldAtEnd += r.cardsHeldAtEnd;
    for (const source of Object.keys(cardDraws) as CardDrawSource[]) cardDraws[source] += r.cardDraws[source];
    ruin += r.ruinCasts;
    ruin4 += r.ruinAt4;
    for (const b of r.breakdown) {
      const a = agg.get(b.id) ?? { ...b, casts: 0, direct: 0, stackEffect: 0, ...(b.dot !== undefined ? { dot: 0 } : {}) };
      a.casts += b.casts;
      a.direct += b.direct;
      a.stackEffect += b.stackEffect;
      if (b.dot !== undefined) a.dot = (a.dot ?? 0) + b.dot;
      agg.set(b.id, a);
    }
  }
  const n = cfg.iterations;
  return {
    build: build.name,
    ...(cfg.randomMode === 'partitioned-v1' ? { randomMode: cfg.randomMode } : {}),
    damageWarnings: damageWarnings(build),
    cardSupplyWarnings: cardSupplyWarnings(build),
    iterations: n,
    durationSec: cfg.durationSec,
    dps: summarize(samples),
    cardsPerMin: (cards_ / n / cfg.durationSec) * 60,
    cardsUsedPerMin: (cardsUsed / n / cfg.durationSec) * 60,
    cardsHeldAtEnd: cardsHeldAtEnd / n,
    cardsPerMinBySource: Object.fromEntries(Object.entries(cardDraws).map(([source, count]) => [source, count / n / cfg.durationSec * 60])) as Record<CardDrawSource, number>,
    ruinAt4Rate: ruin ? ruin4 / ruin : 0,
    breakdown: [...agg.values()].map((b) => ({ ...b, casts: b.casts / n, direct: b.direct / n, stackEffect: b.stackEffect / n,
      ...(b.dot !== undefined ? { dot: b.dot / n } : {}) })).sort((a, b) => b.direct + b.stackEffect + (b.dot ?? 0) - (a.direct + a.stackEffect + (a.dot ?? 0))),
    samples,
  };
}
