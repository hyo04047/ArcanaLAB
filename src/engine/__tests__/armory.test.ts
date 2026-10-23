import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor, empressInkomsu440 } from '../presets';
import { BuffManager } from '../buffs';
import { computeMultipliers } from '../damage';
import { runOnce } from '../sim';

const dir = resolve(__dirname, '../../../tests/fixtures/armory/FixtureCharacter26');
const load = (f: string) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
const raw: RawArmory = { profiles: load('profiles.json'), combatSkills: load('combat-skills.json'), arkpassive: load('arkpassive.json'), arkgrid: load('arkgrid.json'), engravings: load('engravings.json'), gems: load('gems.json') };

describe('armory converter (reference character)', () => {
  const { build, warnings } = buildFromArmory(raw);
  const skill = (id: string) => build.skills.find((s) => s.id === id)!;

  it('detects variant, stats, and equipped skills incl. hyper awakening', () => {
    expect(build.variant).toBe('empress');
    expect(build.stats).toEqual({ crit: 526, spec: 1735, swift: 227 });
    expect(build.skills.map((s) => s.id).sort()).toEqual(['call_of_destiny', 'celestial_rain', 'four_of_a_kind', 'scratch_dealer', 'secret_garden', 'serendipity', 'spiral_edge', 'stream_of_edge', 'the_devil'].sort());
  });

  it('maps tripods: fake flip → stack 2, serendipity proc crit, four of a kind reset, rain weak point', () => {
    expect(skill('call_of_destiny').kind).toBe('stack');
    expect(skill('call_of_destiny').stacksGranted).toBe(2);
    expect(skill('stream_of_edge').stacksGranted).toBe(3);
    expect(skill('spiral_edge').stacksGranted).toBe(2);
    expect(skill('serendipity').procCritDmg).toEqual({ chancePerStack: 0.2, value: 5.04 });
    expect(skill('serendipity').mods!.some((m) => m.bucket === 'skillDmg' && m.value > 5)).toBe(false);
    expect(skill('four_of_a_kind').cdResetChance).toBeCloseTo(0.55);
    expect(skill('four_of_a_kind').mods!.filter((m) => m.bucket === 'stackEffectDmg').length).toBe(0);
    expect(skill('celestial_rain').cooldown).toBe(17);
    expect(skill('spiral_edge').cooldown).toBe(9);
  });

  it('maps passives: engravings, evolution, enlightenment, cores, gems', () => {
    const src = (s: string) => build.passiveMods.filter((m) => m.source.startsWith(s));
    expect(src('원한')[0]!.value).toBeCloseTo(0.2625);
    expect(src('회심')[0]!.bucket).toBe('critHitDmg');
    expect(src('황후의 연회')[0]!.filter?.minStacks).toBe(4);
    expect(build.bluntThorn).toEqual({ base: 0.15, ratio: 1.5, cap: 0.75 });
    expect(build.onDestiny).toEqual(['drawCard']);
    expect(skill('stream_of_edge').tags).toContain('destiny');
    expect(src('젬').length).toBe(3);
    expect(build.cardDurationBonus).toEqual({ cull: 2, judgment: 2 });
  });

  it('runs in the simulator', () => {
    const r = runOnce(build, cardsFor(build.variant, build.deckOverrides), 5, 120);
    expect(r.totalDamage).toBeGreaterThan(0);
    expect(warnings.some(w => w.includes('미모델'))).toBe(true);
  });

  it('keeps edge combo damage only for the eight seconds after stream is used', () => {
    const source = '엣지 콤보 17P';
    for (const b of [build, empressInkomsu440()]) {
      const effects = b.skills.find(s => s.id === 'stream_of_edge')!.onCast!.filter(e => e.mod.source === source);
      expect(effects).toHaveLength(1);
      const buffs = new BuffManager();
      const mods = b.passiveMods.filter(m => m.source === source);
      const multiplier = (at: number) => computeMultipliers({ atkBase: 1 }, [...mods, ...buffs.modsAt(at)], {
        skill: skill('celestial_rain'), stacks: 4, component: 'direct',
      }).skillDmg;
      expect(multiplier(0)).toBe(1);
      buffs.apply(effects[0]!, 10);
      expect(multiplier(10)).toBeCloseTo(1.06);
      expect(multiplier(17.999)).toBeCloseTo(1.06);
      expect(multiplier(18)).toBe(1);
    }
  });

  it('keeps infinity deck conditional and reports the candidate timing limits', () => {
    expect(build.passiveMods.filter(m => m.source === '인피니티 덱 17P')).toEqual([]);
    expect(build.infinityDeck?.judgment).toEqual({ delay: 6, fraction: 0.15 });
    expect(build.infinityDeck?.balance).toMatchObject({ duration: 30, mod: { value: 0.02 } });
    expect(warnings.some(w => w.includes('인피니티 덱 17P') && w.includes('미검증'))).toBe(true);
  });

  it('reports omitted burn effects while retaining charges, hit stacks and flat attack', () => {
    for (const text of ['화상의 피해량이 150%']) {
      expect(warnings.some(w => w.includes(text)), text).toBe(true);
    }
    for (const b of [build, empressInkomsu440()]) {
      expect(b.skills.find(s => s.id === 'stream_of_edge')!.maxCharges).toBe(2);
      expect(b.skills.find(s => s.id === 'stream_of_edge')!.onCast!.some(e => e.mod.bucket === 'critDmg')).toBe(false);
      expect(b.skills.find(s => s.id === 'stream_of_edge')!.onHit!.some(e => e.mod.bucket === 'critDmg' && e.maxStacks === 5)).toBe(true);
    }
    expect(build.passiveMods.filter(m => m.source === '불타는 일격 17P')).toEqual([
      { bucket: 'dmgToEnemy', value: 0.02, source: '불타는 일격 17P' },
    ]);
    expect(build.passiveMods.filter(m => m.source === '공격 17P')).toEqual([
      { bucket: 'atk', value: 0.0165, source: '공격 17P' },
      { bucket: 'atkFlat', value: 2700, source: '공격 17P' },
    ]);
  });

  it('applies each supported clause of a combined core option once', () => {
    const mods = build.passiveMods.filter(m => m.source === '현란한 공격 17P');
    expect(mods.map(m => m.bucket)).toEqual(['dmgToEnemy', 'critHitDmg']);
    expect(mods[0]!.value).toBeCloseTo(0.01, 10);
    expect(mods[1]!.value).toBeCloseTo(0.0055, 10);
  });

  it.each([0.5, 0.8, 1, 1.2, 1.5])('matches imported and manual blunt thorn contribution at raw crit %s', crit => {
    const expected = 1 + Math.min(0.75, 0.15 + Math.max(0, crit - 0.8) * 1.5);
    for (const b of [build, empressInkomsu440()]) {
      const mods = [
        ...b.passiveMods.filter(m => m.source.startsWith('뭉툭한 가시')),
        { bucket: 'critRate' as const, value: crit, source: 'test' },
      ];
      const result = computeMultipliers({ atkBase: 1, bluntThorn: b.bluntThorn }, mods, { skill: skill('celestial_rain'), stacks: 4, component: 'direct' });
      expect(result.evoDmg).toBeCloseTo(expected);
    }
  });

  it('limits quads stack bonus to the devil at four stacks in both build paths', () => {
    for (const b of [build, empressInkomsu440()]) {
      const mods = b.passiveMods.filter(m => m.source.startsWith('쿼즈'));
      const mult = (id: string, stacks: number, component: 'direct' | 'stack') => computeMultipliers({ atkBase: 1 }, mods, {
        skill: b.skills.find(s => s.id === id)!, stacks, component,
      }).skillDmg;
      expect(mult('the_devil', 4, 'stack')).toBeCloseTo(1.2 * 1.2);
      expect(mult('the_devil', 3, 'stack')).toBeCloseTo(1.2);
      expect(mult('the_devil', 4, 'direct')).toBeCloseTo(1.2);
      expect(mult('celestial_rain', 4, 'stack')).toBe(1);
    }
  });

  it('uses the base stack count when the increase tripod is removed', () => {
    const input = structuredClone(raw);
    input.combatSkills.find(s => s.Name === '스파이럴 엣지')!.Tripods!.find(t => t.Name === '무자비한 사격')!.IsSelected = false;
    const converted = buildFromArmory(input).build;
    expect(converted.skills.find(s => s.id === 'spiral_edge')!.stacksGranted).toBe(1);
  });

  it('does not silently default the missing base of a partially parsed blunt thorn node', () => {
    const input = structuredClone(raw);
    const node = input.arkpassive!.Effects.find(e => e.Description.includes('뭉툭한 가시'))!;
    node.ToolTip = JSON.stringify({ value: '초과한 치명타가 발생할 확률의 150.0%가 진화형 피해로 전환됩니다. 이 노드에 의한 진화형 피해는 최대 75.0%까지 적용됩니다.' });
    const converted = buildFromArmory(input);
    expect(converted.build.bluntThorn).toBeUndefined();
    expect(converted.warnings.some(w => w.includes('뭉툭한 가시') && w.includes('해석 못함'))).toBe(true);
  });

  it('does not activate a core effect below its point requirement', () => {
    const input = structuredClone(raw);
    input.arkgrid!.Slots.find(s => s.Name.includes('엣지 콤보'))!.Point = 14;
    const converted = buildFromArmory(input).build;
    expect(converted.skills.find(s => s.id === 'stream_of_edge')!.onCast!.some(e => e.id === 'edge_combo')).toBe(false);
    expect(converted.passiveMods.some(m => m.source === '엣지 콤보 17P')).toBe(false);
  });

  it('does not strip unknown conditions from an otherwise recognizable damage phrase', () => {
    const input = structuredClone(raw);
    const text = '새로운 카드 사용 시 5초 동안 루인 스킬의 피해량이 20% 증가하고, 공격력이 10% 증가한다.';
    input.arkgrid = { Slots: [{ Index: 0, Name: '미지원 테스트', Point: 10, Tooltip: JSON.stringify({ value: `[10P] ${text}` }) }] };
    const converted = buildFromArmory(input);
    expect(converted.build.passiveMods.some(m => m.source === '미지원 테스트 10P')).toBe(false);
    expect(converted.warnings.some(w => w.includes(text))).toBe(true);
  });
});
