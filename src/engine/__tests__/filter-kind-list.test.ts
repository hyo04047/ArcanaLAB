import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { SimState } from '../sim';
import type { Modifier, SkillDef } from '../types';

function fixture(value: unknown, field: 'kinds' | 'excludeKinds', target: string) {
  const build = empressInkomsu440(); build.bluntThorn = undefined; build.onRuinAt4 = []; build.onDestiny = [];
  const mod: Modifier = { bucket: target === 'damage' ? 'dmgToEnemy' : 'cooldown', value: target === 'damage' ? 1 : 0.5,
    source: '분류 목록 통제', filter: { [field]: value } as Modifier['filter'] };
  build.passiveMods = [mod];
  const skill: SkillDef = { id: 'control', name: '분류 목록 통제', kind: 'normal', cooldown: 10, castTime: 0.5, hits: 1, directCoef: 1 };
  build.skills = [skill]; build.params.atkBase = 1; build.params.gaugePerHit.normal = 0; build.params.gaugePerHit.hyper_awakening = 0;
  const state = new SimState(build, createRng(1), []);
  return { state, skill, mod, perform: () => target === 'damage' ? state.hit(skill, state.breakdown.get('control')!) : state.cast(skill, 20) };
}

describe.each(['damage', 'cooldown'])('%s category list', target => {
  describe.each(['kinds', 'excludeKinds'] as const)('%s', field => {
    it.each([null, false, 0, '', 'normal', {}, [null], [1]].map(value => ({ value })))('rejects $value', ({ value }) => {
      const { state, perform } = fixture(value, field, target);
      expect(perform).toThrow('스킬 분류'); expect(state.total).toBe(0); expect(state.readyAt.size).toBe(0);
    });
    it.each([
      { value: undefined, included: true, excluded: true },
      { value: [], included: false, excluded: true },
      { value: ['normal'], included: true, excluded: false },
      { value: ['ruin'], included: false, excluded: true },
      { value: ['future-kind'], included: false, excluded: true },
      { value: ['normal', 'normal'], included: true, excluded: false },
    ])('preserves $value', ({ value, included, excluded }) => {
      const { state, perform } = fixture(value, field, target); perform();
      const matches = field === 'kinds' ? included : excluded;
      if (target === 'damage') expect(state.total).toBe(matches ? 2 : 1);
      else expect(state.readyAt.get('control')).toBe(matches ? 5 : 10);
    });
    it('checks a list changed before the next application', () => {
      const { state, mod, perform } = fixture(['normal'], field, target); perform(); state.advanceTo(11);
      mod.filter![field] = 'normal' as unknown as SkillDef['kind'][];
      expect(perform).toThrow('스킬 분류');
    });
  });
  it('leaves exclusion data unused after the inclusion condition excludes the skill', () => {
    const { state, mod, perform } = fixture(null, 'excludeKinds', target); mod.filter!.kinds = ['ruin']; perform();
    if (target === 'damage') expect(state.total).toBe(1); else expect(state.readyAt.get('control')).toBe(10);
  });
  it('preserves OR inclusion and category exclusion priority for a T skill', () => {
    const { state, skill, mod, perform } = fixture(['normal', 'hyper_awakening'], 'kinds', target);
    skill.kind = 'hyper_awakening'; skill.tags = ['normal', 'ruin']; mod.filter!.excludeKinds = ['ruin']; perform();
    if (target === 'damage') expect(state.total).toBe(1); else expect(state.readyAt.get('control')).toBe(10);
  });
});

it('checks category lists supplied by an active cooldown buff', () => {
  const { state, mod, perform } = fixture(null, 'kinds', 'cooldown'); state.build.passiveMods = [];
  state.applyBuff({ id: 'bad', duration: 1, mod }); expect(perform).toThrow('스킬 분류'); expect(state.readyAt.size).toBe(0);
});
