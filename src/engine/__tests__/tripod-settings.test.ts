import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { applyTripods, tripodChoices, tripodSkill, type TripodChoice } from '../tripodSettings';
import { captureSettingBaseline, rebuildSettings, type SettingSelections } from '../settings';
import { readSettingInput, saveSettingInput } from '../../settingFiles';
import { chooseSettingOption, settingRows } from '../../settingEditor';
import { strip } from '../tooltip';
import modelId from 'virtual:arcanalab-model';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const cases = load('tests/fixtures/audit/2026-10-22-master-rune-inputs.json').cases as { variant: string; inputs: { id: string; raw: RawArmory }[] }[];
const rawFor = (variant: string) => structuredClone(cases.find(item => item.variant === variant)!.inputs.find(item => item.id === 'base')!.raw);
const find = (id: string, name: string, level: number | null = null) => tripodChoices.find(item => item.skillId === id && item.tripod.Name === name && item.enhancementLevel === level)!;
const choose = (id: string, name: string, level: number | null = null): TripodChoice => {
  const item = find(id, name, level);
  return { skillId: id, tier: item.tripod.Tier, choiceId: item.id };
};
const rebuild = async (raw: RawArmory, edits: Partial<SettingSelections>) => {
  const baseline = await captureSettingBaseline(raw);
  return rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...edits });
};

describe('stored tripod evidence and complete rebuild', () => {
  it.each(tripodChoices)('keeps the exact source: $skillId $tripod.Name $enhancementLevel', choice => {
    const bytes = readFileSync(choice.source.path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(choice.source.sha256);
    let source = JSON.parse(bytes.toString('utf8'));
    for (const key of choice.source.location.replace(/\[(\d+)\]/g, '.$1').split('.')) {
      if (typeof source === 'string') source = JSON.parse(source);
      source = source[key];
    }
    if (choice.enhancementLevel === null) expect(choice.tripod).toEqual(source);
    else {
      expect(source.curLv).toBe(choice.enhancementLevel);
      expect(choice.tripod.Name).toBe(source.name); expect(choice.tripod.Tooltip).toBe(source.desc);
      const catalog = load('data/skills.json').skills.find((item: { id: string }) => item.id === choice.skillId);
      const current = catalog.tripodBase[choice.tripod.Tier][choice.tripod.Slot - 1];
      expect(current.note).toBeUndefined(); expect(current.desc).toBe(source.desc);
    }
  });

  describe.each(cases)('$variant independent raw changes', ({ variant }) => {
    const raw = rawFor(variant), active = buildFromArmory(raw).build.skills.map(item => item.id);
    it.each(tripodChoices.filter(choice => active.includes(choice.skillId)))('$skillId / $tripod.Name / $enhancementLevel', async choice => {
      const expected = structuredClone(raw), before = structuredClone(raw);
      const skill = expected.combatSkills.find(item => item.Name === load('data/skills.json').skills.find((s: { id: string }) => s.id === choice.skillId).name)!;
      skill.Tripods = skill.Tripods!.map(t => t.Tier !== choice.tripod.Tier ? t
        : t.Slot === choice.tripod.Slot ? { ...structuredClone(choice.tripod), IsSelected: true } : { ...t, IsSelected: false });
      const result = await rebuild(raw, { tripods: [{ skillId: choice.skillId, tier: choice.tripod.Tier, choiceId: choice.id }] });
      const independent = buildFromArmory(expected);
      expect(result.build).toEqual(independent.build); expect(result.conversionWarnings).toEqual(independent.warnings);
      expect(raw).toEqual(before); expect(result.build.variant).toBe(variant);
    });
  });

  it('replaces empress finisher, hits and damage; restores exactly and never accumulates', async () => {
    const raw = rawFor('empress'), base = buildFromArmory(raw), edits = { tripods: [choose('call_of_destiny', '연속 공격')] };
    const result = await rebuild(raw, edits), skill = result.build.skills.find(s => s.id === 'call_of_destiny')!;
    // 기존 공개 계수 후보는 첫 판정 추가 + 마지막 판정의 3타입니다.
    expect(skill.kind).toBe('normal'); expect(skill.hits).toBe(3); expect(skill.stacksGranted).toBeUndefined();
    expect(result.build.rotation.finisher).toBeUndefined(); expect(result.build.rotation.fillers).toContain('call_of_destiny');
    expect(base.build.rotation.finisher).toBe('call_of_destiny');
    expect(skill.directCoef).not.toBe(base.build.skills.find(s => s.id === skill.id)!.directCoef);
    expect(await rebuild(raw, edits)).toEqual(result); expect((await rebuild(raw, {})).build).toEqual(base.build);
  });

  it('replaces emperor normal rotation and split evoke, removing former mechanics and cooldown reduction', async () => {
    const raw = rawFor('emperor');
    const result = await rebuild(raw, { tripods: [choose('call_of_destiny', '페이크 플립'), choose('evoke', '중첩 마법진'), choose('unlimited_shuffle', '빠른 준비')] });
    const call = result.build.skills.find(s => s.id === 'call_of_destiny')!, evoke = result.build.skills.find(s => s.id === 'evoke')!;
    expect(call.kind).toBe('stack'); expect(call.hits).toBe(1); expect(call.stacksGranted).toBe(2);
    expect(result.build.rotation.fillers).not.toContain('call_of_destiny'); expect(result.build.rotation.stackPriority).toContain('call_of_destiny');
    expect(evoke.splitEvoke).toBeUndefined(); expect(evoke.manualEvoke).toBeDefined();
    const swift = result.build.skills.find(s => s.id === 'unlimited_shuffle')!;
    const base = buildFromArmory(raw).build.skills.find(s => s.id === swift.id)!;
    expect(swift.cooldown).toBeLessThan(base.cooldown);
    const removed = await rebuild(raw, { tripods: [{ skillId: 'unlimited_shuffle', tier: 0, choiceId: null }] });
    expect(removed.build.skills.find(s => s.id === swift.id)!.cooldown).toBe(base.cooldown);
    expect(result.warnings.some(w => /미모델|미반영|미검증/.test(w))).toBe(true);
  });

  it('updates redundant tooltip summaries, leaves the original intact and removes a tier', () => {
    const raw = rawFor('empress'), before = structuredClone(raw);
    applyTripods(raw, [choose('call_of_destiny', '연속 공격'), { skillId: 'call_of_destiny', tier: 1, choiceId: null }]);
    const { skill } = tripodSkill(raw, 'call_of_destiny');
    expect(skill.Tripods!.filter(t => t.IsSelected).map(t => t.Name)).toEqual(['날렵한 움직임', '연속 공격']);
    expect(strip(skill.Tooltip)).not.toContain('페이크 플립');
    expect(raw.combatSkills.filter(s => s.Name !== skill.Name)).toEqual(before.combatSkills.filter(s => s.Name !== skill.Name));
  });

  it.each(['duplicate', 'wrong-tier', 'wrong-skill', 'unknown-id', 'invented-level', 'forged-description', 'missing-id'])('rejects invalid selection: %s', async change => {
    const choice: any = choose('call_of_destiny', '페이크 플립'), choices = [choice];
    if (change === 'duplicate') choices.push({ ...choice });
    if (change === 'wrong-tier') choice.tier = 1;
    if (change === 'wrong-skill') choice.skillId = 'evoke';
    if (change === 'unknown-id') choice.choiceId = 'missing';
    if (change === 'invented-level') choice.level = 5;
    if (change === 'forged-description') choice.tooltip = '피해 100% 증가';
    if (change === 'missing-id') delete choice.choiceId;
    await expect(rebuild(rawFor('emperor'), { tripods: choices })).rejects.toThrow();
  });

  it.each(['skill-level', 'missing-summary', 'summary-description', 'selected-description', 'slot-name', 'duplicate-slot', 'duplicate-tier', 'duplicate-skill', 'inactive'])('rejects inconsistent original: %s', async change => {
    const raw = rawFor('emperor'), skill = raw.combatSkills.find(s => s.Name === '운명의 부름')!;
    if (change === 'skill-level') skill.Level = 14;
    if (change === 'missing-summary') skill.Tooltip = '{}';
    if (change === 'summary-description') skill.Tooltip = skill.Tooltip.replace('70.8%', '80.8%');
    if (change === 'selected-description') skill.Tripods!.find(t => t.IsSelected)!.Tooltip = '공격속도 99% 증가';
    if (change === 'slot-name') skill.Tripods![0]!.Name = '다른 이름';
    if (change === 'duplicate-slot') skill.Tripods!.push(structuredClone(skill.Tripods![0]!));
    if (change === 'duplicate-tier') skill.Tripods![0]!.IsSelected = true;
    if (change === 'duplicate-skill') raw.combatSkills.push(structuredClone(skill));
    if (change === 'inactive') skill.Level = 1;
    await expect(rebuild(raw, { tripods: [choose('call_of_destiny', '페이크 플립')] })).rejects.toThrow();
    await expect(rebuild(raw, {})).resolves.toBeDefined();
  });

  it.each([null, {}, [null], [{ skillId: 'call_of_destiny', tier: -1, choiceId: null }]])('rejects malformed choices: %j', async tripods => {
    await expect(rebuild(rawFor('emperor'), { tripods } as Partial<SettingSelections>)).rejects.toThrow();
  });

  it('saves and restores explicit evidence, rejects stale build and fabricated levels, and combines axes', async () => {
    const raw = rawFor('emperor'), baseline = await captureSettingBaseline(raw);
    const edits = { baselineFingerprint: baseline.fingerprint, tripods: [choose('return', '노출된 어둠', 1)],
      stats: { spec: 200 }, runes: [{ targetSkillId: 'call_of_destiny', sourceSkillId: 'return' }, { targetSkillId: 'return', sourceSkillId: 'call_of_destiny' }] };
    const text = await saveSettingInput(baseline, edits, modelId);
    const read = await readSettingInput(text, '트포', modelId);
    expect(read.status).toBe('editable'); expect(read.build.stats.spec).toBe(200);
    const saved = JSON.parse(text);
    expect(saved.setting.baseline.raw).toEqual(raw); expect(saved.setting.selections).toEqual(edits);
    saved.build.rotation.setupSkill = 'evoke';
    await expect(readSettingInput(JSON.stringify(saved), '변조', modelId)).rejects.toThrow('일치하지');
    saved.setting.selections.tripods[0].level = 5;
    await expect(readSettingInput(JSON.stringify(saved), '임의 레벨', modelId)).rejects.toThrow('형식');
  });

  it('offers evidence labels, preserves other axes, removes and restores the selected tier', async () => {
    const baseline = await captureSettingBaseline(rawFor('empress'));
    const saved = JSON.parse(await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId));
    const rows = settingRows(saved.setting, saved.build);
    expect(rows.tripods).toHaveLength(24);
    const row = rows.tripods.find(row => row.key === 'call_of_destiny:2')!;
    expect(row.options.some(o => o.label.includes('강화 레벨 미확인'))).toBe(true);
    expect(row.options.some(o => o.label.includes('공개 Lv.1 후보'))).toBe(true);
    const draft = chooseSettingOption(saved.setting, saved.build, { ...saved.setting.selections, stats: { spec: 200 } }, 'tripods', row.key, find('call_of_destiny', '연속 공격').id);
    expect(draft.stats).toEqual({ spec: 200 }); expect(draft.tripods).toHaveLength(1);
    const removed = chooseSettingOption(saved.setting, saved.build, draft, 'tripods', row.key, 'none');
    expect(removed.tripods![0]!.choiceId).toBeNull();
    const reset = chooseSettingOption(saved.setting, saved.build, removed, 'tripods', row.key, '');
    expect(reset.tripods).toBeUndefined(); expect(reset.stats).toEqual({ spec: 200 });
    expect(() => chooseSettingOption(saved.setting, saved.build, draft, 'tripods', row.key, 'Lv.5')).toThrow();
    saved.setting.baseline.raw.combatSkills[0].Tooltip = '{}';
    expect(settingRows(saved.setting, saved.build).tripods).toHaveLength(21);
  });
});
