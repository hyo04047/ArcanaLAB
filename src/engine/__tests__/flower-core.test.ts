import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';

const id = 'dancing_of_spineflower';
function input(): RawArmory {
  const r = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-13-emperor-import-sources.json', 'utf8')).responses;
  return { profiles: r.profiles.data, combatSkills: r['combat-skills'].data, equipment: r.equipment.data,
    arkpassive: r.arkpassive.data, arkgrid: r.arkgrid.data, engravings: r.engravings.data, gems: r.gems.data };
}
const flower = (raw: RawArmory) => buildFromArmory(raw).build.skills.find(s => s.id === id)!;
const core = (raw: RawArmory) => raw.arkgrid!.Slots.find(s => s.Name.endsWith('셔플 댄스'))!;
const flip = (raw: RawArmory) => raw.combatSkills.find(s => s.Name === '댄싱 오브 스파인플라워')!.Tripods!.find(t => t.Name === '페이크 플립')!;

describe('Shuffle Dance 10P Flower cooldown', () => {
  it.each([9, 10, 14, 20])('only enables the flat penalty at %sP', point => {
    const raw = input(); core(raw).Point = point;
    expect(flower(raw).cooldown).toBe(point >= 10 ? 40 : 20);
  });
  it('requires a selected, successfully parsed Fake Flip', () => {
    const raw = input(); flip(raw).IsSelected = false;
    expect(flower(raw).cooldown).toBe(20);
    flip(raw).IsSelected = true; flip(raw).Tooltip = flip(raw).Tooltip!.replace('형태로 변경되고', '형태로 체력이 낮을 때 변경되고');
    expect(flower(raw).cooldown).toBe(20);
  });
  it('rejects extra conditions and unknown core names', () => {
    const raw = input(); core(raw).Tooltip = core(raw).Tooltip!.replace('적용 시 재사용', '적용 시 치명타 적중 후 재사용');
    expect(flower(raw).cooldown).toBe(20);
    const unknown = input(); core(unknown).Name = '알 수 없는 코어';
    expect(flower(unknown).cooldown).toBe(20);
  });
  it('reads the cooldown value without applying thorn-only damage as a passive modifier', () => {
    const raw = input(); core(raw).Tooltip = core(raw).Tooltip!.replace('20.0</FONT>초 증가하지만, 치명적', '13.0</FONT>초 증가하지만, 치명적');
    const { build } = buildFromArmory(raw);
    expect(build.skills.find(s => s.id === id)!.cooldown).toBe(33);
    expect(build.passiveMods.some(m => m.source === '셔플 댄스 10P')).toBe(false);
    expect(build.skills.find(s => s.id === id)!.hitSequence!.hits[0]!.directCoef).toBe(1.641);
  });
});
