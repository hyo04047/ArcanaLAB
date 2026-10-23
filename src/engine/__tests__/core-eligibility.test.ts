import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

function input(emperor = true): RawArmory {
  if (emperor) {
    const r = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
    return { profiles: r.profiles.data, combatSkills: r['combat-skills'].data, equipment: r.equipment.data,
      arkpassive: r.arkpassive.data, arkgrid: r.arkgrid.data, engravings: r.engravings.data, gems: r.gems.data };
  }
  const load = (name: string) => JSON.parse(readFileSync('tests/fixtures/armory/FixtureCharacter26/' + name + '.json', 'utf8'));
  return { profiles: load('profiles'), combatSkills: load('combat-skills'), equipment: load('equipment'), arkpassive: load('arkpassive'),
    arkgrid: load('arkgrid'), engravings: load('engravings'), gems: load('gems') };
}
const coreMods = (build: ReturnType<typeof buildFromArmory>['build']) => build.passiveMods.filter(m => /^(노말 인핸스|스택 홀드|셔플 댄스) /.test(m.source));
describe('Official core activation requirements', () => {
  it('keeps eligible Emperor and Empress cores active', () => {
    const emperor = buildFromArmory(input()).build, empress = buildFromArmory(input(false)).build;
    expect(emperor.stackHold).toBe(true); expect(emperor.normalEnhanceCooldown).toBe(0.1);
    expect(empress.infinityDeck).toBeDefined();
    expect(empress.skills.find(s => s.id === 'stream_of_edge')!.maxCharges).toBe(2);
  });
  it.each(['황제의 칙령', '또 다른 황제'])('disables all three Emperor core options without %s', name => {
    const raw = input(); raw.arkpassive!.Effects = raw.arkpassive!.Effects.filter(e => !e.Description.includes(name));
    const { build, warnings } = buildFromArmory(raw);
    expect(build.stackHold).toBeUndefined(); expect(build.normalEnhanceCooldown).toBeUndefined(); expect(coreMods(build)).toEqual([]);
    expect(build.skills.find(s => s.id === 'dancing_of_spineflower')!.cooldown).toBe(20);
    expect(build.skills.find(s => s.id === 'unlimited_shuffle')!.cooldown).toBe(24);
    expect(warnings.some(w => w.includes(name) && w.includes('활성화 조건') && w.includes('미반영'))).toBe(true);
  });
  it.each(['황후의 은총', '황후의 속삭임'])('disables Empress core options without %s', name => {
    const raw = input(false); raw.arkpassive!.Effects = raw.arkpassive!.Effects.filter(e => !e.Description.includes(name));
    const { build } = buildFromArmory(raw);
    expect(build.infinityDeck).toBeUndefined();
    expect(build.skills.find(s => s.id === 'stream_of_edge')!.maxCharges).toBeUndefined();
    expect(build.onDestiny).toEqual([]);
  });
  it.each(['깨달음 4티어 또 다른 황제 Lv.0', '깨달음 4티어 또 다른 황제 Lv.9', '깨달음 3티어 또 다른 황제 Lv.3', '진화 4티어 또 다른 황제 Lv.3'])('does not accept an inactive or wrong-tier node: %s', text => {
    const raw = input(); raw.arkpassive!.Effects.find(e => e.Description.includes('또 다른 황제'))!.Description = text;
    expect(buildFromArmory(raw).build.stackHold).toBeUndefined();
  });
  it('does not assume eligibility when passive input is missing', () => {
    const raw = input(); raw.arkpassive = null;
    expect(buildFromArmory(raw).build.stackHold).toBeUndefined();
  });
  it('does not activate a class core whose requirement block is absent', () => {
    const raw = input(), slot = raw.arkgrid!.Slots.find(s => s.Name.endsWith('스택 홀드'))!;
    const tooltip = JSON.parse(slot.Tooltip!); delete tooltip.Element_006; slot.Tooltip = JSON.stringify(tooltip);
    const { build, warnings } = buildFromArmory(raw); expect(build.stackHold).toBeUndefined();
    expect(warnings.some(w => w.includes('조건 자료 없음'))).toBe(true);
  });
  it('rejects additional or incompatible activation requirements', () => {
    const raw = input(), slot = raw.arkgrid!.Slots.find(s => s.Name.endsWith('스택 홀드'))!;
    slot.Tooltip = slot.Tooltip!.replace('또 다른 황제 활성화 필요', '또 다른 황제 활성화 필요 및 추가 조건');
    expect(buildFromArmory(raw).build.stackHold).toBeUndefined();
    slot.Tooltip = slot.Tooltip!.replace('또 다른 황제 활성화 필요 및 추가 조건', '황후의 속삭임 활성화 필요');
    expect(buildFromArmory(raw).build.stackHold).toBeUndefined();
  });
  it('preserves gem and chaos-core effects when the class cores are inactive', () => {
    const raw = input(); raw.arkpassive!.Effects = raw.arkpassive!.Effects.filter(e => !e.Description.includes('또 다른 황제'));
    const { build } = buildFromArmory(raw), active = buildFromArmory(input()).build;
    const retained = (b: typeof build) => b.passiveMods.filter(m => /^(젬|현란한 공격|불타는 일격|공격 \d)/.test(m.source));
    expect(retained(build)).toEqual(retained(active)); expect(retained(build).length).toBeGreaterThan(0);
    expect(build.attackPower?.status).toBe('matched-display');
  });
});
