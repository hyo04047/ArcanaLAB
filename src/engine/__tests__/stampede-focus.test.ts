import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { createRng } from '../rng';
import { SimState } from '../sim';

const records = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records;
function input(selected = ['쇄도 집중'], level = 10): RawArmory {
  const raw = Object.fromEntries(records[0].responses.map((r: { endpoint: string; body: string }) =>
    [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as RawArmory;
  const skill = raw.combatSkills.find(s => s.Name === '신비한 쇄도')!;
  skill.Level = level; skill.Rune = null;
  skill.Tripods!.forEach(t => t.IsSelected = selected.includes(t.Name));
  return { ...raw, combatSkills: [skill], arkpassive: null, arkgrid: null, engravings: null, gems: null, equipment: null, cards: null };
}

describe('Stampede Focus basic two-hit candidate', () => {
  it.each([[1, 7.0714, 425.3], [10, 9.1906, 1689.3], [14, 11.2304, 1689.3], [20, 15.5756, 1689.3]])(
    'applies 40/80 percent to separate flat and AP terms at level %s', (level, coefficient, flat) => {
      const { build, warnings } = buildFromArmory(input(['쇄도 집중'], level));
      const skill = build.skills[0]!;
      expect(skill.directCoef).toBeCloseTo(coefficient!); expect(skill.directFlat).toBeCloseTo(flat!);
      expect(skill.hits).toBe(2);
      expect(skill.mods?.some(m => m.source === '쇄도 집중')).toBe(false);
      for (const atkBase of [0, 10000, 20000]) {
        const sim = new SimState({ ...build, passiveMods: [], onCardUse: [], onDestiny: [],
          params: { ...build.params, atkBase } }, createRng(1), []);
        sim.cast(skill, 10);
        expect(sim.breakdown.get(skill.id)!.direct).toBeCloseTo(flat! + coefficient! * atkBase);
      }
      expect(warnings.some(w => w.includes('쇄도 집중') && w.includes('후보') && w.includes('시전 종료'))).toBe(true);
    });
  it('reads the displayed increase instead of fixing every input at 40 percent', () => {
    const raw = input(); raw.combatSkills[0]!.Tripods!.find(t => t.Name === '쇄도 집중')!.Tooltip = '매 판정마다 적에게 주는 피해가 20.0% 씩 증가한다.';
    const skill = buildFromArmory(raw).build.skills[0]!;
    expect(skill.directCoef).toBeCloseTo(7.4318); expect(skill.directFlat).toBeCloseTo(1365.9);
  });
  it.each([undefined, '', '매 판정마다 적에게 주는 피해가 NaN% 씩 증가한다.',
    '매 판정마다 적에게 주는 피해가 Infinity% 씩 증가한다.', '매 판정마다 적에게 주는 피해가 -40% 씩 증가한다.',
    `매 판정마다 적에게 주는 피해가 ${'9'.repeat(400)}% 씩 증가한다.`,
    '매 판정마다 적에게 주는 피해가 40.0% 씩 증가한다. 특정 조건에서만 적용된다.'])('rejects incomplete or changed focus text: %s', text => {
    const raw = input(); raw.combatSkills[0]!.Tripods!.find(t => t.Name === '쇄도 집중')!.Tooltip = text;
    const result = buildFromArmory(raw), skill = result.build.skills[0]!;
    expect(skill.directCoef).toBeCloseTo(5.673); expect(skill.directFlat).toBe(1042.5);
    expect(result.warnings.some(w => w.includes('쇄도 집중') && w.includes('해석 못함'))).toBe(true);
  });
  it.each([1.5, 21])('does not multiply an unsupported-level fallback at %s', level => {
    const result = buildFromArmory(input(['쇄도 집중'], level));
    const baseline = buildFromArmory(input(['회피의 달인'], level)).build.skills[0]!;
    expect(result.build.skills[0]!.directCoef).toBe(baseline.directCoef);
    expect(result.build.skills[0]!.directFlat).toBe(baseline.directFlat);
    expect(result.warnings.some(w => w.includes('쇄도 집중') && w.includes('지원 레벨') && w.includes('미반영'))).toBe(true);
  });
  it('does not partially apply focus to the unsupported third-attack variant', () => {
    const result = buildFromArmory(input(['쇄도 집중', '연속 공격']));
    expect(result.build.skills[0]!.directCoef).toBeCloseTo(5.673);
    expect(result.build.skills[0]!.directFlat).toBe(1042.5);
    expect(result.warnings.some(w => w.includes('쇄도 집중') && w.includes('연속 공격') && w.includes('미반영'))).toBe(true);
  });
  it('preserves first-hit Quick Draw, charges, cooldown and the existing action duration', () => {
    const base = buildFromArmory(input(['퀵 드로', '신비한 전략'])).build.skills[0]!;
    const focused = buildFromArmory(input(['퀵 드로', '신비한 전략', '쇄도 집중'])).build.skills[0]!;
    expect(focused.quickDraw).toEqual({ chance: 0.3, trigger: 'first', attempts: 1 });
    expect(focused.maxCharges).toBe(2); expect(focused.cooldown).toBe(14);
    expect(focused.castTime).toBe(base.castTime);
    expect(focused.hitSequence).toBeUndefined(); expect(focused.delayedHits).toBeUndefined();
    expect(focused.directCoef).toBeCloseTo(9.1906);
  });
});
