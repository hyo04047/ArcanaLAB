import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFromArmory, type RawArmory } from '../armory';
import { cardsFor } from '../presets';
import { captureSettingBaseline, rebuildSettings, type SettingSelections } from '../settings';
import { applyEnlightenment, enlightenmentAllocation, enlightenmentEffects, enlightenmentNodes } from '../enlightenmentSettings';
import { readSettingInput, saveSettingInput } from '../../settingFiles';
import { chooseSettingOption, enlightenmentSummary, settingRows } from '../../settingEditor';
import modelId from 'virtual:arcanalab-model';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const cases = load('tests/fixtures/audit/2026-10-22-master-rune-inputs.json').cases as { variant: string; inputs: { id: string; raw: RawArmory }[] }[];
const emperor = cases.find(item => item.variant === 'emperor')!.inputs.find(item => item.id === 'base')!.raw;
const rebuild = async (raw: RawArmory, edits: Partial<SettingSelections>) => {
  const baseline = await captureSettingBaseline(raw);
  return rebuildSettings(baseline, { baselineFingerprint: baseline.fingerprint, ...edits });
};
const cards = (build: ReturnType<typeof buildFromArmory>['build']) => cardsFor(build.variant, build.deckOverrides).map(card => card.id);

describe('same-family enlightenment side selections', () => {
  it.each(enlightenmentEffects)('matches immutable source evidence: $nodeId level $level', choice => {
    const bytes = readFileSync(choice.source.path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(choice.source.sha256);
    let source = JSON.parse(bytes.toString('utf8'));
    for (const key of choice.source.location.replace(/\[(\d+)\]/g, '.$1').split('.')) source = source[key];
    if (typeof source === 'string') source = JSON.parse(source);
    expect(source.Effects).toContainEqual(choice.effect);
  });

  describe.each(cases)('$variant', ({ variant, inputs }) => {
    const raw = inputs.find(input => input.id === 'base')!.raw;
    it.each(enlightenmentEffects)('rebuilds the complete input from the stored effect: $nodeId level $level', async choice => {
      // 독립 기대 입력은 공식 효과를 해당 위치에 대입하며 선택 적용 함수를 쓰지 않습니다.
      const expected = structuredClone(raw), name = enlightenmentNodes.find(node => node.id === choice.nodeId)!.name;
      const effects = expected.arkpassive!.Effects, index = effects.findIndex(effect => effect.Description.includes(name));
      if (index >= 0) effects[index] = structuredClone(choice.effect);
      else {
        const last = effects.map(effect => effect.Name).lastIndexOf('깨달음');
        effects.splice(last + 1, 0, structuredClone(choice.effect));
      }
      const before = structuredClone(raw), result = await rebuild(raw, { enlightenment: [{ nodeId: choice.nodeId, level: choice.level }] });
      const independent = buildFromArmory(expected);
      expect(result.build).toEqual(independent.build); expect(result.conversionWarnings).toEqual(independent.warnings);
      expect(result.build.variant).toBe(variant); expect(raw).toEqual(before);
      expect((await rebuild(raw, {})).build).toEqual(buildFromArmory(raw).build);
    });

    it('removes all sides without retaining cards, card-use buffs, damage or gauge penalties', async () => {
      const base = buildFromArmory(raw).build;
      const sides = enlightenmentNodes.filter(node => node.side);
      const result = await rebuild(raw, { enlightenment: sides.map(node => ({ nodeId: node.id, level: 0 })) });
      const expected = structuredClone(raw);
      expected.arkpassive!.Effects = expected.arkpassive!.Effects.filter(effect => !sides.some(node => effect.Description.includes(node.name)));
      expect(result.build).toEqual(buildFromArmory(expected).build);
      expect(cards(result.build)).not.toContain('empress_knight');
      expect(result.build.passiveMods.some(mod => sides.some(node => mod.source.startsWith(node.name)))).toBe(false);
      expect(result.build.onCardUse?.some(buff => buff.id === 'mercy')).toBe(false);
      if (variant === 'empress') {
        expect(base.params!.gaugeGainBonus! - result.build.params!.gaugeGainBonus!).toBeCloseTo(0.04, 14);
        expect(base.params!.normalGaugePenalty).toBe(-0.5);
        expect(result.build.params!.normalGaugePenalty ?? 0).toBe(0);
      } else {
        expect(cards(result.build)).toContain('chancellor'); expect(cards(result.build)).toContain('sovereign');
        expect(cards(result.build)).not.toContain('balance'); expect(cards(result.build)).not.toContain('judgment');
      }
    });
  });

  it.each([[2, 1], [4, 3], [5, 4]])('adds knight level %s with damage %s and removes it without accumulation', async (level, damage) => {
    const result = await rebuild(emperor, { enlightenment: [{ nodeId: 'empress_knight', level }] });
    expect(cards(result.build).filter(id => id === 'empress_knight')).toHaveLength(1);
    expect(result.build.passiveMods.find(mod => mod.source === `황후의 기사 Lv${level}`)).toMatchObject({ value: damage, filter: { ids: ['card_empress_knight'] } });
    expect(result.warnings.some(w => w.includes('공개 계수 후보') && w.includes('실측 미검증'))).toBe(true);
    expect(await rebuild(emperor, { enlightenment: [{ nodeId: 'empress_knight', level }] })).toEqual(result);
  });

  it('preserves all main and unrelated raw objects and reports unknown spending separately from supply', () => {
    const raw = structuredClone(emperor), before = structuredClone(raw);
    const check = applyEnlightenment(raw, [{ nodeId: 'empress_knight', level: 5 }]);
    expect(check).toEqual({ changed: true, variant: 'emperor', available: 101 });
    const untouched = (r: RawArmory) => ({ ...r, arkpassive: { ...r.arkpassive,
      Effects: r.arkpassive!.Effects.filter(effect => !effect.Description.includes('황후의 기사')) } });
    expect(untouched(raw)).toEqual(untouched(before));
  });

  it.each(enlightenmentNodes.filter(node => !node.side))('rejects editing any main path node: $id', async node => {
    await expect(rebuild(emperor, { enlightenment: [{ nodeId: node.id, level: 0 }] })).rejects.toThrow('메인 경로');
  });
  it.each([-1, 1.5, 6, NaN, Infinity, 3])('rejects invalid or unobserved knight level %s', async level => {
    await expect(rebuild(emperor, { enlightenment: [{ nodeId: 'empress_knight', level }] })).rejects.toThrow();
  });
  it.each([null, {}, [null], [{ nodeId: 'empress_knight', level: 2, effect: {} }],
    [{ nodeId: 'empress_knight', level: 2 }, { nodeId: 'empress_knight', level: 2 }]])('rejects malformed or duplicate choices: %j', async enlightenment => {
    await expect(rebuild(emperor, { enlightenment } as unknown as Partial<SettingSelections>)).rejects.toThrow();
  });
  it.each(['missing anchor', 'opposing main', 'duplicate', 'wrong tier', 'unknown node', 'invalid budget'])('rejects ambiguous baseline: %s', async change => {
    const raw = structuredClone(emperor), effects = raw.arkpassive!.Effects;
    if (change === 'missing anchor') raw.arkpassive!.Effects = effects.filter(effect => !effect.Description.includes('황제의 칙령'));
    if (change === 'opposing main') effects.push({ Name: '깨달음', Description: '깨달음 2티어 황후의 계략 Lv.2' });
    if (change === 'duplicate') effects.push(structuredClone(effects.find(effect => effect.Description.includes('황제의 자비'))!));
    if (change === 'wrong tier') effects.find(effect => effect.Description.includes('황제의 자비'))!.Description = '깨달음 4티어 황제의 자비 Lv.1';
    if (change === 'unknown node') effects.push({ Name: '깨달음', Description: '깨달음 3티어 알 수 없음 Lv.1' });
    if (change === 'invalid budget') raw.arkpassive!.Points!.find(point => point.Name === '깨달음')!.Value = -1;
    const before = structuredClone(raw);
    await expect(rebuild(raw, { enlightenment: [{ nodeId: 'empress_knight', level: 0 }] })).rejects.toThrow();
    expect(raw).toEqual(before);
  });

  it('keeps an unobserved original level unchanged or removes it, without offering it to other baselines', async () => {
    const raw = structuredClone(emperor);
    raw.arkpassive!.Effects.find(effect => effect.Description.includes('황후의 기사'))!.Description = '깨달음 4티어 황후의 기사 Lv.3';
    expect((await rebuild(raw, { enlightenment: [{ nodeId: 'empress_knight', level: 3 }] })).build).toEqual(buildFromArmory(raw).build);
    expect(cards((await rebuild(raw, { enlightenment: [{ nodeId: 'empress_knight', level: 0 }] })).build)).not.toContain('empress_knight');
  });

  it('round-trips combined selections, exposes only observed levels, and rejects tampered deck or metadata', async () => {
    const saved = load('tests/fixtures/audit/2026-10-27-stat-settings/browser-combined.json');
    // 과거 증거 파일은 유지하고 새 재생성에서 붙는 폭발별 게이지 표식만 기대값에 반영합니다.
    saved.build.skills.find((s: { id: string }) => s.id === 'evoke').evokeGauge = { candidate: 'evoke-split', perHit: [.1196], warningVersion: 2 };
    const draft = chooseSettingOption(saved.setting, saved.build, saved.setting.selections, 'enlightenment', 'empress_knight', '5');
    const text = await saveSettingInput(saved.setting.baseline, draft, modelId, saved.setting.source);
    const result = await readSettingInput(text, 'combined', modelId), next = JSON.parse(text);
    expect(result.status).toBe('editable'); expect(result.build.stats).toEqual(saved.build.stats);
    expect(result.build.skills).toEqual(saved.build.skills);
    expect(next.setting.selections.enlightenment).toEqual([{ nodeId: 'empress_knight', level: 5 }]);
    expect(settingRows(next.setting, next.build).enlightenment.find(row => row.key === 'empress_knight')!.options.map(option => option.value)).toEqual(['0', '1', '2', '4', '5']);
    expect(enlightenmentSummary(next.setting, draft)).toContain('사용 포인트 미확인 / 원본 공급 101P');
    expect(next.setting.checks.equipmentLegality).toBe('unverified');
    for (const mutate of [(x: typeof next) => { x.build.deckOverrides.add = []; },
      (x: typeof next) => { x.setting.selections.enlightenment[0].level = 2; },
      (x: typeof next) => { x.setting.checks.limitations = []; }]) {
      const tampered = structuredClone(next); mutate(tampered);
      await expect(readSettingInput(JSON.stringify(tampered), 'tampered', modelId)).rejects.toThrow('일치하지');
    }
    const restored = await saveSettingInput(saved.setting.baseline, { baselineFingerprint: saved.setting.baseline.fingerprint }, modelId, saved.setting.source);
    expect(JSON.parse(restored).build).toEqual(buildFromArmory(saved.setting.baseline.raw).build);
    const raw = structuredClone(emperor); delete raw.arkpassive!.Points;
    const resultUnknown = await rebuild(raw, { enlightenment: [{ nodeId: 'empress_knight', level: 5 }] });
    expect(resultUnknown.limitations.join(' ')).toContain('원본 공급 미확인');
    expect(enlightenmentAllocation(emperor).filter(item => !item.node.side)).toHaveLength(4);
  });
});
