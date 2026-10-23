import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardSupplyWarnings } from '../cards';
import { cardsFor } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function input(): RawArmory {
  return { profiles: load('tests/fixtures/armory/FixtureCharacter26/profiles.json'), combatSkills: [], arkgrid: null, engravings: null, gems: null,
    arkpassive: { Effects: [load('tests/fixtures/audit/2026-10-13-another-emperor-sources.json').official.node] } };
}
function state(proc = true, damage = true) {
  const { build } = buildFromArmory(input());
  build.passiveMods = []; build.bluntThorn = undefined; build.onCardUse = []; build.onDestiny = []; build.skills = [];
  build.params.atkBase = 100; build.params.cardDamageCoef = damage ? { emperor: 2 } : {};
  build.params.cardDamageFlat = damage ? { emperor: 30 } : {};
  const chance = vi.fn((p: number) => p === 0.2 ? proc : p >= 1);
  return new SimState(build, { ...createRng(42), chance }, cardsFor('emperor', { add: ['empress_knight'] }));
}
const play = (s: SimState, id: string) => { s.drawCards(1, id); s.useCardNow(id); };
const attempts = (s: SimState) => vi.mocked(s.rng.chance).mock.calls.filter(([p]) => p === 0.2).length;

describe('Another Emperor triggers independently of card use', () => {
  it('reads the complete current tooltip and keeps the provisional addition explicit', () => {
    const { build, warnings } = buildFromArmory(input());
    expect(build.anotherEmperorChance).toBe(0.2);
    expect(build.passiveMods.filter(m => m.source.startsWith('또 다른 황제'))).toEqual([
      { bucket: 'dmgToEnemy', value: 0.16, source: '또 다른 황제 Lv3' },
      { bucket: 'emperorCardDmg', value: 0.4, filter: { ids: ['card_emperor'] }, source: '또 다른 황제 Lv3' },
    ]);
    expect(warnings.some(w => w.includes('40%') && w.includes('합연산 후보'))).toBe(true);
    expect(cardSupplyWarnings(build).some(w => w.includes('또 다른 황제') && w.includes('미검증'))).toBe(true);
    expect(build.params.cardDamageCoef).toEqual({});
  });
  it('reads supplied probabilities instead of deriving them from the node level', () => {
    const raw = input(), node = raw.arkpassive!.Effects[0]!;
    node.ToolTip = node.ToolTip!.replace('20.0%', '17.0%');
    expect(buildFromArmory(raw).build.anotherEmperorChance).toBe(0.17);
  });
  it.each(['condition', 'missing', 'invalid-probability', 'name'])('rejects unsupported text: %s', change => {
    const raw = input(), node = raw.arkpassive!.Effects[0]!;
    if (change === 'condition') node.ToolTip = node.ToolTip!.replace('적에게 주는 피해가', '생명력이 50% 이하일 때 적에게 주는 피해가');
    if (change === 'missing') node.ToolTip = undefined;
    if (change === 'invalid-probability') node.ToolTip = node.ToolTip!.replace('20.0%', '120.0%');
    if (change === 'name') node.Description = node.Description.replace('또 다른 황제', '알 수 없는 패시브');
    const { build, warnings } = buildFromArmory(raw);
    expect(build.anotherEmperorChance).toBeUndefined();
    expect(build.passiveMods.some(m => m.source.startsWith('또 다른 황제'))).toBe(false);
    expect(warnings.some(w => w.includes('해석 못함'))).toBe(true);
  });
  it('ignores missing cards and acquisition, then rolls once for the actual use', () => {
    const s = state(); s.useCardNow('star'); s.drawCards(1, 'star'); expect(attempts(s)).toBe(0);
    s.useCardNow('star'); expect(attempts(s)).toBe(1); expect(s.total).toBe(230);
    expect(s.breakdown.get('card_emperor_proc')).toMatchObject({ casts: 1, direct: 230 });
    expect(s.breakdown.has('card_emperor')).toBe(false); expect(s.cardsDrawn).toBe(1);
  });
  it('does not deal extra damage when the roll fails', () => {
    const s = state(false); play(s, 'star'); expect(attempts(s)).toBe(1); expect(s.total).toBe(0);
  });
  it('does not roll on Emperor itself, and records its direct use separately', () => {
    const s = state(); play(s, 'emperor'); expect(attempts(s)).toBe(0);
    expect(s.breakdown.get('card_emperor')).toMatchObject({ casts: 1, direct: 230 });
    expect(s.breakdown.has('card_emperor_proc')).toBe(false);
  });
  it('uses Emperor gem and Edict filters without normal or Knight modifiers', () => {
    const s = state(); s.build.passiveMods = [
      { bucket: 'skillDmg', value: 0.44, filter: { ids: ['card_emperor'] }, source: 'gem' },
      { bucket: 'skillDmg', value: 0.8, filter: { ids: ['card_emperor'] }, source: 'edict' },
      { bucket: 'skillDmg', value: 9, filter: { kinds: ['normal'] }, source: 'normal' },
      { bucket: 'skillDmg', value: 9, filter: { ids: ['card_empress_knight'] }, source: 'knight' },
    ];
    play(s, 'star'); expect(s.total).toBeCloseTo(230 * 1.44 * 1.8);
  });
  it('applies the newly used Cull and Mercy before the provisional immediate proc', () => {
    const s = state(); s.build.onCardUse = [{ id: 'mercy', duration: 8, mod: { bucket: 'dmgToEnemy', value: 0.1, source: 'control' } }];
    play(s, 'cull'); expect(s.total).toBeCloseTo(230 * 2.5 * 1.1);
    expect(attempts(s)).toBe(1);
  });
  it('does not add extra Stack Hold uses, Mercy refreshes, Mayhem hits, or gauge', () => {
    const s = state(); s.build.stackHold = true;
    s.applyBuff({ id: 'mayhem_window', duration: 30, mod: { bucket: 'skillDmg', value: 0, source: '광기' } });
    s.build.onCardUse = [{ id: 'mercy', duration: 8, mod: { bucket: 'dmgToEnemy', value: 0.1, source: 'control' } }];
    const destiny = vi.spyOn(s, 'triggerDestiny'), buffs = vi.spyOn(s, 'applyBuff');
    play(s, 'star'); expect(destiny).not.toHaveBeenCalled();
    play(s, 'star'); expect(destiny).toHaveBeenCalledTimes(1);
    expect(buffs.mock.calls.filter(([e]) => e.id === 'mercy')).toHaveLength(2);
    expect(s.cardDraws.gauge).toBe(0); expect(s.buffs.has('mayhem_stack', s.now)).toBe(false);
  });
  it('preserves the Clown history and rolls only once for Royal even with a full hand', () => {
    const s = state(); play(s, 'star'); play(s, 'clown');
    expect(s.deck.hand).toEqual(['star']); expect(s.cardDraws.clown).toBe(1); expect(attempts(s)).toBe(2);
    s.useCardNow('star'); play(s, 'royal');
    expect(s.deck.hand).toHaveLength(2); expect(attempts(s)).toBe(4); expect(s.lastUsedCard()).toBe('royal');
  });
  it('includes Knight as another card without counting its extra draw as a use', () => {
    const s = state(); play(s, 'empress_knight');
    expect(attempts(s)).toBe(1); expect(s.cardDraws.empressKnight).toBe(1); expect(s.total).toBe(230);
  });
  it('still rolls with unknown zero card damage and leaves damage at zero', () => {
    const s = state(true, false); play(s, 'star'); expect(attempts(s)).toBe(1); expect(s.total).toBe(0);
  });
  it('does not add rolls for builds without the node', () => {
    const s = state(); delete s.build.anotherEmperorChance; play(s, 'star');
    expect(attempts(s)).toBe(0); expect(s.total).toBe(0);
  });
  it('does not recursively roll Chain Draw for the extra damage', () => {
    const s = state(); s.build.chainDraw = { chance: 1 };
    const destiny = vi.spyOn(s, 'triggerDestiny'); play(s, 'star');
    expect(destiny).toHaveBeenCalledTimes(1);
    expect(vi.mocked(s.rng.chance).mock.calls.filter(([p]) => p === 1)).toHaveLength(1);
    expect(attempts(s)).toBe(1);
  });
});
