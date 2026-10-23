import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { createRng } from '../rng';
import { SimState } from '../sim';
import { defaultRotation } from '../rotation';

function state() {
  const r = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
  const raw: RawArmory = { profiles: r.profiles.data, combatSkills: r['combat-skills'].data, equipment: r.equipment.data,
    arkpassive: r.arkpassive.data, arkgrid: r.arkgrid.data, engravings: r.engravings.data, gems: r.gems.data };
  const build = buildFromArmory(raw).build;
  // 리턴만의 조건 검사입니다. 리턴→스트림 통합 시작은 emperor-stream-setup에서 검사합니다.
  delete build.rotation.critSetupSkill;
  return new SimState(build, createRng(1), []);
}
function buff(sim: SimState, id: string) {
  sim.applyBuff({ id, duration: 10, mod: { bucket: 'critDmg', value: 0, source: '통제' } });
}
describe('Emperor first-hit setup policy', () => {
  it('uses Return before an available Sun on the opening', () => {
    const sim = state(); expect(sim.chooseAction()?.id).toBe('return');
    sim.cast(sim.chooseAction()!, 10);
    expect(sim.buffs.has('arcana_crit_damage', sim.now)).toBe(true);
    expect(sim.buffs.has('arcana_crit_resistance', sim.now)).toBe(true);
    expect(sim.chooseAction()?.id).toBe('the_sun');
  });
  it.each(['arcana_crit_damage', 'arcana_crit_resistance'])('renews the setup if only %s is active', active => {
    const sim = state(); buff(sim, active); expect(sim.chooseAction()?.id).toBe('return');
  });
  it('does not preempt a primary skill when both shared buffs are already active', () => {
    const sim = state(); buff(sim, 'arcana_crit_damage'); buff(sim, 'arcana_crit_resistance');
    expect(sim.chooseAction()?.id).toBe('the_sun');
  });
  it('does not wait for unavailable Return while a primary skill is ready', () => {
    const sim = state(); sim.readyAt.set('return', 10); expect(sim.chooseAction()?.id).toBe('the_sun');
  });
  it('does not pretend an unselected or unparsed buff exists', () => {
    const sim = state(); sim.build.skills.find(s => s.id === 'return')!.onHit = [];
    sim.build.rotation = defaultRotation('emperor', sim.build.skills);
    delete sim.build.rotation.critSetupSkill;
    expect(sim.chooseAction()?.id).toBe('the_sun');
  });
  it('keeps the old ordering for an explicitly supplied rotation with no setup policy', () => {
    const sim = state(); sim.build.rotation = { ruinPriority: [], stackPriority: [], fillers: ['the_sun', 'return'] };
    expect(sim.chooseAction()?.id).toBe('the_sun');
  });
  it('does not select a missing Return', () => {
    const sim = state(); sim.build.skills = sim.build.skills.filter(s => s.id !== 'return');
    sim.build.rotation = defaultRotation('emperor', sim.build.skills);
    delete sim.build.rotation.critSetupSkill;
    expect(sim.chooseAction()?.id).toBe('the_sun');
  });
});
