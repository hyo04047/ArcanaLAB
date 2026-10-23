import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createRng, randomStream } from '../rng';
import { cardsFor, empressInkomsu440 } from '../presets';
import { SimState, simulate } from '../sim';
import type { Build, SkillDef } from '../types';

const source = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-19-armory-refresh.json', 'utf8')) as { conversions: { build: Build }[] };

it('retains the legacy generator and mock identity when no stream mode is requested', () => {
  const first = createRng(42), second = createRng(42, 'legacy');
  expect(randomStream(first, 'crit', 'skill')).toBe(first);
  expect(Array.from({ length: 100 }, () => first.next())).toEqual(Array.from({ length: 100 }, () => second.next()));
});
it('keeps each stream independent of allocation order and extra draws elsewhere', () => {
  const left = createRng(42, 'partitioned-v1'), right = createRng(42, 'partitioned-v1');
  for (let i = 0; i < 100; i++) randomStream(left, 'crit', 'a').next();
  expect(Array.from({ length: 100 }, () => randomStream(left, 'card').next()))
    .toEqual(Array.from({ length: 100 }, () => randomStream(right, 'card').next()));
  expect(randomStream(left, 'crit', 'b').next()).toBe(randomStream(right, 'crit', 'b').next());
  expect(randomStream(left, 'a/b', 'c').next()).not.toBe(randomStream(left, 'a', 'b/c').next());
});
it('preserves threshold gains without fixing success counts', () => {
  const low = randomStream(createRng(7, 'partitioned-v1'), 'quickDraw', 'a');
  const high = randomStream(createRng(7, 'partitioned-v1'), 'quickDraw', 'a');
  let lowCount = 0, highCount = 0;
  for (let i = 0; i < 10000; i++) {
    const a = low.chance(0.4), b = high.chance(0.6);
    expect(!a || b).toBe(true); lowCount += Number(a); highCount += Number(b);
  }
  expect(lowCount / 10000).toBeCloseTo(0.4, 1);
  expect(highCount / 10000).toBeCloseTo(0.6, 1);
  expect(highCount).toBeGreaterThan(lowCount);
});
it('changes with seed and retains valid uniform and categorical draws', () => {
  const first = randomStream(createRng(1, 'partitioned-v1'), 'a');
  const other = randomStream(createRng(2, 'partitioned-v1'), 'a');
  expect(first.next()).not.toBe(other.next());
  for (let i = 0; i < 1000; i++) { const u = first.next(); expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1); }
  expect(() => first.pick([])).toThrow('empty array');
  expect(['a', 'b']).toContain(first.pick(['a', 'b']));
});

const run = (build: Build, seed: number) => {
  const state = new SimState(build, createRng(seed, 'partitioned-v1'), cardsFor(build.variant, build.deckOverrides));
  const draw = state.deck.draw.bind(state.deck), cards: (string | null)[] = [];
  state.deck.draw = (rng, forcedId) => { const card = draw(rng, forcedId); cards.push(card); return card; };
  return { result: state.run(30), cards };
};
it.each(source.conversions.flatMap(({ build }) => [1, 42, 20261019].map(seed => ({ build, seed }))))
  ('removes the neutral-defense-roll coupling for $build.variant / $seed', ({ build, seed }) => {
    const changed = structuredClone(build);
    changed.skills.find(skill => !skill.defenseIgnore && skill.directCoef > 0)!.defenseIgnore = { chance: 0, fraction: 0 };
    const before = run(build, seed);
    expect(run(changed, seed)).toEqual(before);
    expect(run(build, seed)).toEqual(before);
  });
it('records the new mode and leaves legacy summaries unchanged', () => {
  const build = source.conversions[0]!.build, cards = cardsFor(build.variant, build.deckOverrides);
  const cfg = { durationSec: 1, iterations: 2, seed: 1 };
  expect(simulate(build, cards, cfg)).not.toHaveProperty('randomMode');
  expect(simulate(build, cards, { ...cfg, randomMode: 'partitioned-v1' }).randomMode).toBe('partitioned-v1');
});
it.each(['unknown', null, 1])('rejects an unknown random mode %j', randomMode => {
  const build = source.conversions[0]!.build;
  expect(() => simulate(build, cardsFor(build.variant, build.deckOverrides),
    { durationSec: 1, iterations: 1, seed: 1, randomMode } as never)).toThrow('난수 방식');
});

// 확률과 시전 수의 보존을 검사하는 합성 입력이며 실제 세팅 수치가 아닙니다.
function controlled(chance: number, cooldown = 4) {
  const base = empressInkomsu440();
  const skill: SkillDef = { id: 'draw', name: 'draw', kind: 'normal', cooldown, castTime: 1, directCoef: 10, hits: 1,
    quickDraw: { chance, trigger: 'each', attempts: 1 } };
  const build: Build = { ...base, skills: [skill], passiveMods: [], onDestiny: [], onRuinAt4: [],
    rotation: { ruinPriority: [], stackPriority: [], fillers: ['draw'] },
    params: { ...base.params, gaugePerHit: { normal: 0, stack: 0, ruin: 0, hyper_awakening: 0, awakening: 0 }, gaugeGainBonus: 0 } };
  return new SimState(build, createRng(42, 'partitioned-v1'), cardsFor('empress').filter(card => card.id === 'star'));
}
it('keeps higher Quick Draw success thresholds in real hit processing despite extra unrelated hits', () => {
  const low = controlled(0.4), high = controlled(0.6);
  const flags = [low, high].map((state, index) => Array.from({ length: 1000 }, () => {
    if (index) state.hit({ ...state.build.skills[0]!, id: 'extra', quickDraw: undefined }, { id: 'extra', name: 'extra', casts: 0, direct: 0, stackEffect: 0 });
    state.hit(state.build.skills[0]!, state.breakdown.get('draw')!);
    const drawn = state.deck.hand.length > 0;
    for (const id of [...state.deck.hand]) state.deck.use(id);
    return drawn;
  }));
  expect(flags[0]!.every((success, index) => !success || flags[1]![index])).toBe(true);
  expect(high.cardsDrawn).toBeGreaterThan(low.cardsDrawn);
});
it('retains cooldown gains as extra casts and card draws', () => {
  const slow = controlled(1, 4), fast = controlled(1, 2);
  slow.run(30); fast.run(30);
  expect(fast.breakdown.get('draw')!.casts).toBeGreaterThan(slow.breakdown.get('draw')!.casts);
  expect(fast.cardDraws.quickDraw).toBeGreaterThan(slow.cardDraws.quickDraw);
});
it('still excludes held cards, blocks full hands and allows forced duplicate cards', () => {
  const build = empressInkomsu440();
  const state = new SimState(build, createRng(42, 'partitioned-v1'), cardsFor('empress'));
  state.drawCards(2);
  expect(new Set(state.deck.hand).size).toBe(2);
  const held = [...state.deck.hand], drawn = state.cardsDrawn;
  state.drawCards(1); expect(state.cardsDrawn).toBe(drawn); expect(state.deck.hand).toEqual(held);
  state.deck.use(held[1]!); state.drawCards(1, held[0]);
  expect(state.deck.hand).toEqual([held[0], held[0]]);
});
