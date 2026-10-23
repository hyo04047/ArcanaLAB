import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { createRng } from '../rng';
import { defaultRotation } from '../rotation';
import { SimState } from '../sim';

function state() {
  const r = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
  const raw: RawArmory = { profiles: r.profiles.data, combatSkills: r['combat-skills'].data, equipment: r.equipment.data,
    arkpassive: r.arkpassive.data, arkgrid: r.arkgrid.data, engravings: r.engravings.data, gems: r.gems.data };
  const sim = new SimState(buildFromArmory(raw).build, createRng(1), []);
  for (const id of ['arcana_crit_damage', 'arcana_crit_resistance']) sim.applyBuff({ id, duration: 10,
    mod: { bucket: 'critDmg', value: 0, source: '리턴 준비 완료 통제' } });
  return sim;
}

describe('Emperor Stream crit-buff setup', () => {
  it.each([0, 2, 4])('prepares Stream at %s stacks before a ready primary', stacks => {
    const s = state(); s.stacks = stacks;
    expect(s.chooseAction()?.id).toBe('stream_of_edge');
  });
  it('starts the primary once the existing Stream hit grants its buff', () => {
    const s = state(); s.cast(s.skill('stream_of_edge'), 10);
    expect(s.buffs.has('darkness_edge', s.now)).toBe(true);
    expect(s.chooseAction()?.id).toBe('the_sun');
  });
  it('refreshes after expiration even with four enemy stacks', () => {
    const s = state(); s.stacks = 4;
    s.applyBuff({ id: 'darkness_edge', duration: 1, mod: { bucket: 'critRate', value: 0.276, source: '통제' } });
    expect(s.chooseAction()?.id).toBe('the_sun'); s.advanceTo(1);
    expect(s.chooseAction()?.id).toBe('stream_of_edge');
  });
  it('does not wait for a cooling Stream', () => {
    const s = state(); s.readyAt.set('stream_of_edge', 10); expect(s.chooseAction()?.id).toBe('the_sun');
  });
  it('skips crit preparation while Cull is active', () => {
    const s = state(); s.drawCards(1, 'cull'); s.useCardNow('cull');
    expect(s.chooseAction()?.id).toBe('the_sun');
  });
  it('does not refresh a still-active Darkness Edge early', () => {
    const s = state(); s.applyBuff({ id: 'darkness_edge', duration: 0.01,
      mod: { bucket: 'critRate', value: 0.0552, source: '통제' } });
    expect(s.chooseAction()?.id).toBe('the_sun');
  });
  it.each(['absent', 'zero'])('requires a parsed positive crit buff: %s', mode => {
    const s = state(); const stream = s.skill('stream_of_edge');
    if (mode === 'absent') stream.onHit = []; else stream.onHit![0]!.mod.value = 0;
    s.build.rotation = defaultRotation('emperor', s.build.skills);
    expect(s.chooseAction()?.id).toBe('the_sun');
  });
  it('preserves explicit rotations that do not request crit preparation', () => {
    const s = state(); s.build.rotation = { ruinPriority: [], stackPriority: ['stream_of_edge'], fillers: ['the_sun'] };
    expect(s.chooseAction()?.id).toBe('the_sun');
  });
  it('does not force the setup when every primary is unavailable', () => {
    const s = state(); s.stacks = 4;
    // 충전형 쇄도의 남은 충전과 분리하여 단일 일반기 대기 상태를 만듭니다.
    s.build.rotation.fillers = ['the_sun'];
    for (const id of s.build.rotation.fillers!) s.readyAt.set(id, 10);
    expect(s.chooseAction()).toBeNull();
  });
  it('preserves Return preparation before Stream on the opening', () => {
    const s = state(); s.removeBuff('arcana_crit_damage'); s.removeBuff('arcana_crit_resistance');
    expect(s.chooseAction()?.id).toBe('return'); s.cast(s.chooseAction()!, 10);
    expect(s.chooseAction()?.id).toBe('stream_of_edge');
  });
  it('does not apply Emperor setup to an Empress rotation', () => {
    const s = state(); s.build.variant = 'empress'; s.build.rotation = defaultRotation('empress', s.build.skills);
    s.stacks = 4; expect(s.chooseAction()).toBeNull();
  });
});
