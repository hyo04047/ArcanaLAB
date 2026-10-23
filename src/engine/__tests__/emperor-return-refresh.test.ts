import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { createRng } from '../rng';
import { defaultRotation } from '../rotation';
import { SimState } from '../sim';
import type { Build, SkillDef } from '../types';

function state(variant: Build['variant'] = 'emperor') {
  const build = empressInkomsu440();
  const ret: SkillDef = { id: 'return', name: '리턴', kind: 'normal', hits: 1, directCoef: 1, cooldown: 2, castTime: 0.5,
    onHit: [{ id: 'arcana_crit_damage', duration: 7, mod: { bucket: 'critDmg', value: 0.775, source: '통제' } },
      { id: 'arcana_crit_resistance', duration: 10, mod: { bucket: 'critRate', value: 0.1, source: '통제' } }] };
  const flower: SkillDef = { id: 'dancing_of_spineflower', name: '플라워', kind: 'normal', hits: 1,
    directCoef: 100, cooldown: 20, castTime: 1 };
  build.variant = variant; build.skills = [ret, flower]; build.rotation = defaultRotation(variant, build.skills);
  build.passiveMods = []; build.bluntThorn = undefined; build.onCardUse = []; build.onDestiny = []; build.onRuinAt4 = [];
  return new SimState(build, createRng(1), []);
}
function applyReturn(s: SimState) { for (const effect of s.skill('return').onHit!) s.applyBuff(effect); }

describe('Emperor Return refresh only when the selected buff is missing', () => {
  it('keeps Return as setup rather than a cooldown filler', () => {
    const s = state(); expect(s.build.rotation.setupSkill).toBe('return');
    expect(s.build.rotation.fillers).not.toContain('return');
  });
  it('uses Flower instead of ready Return when both buffs are active', () => {
    const s = state(); applyReturn(s); expect(s.chooseAction()?.id).toBe('dancing_of_spineflower');
  });
  it('does not refresh during idle time while the buffs remain active', () => {
    const s = state(); applyReturn(s); s.stacks = 4; s.readyAt.set('dancing_of_spineflower', 20);
    expect(s.chooseAction()).toBeNull();
  });
  it.each(['arcana_crit_damage', 'arcana_crit_resistance'])('prepares Return when %s is missing', id => {
    const s = state(); applyReturn(s); s.removeBuff(id); expect(s.chooseAction()?.id).toBe('return');
  });
  it('refreshes at expiration, not while the shorter buff is still active', () => {
    const s = state(); applyReturn(s); s.advanceTo(6.99); expect(s.chooseAction()?.id).toBe('dancing_of_spineflower');
    s.advanceTo(7); expect(s.chooseAction()?.id).toBe('return');
  });
  it('does not wait for cooling Return instead of casting a ready skill', () => {
    const s = state(); s.readyAt.set('return', 10); expect(s.chooseAction()?.id).toBe('dancing_of_spineflower');
  });
  it('keeps a Return without a selected common buff as a filler', () => {
    const s = state(); s.skill('return').onHit = []; s.build.rotation = defaultRotation('emperor', s.build.skills);
    expect(s.build.rotation.setupSkill).toBeUndefined(); expect(s.chooseAction()?.id).toBe('return');
  });
  it('preserves an explicitly supplied old filler order', () => {
    const s = state(); applyReturn(s); s.build.rotation.fillers = ['return', 'dancing_of_spineflower'];
    expect(s.chooseAction()?.id).toBe('return');
  });
  it('preserves Empress filler behavior', () => {
    const s = state('empress'); applyReturn(s); expect(s.build.rotation.fillers).toContain('return');
    expect(s.chooseAction()?.id).toBe('return');
  });
});
