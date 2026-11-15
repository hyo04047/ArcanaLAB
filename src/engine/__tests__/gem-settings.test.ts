import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { applyGems, gemAllocation, gemChoices, gemEvidence } from '../gemSettings';
import { captureSettingBaseline, rebuildSettings, type SettingSelections } from '../settings';
import { readSettingInput, saveSettingInput } from '../../settingFiles';
import { chooseSettingOption, gemSummary, settingRows } from '../../settingEditor';
import modelId from 'virtual:arcanalab-model';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const cases = load('tests/fixtures/audit/2026-10-22-master-rune-inputs.json').cases;
const rawFor = (variant = 'emperor'): RawArmory => structuredClone(cases.find((c: any) => c.variant === variant).inputs.find((i: any) => i.id === 'base').raw);
const choose = (name: string, level: number, damage = false) => gemChoices.find(c => c.effect.Name === name && c.gem.Level === level && c.effect.Description[0]!.startsWith(damage ? '피해' : '재사용'))!;
const rebuild = async (raw: RawArmory, edits: Partial<SettingSelections>) => {
  const baseline = await captureSettingBaseline(raw);
  return rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...edits });
};
const low = choose('황제', 8, true);
const downgrade = { gems: [{ slot: 0, choiceId: low.id }], gemAttackMode: 'ratio-approximation' as const };

describe('actual skill gems and aggregate linkage', () => {
  it.each(gemChoices)('keeps grade, level, target and exact source: $gem.Grade $gem.Level $effect.Name', c => {
    const bytes = readFileSync(c.source.path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(c.source.sha256);
    const data = JSON.parse(bytes.toString()), location = c.source.location;
    const source = location.startsWith('refs') ? data.refs[Number(location.match(/\d+/)![0])].data
      : JSON.parse(data.records[Number(location.match(/\d+/)![0])].responses[Number(location.match(/responses\[(\d+)\]/)![1])].body);
    expect(c.gem).toEqual(source.Gems.find((g: any) => g.Slot === c.source.slot));
    expect(c.effect).toEqual(source.Effects.Skills.find((g: any) => g.GemSlot === c.source.slot));
    expect(gemEvidence(c.gem, c.effect).attack).toBeGreaterThan(0);
  });

  it.each(gemChoices)('matches independent raw effects and attack: $gem.Level $effect.Name', async c => {
    const raw = rawFor(), before = structuredClone(raw), expected = structuredClone(raw);
    const effect = expected.gems!.Effects!.Skills!.find(e => e.Name === c.effect.Name && e.Description![0]!.startsWith(c.effect.Description[0]!.split(' ')[0]!))!;
    const oldOption = Number(effect.Option!.match(/[\d.]+/)![0]), newOption = Number(c.effect.Option.match(/[\d.]+/)![0]);
    effect.Description = [...c.effect.Description]; effect.Option = c.effect.Option;
    const total = 12.4 - oldOption + newOption;
    const stat = expected.profiles.Stats.find(s => s.Type === '공격력')!;
    if (newOption !== oldOption) stat.Tooltip = [`기본 공격력은 ${222811 * (100 + total) / 112.4} 입니다`];
    const actual = await rebuild(raw, { gems: [{ slot: effect.GemSlot!, choiceId: c.id }], gemAttackMode: 'ratio-approximation' });
    const independent = buildFromArmory(expected);
    expect(actual.build.passiveMods).toEqual(independent.build.passiveMods);
    expect(actual.build.params.atkBase).toBeCloseTo(independent.build.params.atkBase!, 8);
    expect(actual.build.skills).toEqual(independent.build.skills); expect(actual.build.rotation).toEqual(independent.build.rotation);
    expect(raw).toEqual(before);
  });

  it('updates old totals and base exactly once; never adds the option as a second modifier', async () => {
    const raw = rawFor(), original = buildFromArmory(raw).build;
    const result = await rebuild(raw, downgrade);
    expect(result.build.params.atkBase).toBeCloseTo(222811 * 112 / 112.4, 9);
    expect(result.build.attackPower?.displayed).toBe(original.attackPower!.displayed);
    expect(result.build.attackPower?.status).toBe('mismatch');
    expect(result.build.passiveMods.filter(m => m.source === '보석 황제')).toEqual([{ bucket: 'skillDmg', value: 0.36, filter: { ids: ['card_emperor'] }, source: '보석 황제' }]);
    expect(result.build.passiveMods.filter(m => m.bucket === 'atk' || m.bucket === 'atkFlat')).toEqual(original.passiveMods.filter(m => m.bucket === 'atk' || m.bucket === 'atkFlat'));
    expect(result.limitations.join(' ')).toContain('12.4% → 12%');
    expect(await rebuild(raw, downgrade)).toEqual(result);
    expect((await rebuild(raw, {})).build).toEqual(original);
    applyGems(raw, downgrade.gems, downgrade.gemAttackMode);
    expect(raw.gems!.Effects!.Description).toBe('기본 공격력 총합 : 12.00%');
    expect(raw.gems!.Gems!.find(g => g.Slot === 0)!.Grade).toBe('유물');
    expect(raw.gems!.Effects!.Skills!.every(e => e.Tooltip === undefined)).toBe(true);
    expect(gemAllocation(raw).total).toBe(12);
  });

  it('moves whole gems between slots, keeps equal aggregate base and replaces obsolete skill summaries', async () => {
    const raw = rawFor(), original = buildFromArmory(raw).build;
    const edits = [{ slot: 6, choiceId: choose('리턴', 8).id }, { slot: 9, choiceId: choose('이보크', 10).id }];
    const result = await rebuild(raw, { gems: edits });
    expect(result.build.params.atkBase).toBe(original.params.atkBase);
    expect(result.build.passiveMods.filter(m => m.bucket === 'cooldown' && m.source === '보석 리턴')[0]!.value).toBe(0.2);
    // 대상은 관측 묶음에 고정되므로 슬롯 이동은 효과 대상과 합계를 바꾸지 않습니다.
    expect(result.build.passiveMods.filter(m => m.bucket === 'cooldown' && m.source === '보석 이보크')[0]!.value).toBe(0.24);
    applyGems(raw, edits);
    expect(raw.gems!.Gems!.find(g => g.Slot === 6)!.Level).toBe(8);
    expect(raw.gems!.Effects!.Skills!.find(g => g.GemSlot === 6)!.Name).toBe('리턴');
    expect(raw.combatSkills.find(s => s.Name === '리턴')!.Tooltip).toContain('재사용 대기시간 20.00% 감소');
  });

  it('changes cooldown grade, removes damage and preserves evoke poison exclusion', async () => {
    const raw = rawFor(), edits = { gems: [{ slot: 9, choiceId: choose('리턴', 7).id }, { slot: 2, choiceId: null }], gemAttackMode: 'ratio-approximation' as const };
    const result = await rebuild(raw, edits);
    expect(result.build.passiveMods.some(m => m.source === '보석 이보크' && m.bucket === 'skillDmg')).toBe(false);
    expect(result.build.passiveMods.find(m => m.source === '보석 리턴')!.value).toBe(0.18);
    expect(result.build.params.atkBase).toBeCloseTo(222811 * 111 / 112.4, 8);
    const kept = await rebuild(raw, { gems: [{ slot: 2, choiceId: choose('이보크', 8, true).id }], gemAttackMode: 'ratio-approximation' });
    expect(kept.build.passiveMods.find(m => m.source === '보석 이보크' && m.bucket === 'skillDmg')!.dotScope).toBe('exclude');
    applyGems(raw, edits.gems, edits.gemAttackMode);
    expect(raw.combatSkills.find(s => s.Name === '이보크')!.Tooltip).not.toContain('피해 44.00% 증가');
  });

  it.each(['mode', 'duplicate-slot', 'unknown-slot', 'unknown-choice', 'forged-level', 'duplicate-target', 'mixed'])('rejects unsafe choice: %s', async kind => {
    const raw = rawFor(), edits: any = structuredClone(downgrade);
    if (kind === 'mode') delete edits.gemAttackMode;
    if (kind === 'duplicate-slot') edits.gems.push({ ...edits.gems[0] });
    if (kind === 'unknown-slot') edits.gems[0].slot = 11;
    if (kind === 'unknown-choice') edits.gems[0].choiceId = 'fake';
    if (kind === 'forged-level') edits.gems[0].level = 10;
    if (kind === 'duplicate-target') edits.gems[0].choiceId = choose('리턴', 7).id;
    if (kind === 'mixed') edits.cooldownGems = [{ targetIndex: 1, sourceIndex: 1 }];
    await expect(rebuild(raw, edits)).rejects.toThrow();
  });

  it.each(['missing-gems', 'missing-total', 'wrong-total', 'wrong-slot', 'duplicate-slot', 'grade', 'level', 'description', 'option', 'attack', 'inactive'])('rejects inconsistent baseline: %s', async kind => {
    const raw = rawFor();
    if (kind === 'missing-gems') raw.gems!.Gems = null;
    if (kind === 'missing-total') delete raw.gems!.Effects!.Description;
    if (kind === 'wrong-total') raw.gems!.Effects!.Description = '기본 공격력 총합 : 99.00%';
    if (kind === 'wrong-slot') raw.gems!.Effects!.Skills![0]!.GemSlot = 99;
    if (kind === 'duplicate-slot') raw.gems!.Gems![0]!.Slot = 1;
    if (kind === 'grade') raw.gems!.Gems![0]!.Grade = '전설';
    if (kind === 'level') raw.gems!.Gems![0]!.Level = 7;
    if (kind === 'description') raw.gems!.Effects!.Skills![0]!.Description = ['피해 99.00% 증가'];
    if (kind === 'option') raw.gems!.Effects!.Skills![0]!.Option = '기본 공격력 99.00% 증가';
    if (kind === 'attack') raw.profiles.Stats.find(s => s.Type === '공격력')!.Tooltip = [];
    if (kind === 'inactive') raw.arkpassive!.Effects = raw.arkpassive!.Effects.filter(e => !e.Description.includes('황제의 칙령'));
    await expect(rebuild(raw, downgrade)).rejects.toThrow();
    await expect(rebuild(raw, {})).resolves.toBeDefined();
  });

  it('keeps absent empress evidence closed; tests shared path only with an explicitly synthetic gem baseline', async () => {
    const raw = rawFor('empress');
    await expect(rebuild(raw, downgrade)).rejects.toThrow('개별 보석');
    const c = choose('스트림 오브 엣지', 10);
    raw.gems = { Gems: [structuredClone(c.gem)], Effects: { Description: '기본 공격력 총합 : 1.20%', Skills: [structuredClone(c.effect)] } };
    const base = buildFromArmory(raw).build.params.atkBase!;
    const edits = { gems: [{ slot: c.gem.Slot, choiceId: choose('스트림 오브 엣지', 8).id }], gemAttackMode: 'ratio-approximation' as const };
    const result = await rebuild(raw, edits);
    expect(result.build.variant).toBe('empress'); expect(result.build.params.atkBase).toBeCloseTo(base * 100.8 / 101.2, 8);
    await expect(rebuild(raw, { ...edits, gems: [{ slot: c.gem.Slot, choiceId: low.id }] })).rejects.toThrow('장착 대상');
  });

  it('saves, reloads and rejects stale output; preserves independent simultaneous selections', async () => {
    const baseline = await captureSettingBaseline(rawFor()), edits = { baselineFingerprint: baseline.fingerprint, ...downgrade, stats: { spec: 200 } };
    const text = await saveSettingInput(baseline, edits, modelId), saved = JSON.parse(text);
    expect((await readSettingInput(text, '보석', modelId)).status).toBe('editable');
    expect(saved.setting.baseline).toEqual(baseline); expect(saved.build.stats.spec).toBe(200);
    expect(saved.setting.selections).toEqual(edits);
    saved.build.params.atkBase = 222811;
    await expect(readSettingInput(JSON.stringify(saved), '옛 합계', modelId)).rejects.toThrow('일치하지');
    saved.setting.selections.gems[0].effect = '피해 99% 증가';
    await expect(readSettingInput(JSON.stringify(saved), '위조', modelId)).rejects.toThrow('형식');
    expect((await readSettingInput(text, '과거 모델', 'sha256:' + '0'.repeat(64))).status).toBe('model-changed');
  });

  it('offers only evidence, shows errors, restores choices and leaves missing evidence explicit', async () => {
    const baseline = await captureSettingBaseline(rawFor()), saved = JSON.parse(await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId));
    expect(settingRows(saved.setting, saved.build).gems).toHaveLength(11);
    let draft = chooseSettingOption(saved.setting, saved.build, saved.setting.selections, 'gems', '0', low.id);
    expect(gemSummary(saved.setting, draft)).toContain('명시적으로 선택');
    draft.gemAttackMode = 'ratio-approximation';
    expect(gemSummary(saved.setting, draft)).toContain('12.4% → 12%');
    draft = chooseSettingOption(saved.setting, saved.build, draft, 'gems', '0', '');
    expect(draft.gems).toBeUndefined(); expect(draft.gemAttackMode).toBeUndefined();
    saved.setting.baseline.raw = rawFor('empress');
    expect(settingRows(saved.setting, saved.build).gems).toEqual([]);
    expect(gemSummary(saved.setting, draft)).toContain('개별 보석');
  });
});
