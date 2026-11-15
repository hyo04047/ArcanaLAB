import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardsFor, empressInkomsu440, simulate } from './engine';
import type { RawArmory } from './engine/armory';
import { buildFromArmory } from './engine/armory';
import type { WorkerRequest, WorkerResponse } from './worker';
import { diffBuilds, parseBuildInput } from './compare';
import { parseResultInput } from './resultComparison';
import modelId from 'virtual:arcanalab-model';
import { damageWarnings } from './engine/skilldata';
import { cardSupplyWarnings } from './engine/cards';
import { captureSettingBaseline } from './engine/settings';
import { readSettingInput, saveSettingInput } from './settingFiles';

const { fetchArmory } = vi.hoisted(() => ({ fetchArmory: vi.fn() }));
vi.mock('./api', () => ({ fetchArmory }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); fetchArmory.mockReset(); });

const record = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[0];
const raw = Object.fromEntries(record.responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as unknown as RawArmory;
const preset = empressInkomsu440();
const summary = { ...simulate(preset, cardsFor('empress'), { durationSec: 30, iterations: 10, seed: 1 }),
  inputWarnings: ['손으로 옮긴 프리셋', ...damageWarnings(preset), ...cardSupplyWarnings(preset)] };

describe('saved representative selection comparisons', () => {
  const directory = 'tests/fixtures/audit/2026-10-28-representative-comparison';
  const read = (variant: string, change: string, folder = 'results', seed = 1) =>
    readFileSync(`${directory}/${folder}/${variant}-${change}-s${seed}.json`, 'utf8');

  it.each(['emperor', 'empress'].flatMap(variant => ['base', 'runes', 'combined'].map(change => ({ variant, change }))))
    ('shows $variant $change saved input, conditions, paired values and every warning without altering the active build', async ({ variant, change }) => {
      const { el, exports, worker } = await mount();
      el('preset').click();
      const active = el('export').href, activeText = await exports.get(active)!.text();
      const before = read(variant, 'base'), after = read(variant, change);
      const expected = JSON.parse(read(variant, change, 'comparisons'));
      el('before-file').files = [{ name: '기준.json', text: async () => before }];
      el('after-file').files = [{ name: '비교.json', text: async () => after }];
      await el('compare').click();
      const output = el('comparison').textContent;
      const number = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
      expect(output).toContain(`전체 설정 차이 ${expected.differences.length}개`);
      expect(output).toContain('회차별 확률 통제 비교 10쌍');
      expect(output).toContain(`DPS 차이: 평균 ${number(expected.paired.dps.mean)}`);
      expect(output).toContain(`평균 차이의 표준오차: ${number(expected.paired.standardError)}`);
      expect(output).toContain('30초 · 10회 · seed 1 · 판정별 난수 v1');
      for (const item of expected.differenceDescriptions) expect(output).toContain(`${item.description} [${item.path}]`);
      for (const input of [JSON.parse(before), JSON.parse(after)])
        for (const warning of [...input.warnings, ...input.result.damageWarnings, ...input.result.cardSupplyWarnings]) expect(output).toContain(warning);
      expect(output).toContain('미확인 게임 수치·운용 가정의 오차를 포함하지 않습니다');
      expect(el('comparison').innerHTML).toBe('');
      expect(el('export').href).toBe(active); expect(await exports.get(active)!.text()).toBe(activeText);
      expect(worker.requests).toHaveLength(0);
    });

  it.each(['emperor', 'empress'].flatMap(variant => ['seed', 'model', 'broken result'].map(fault => ({ variant, fault }))))
    ('blocks $variant $fault saved results and recovers with the original complete result', async ({ variant, fault }) => {
      const { el } = await mount(), before = read(variant, 'base'), after = read(variant, 'combined');
      const invalid = JSON.parse(fault === 'seed' ? read(variant, 'combined', 'results', 42) : after);
      if (fault === 'model') invalid.modelId = 'sha256:' + '0'.repeat(64);
      if (fault === 'broken result') invalid.result.samples.pop();
      el('before-file').files = [{ name: '기준.json', text: async () => before }];
      el('after-file').files = [{ name: '부적절한 결과.json', text: async () => JSON.stringify(invalid) }];
      await el('compare').click();
      expect(el('comparison').textContent).toContain('수치 비교 불가:');
      expect(el('comparison').textContent).toContain('전체 설정 차이');
      expect(el('comparison').textContent).not.toContain('회차별 확률 통제 비교 10쌍');
      expect(el('compare').disabled).toBe(false);
      el('after-file').files = [{ name: '복구.json', text: async () => after }];
      await el('compare').click();
      expect(el('comparison').textContent).toContain('회차별 확률 통제 비교 10쌍');
      expect(el('comparison').textContent).not.toContain('수치 비교 불가:');
    });
});

it('runs and exports the chosen partitioned mode even after the selector changes', async () => {
  const { el, worker, exports } = await mount();
  el('preset').click(); el('random-mode').value = 'partitioned-v1'; el('run').click();
  const request = worker.requests[0]!;
  expect(request.config.randomMode).toBe('partitioned-v1');
  const result = { ...simulate(request.build, cardsFor(request.build.variant, request.build.deckOverrides), request.config), inputWarnings: request.inputWarnings };
  el('random-mode').value = 'legacy';
  el('seed').value = '42';
  worker.onmessage!({ data: { id: request.id, summary: result, modelId } });
  expect(el('out').textContent).toContain('난수: 판정별 난수 v1 · seed 1');
  const saved = parseResultInput(await exports.get(el('result-export').href)!.text(), '새 난수 결과')!;
  expect(saved.config.randomMode).toBe('partitioned-v1');
  expect(saved.config.seed).toBe(1);
  expect(saved.result.randomMode).toBe('partitioned-v1');
});

it('shows paired A/A statistics and keeps the same-class restriction explicit', async () => {
  const { el } = await mount();
  const config = { durationSec: 30, iterations: 10, seed: 1, randomMode: 'partitioned-v1' as const };
  const saved = { build: preset, config, result: simulate(preset, cardsFor('empress'), config), modelId };
  el('before-file').files = [{ name: '기준.json', text: async () => JSON.stringify(saved) }];
  el('after-file').files = [{ name: '비교.json', text: async () => JSON.stringify(saved) }];
  await el('compare').click();
  expect(el('comparison').textContent).toContain('회차별 확률 통제 비교 10쌍');
  expect(el('comparison').textContent).toContain('평균 차이의 표준오차: 0');
  expect(el('comparison').textContent).toContain('동일 10');
  el('after-file').files = [{ name: '다른 계열.json', text: async () => JSON.stringify({ ...saved, build: { ...preset, variant: 'emperor' } }) }];
  await el('compare').click();
  expect(el('comparison').textContent).toContain('황후끼리 또는 황제끼리');
  expect(el('comparison').textContent).not.toContain('회차별 확률 통제 비교 10쌍');
});

function deferred() {
  let resolve!: (value: RawArmory) => void, reject!: (error: Error) => void;
  const promise = new Promise<RawArmory>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it.each(['paired', 'model', 'seed'] as const)('shows %s comparison status before detailed changes and all warnings', async mode => {
  const { el } = await mount();
  const config = { durationSec: 30, iterations: 10, seed: 1, randomMode: 'partitioned-v1' as const };
  const warnings = ['입력 경고 <img src=x>'];
  const result = { ...simulate(preset, cardsFor('empress'), config), inputWarnings: warnings,
    damageWarnings: Array.from({ length: 100 }, (_, i) => `추가 계산 경고 <img src=${i}>`) };
  const before = { build: preset, config, result, warnings, modelId };
  const after = structuredClone(before); after.build.stats.crit++;
  if (mode === 'model') after.modelId = 'sha256:' + '0'.repeat(64);
  if (mode === 'seed') after.config.seed++;
  el('before-file').files = [{ name: '기준.json', text: async () => JSON.stringify(before) }];
  el('after-file').files = [{ name: '비교.json', text: async () => JSON.stringify(after) }];
  await el('compare').click();
  const output = el('comparison').textContent;
  const marker = mode === 'paired' ? '평균 차이의 표준오차: 0' : '수치 비교 불가:';
  expect(output).toContain(marker);
  expect(output.indexOf('저장된 계산 소스 식별값')).toBeLessThan(output.indexOf(marker));
  for (const detail of ['[/stats/crit]', ...warnings, ...result.damageWarnings]) {
    expect(output).toContain(detail);
    expect(output.indexOf(marker)).toBeLessThan(output.indexOf(detail));
  }
  expect(el('comparison').innerHTML).toBe('');
  expect(output.includes('회차별 확률 통제 비교 10쌍')).toBe(mode === 'paired');
});

// 실제 이벤트 핸들러를 실행하는 DOM/Worker 통제입니다. 브라우저 레이아웃은 검증하지 않습니다.
async function mount(failure?: 'constructor' | 'postMessage') {
  vi.useFakeTimers();
  const elements = new Map(['app', 'name', 'load', 'preset', 'build-file', 'regenerate-setting', 'setting-hint', 'stat-preview', 'setting-choices', 'setting-status', 'apply-settings', 'cancel-settings', 'reset-settings', 'export', 'result-export', 'build', 'dur', 'iter', 'seed', 'random-mode', 'run', 'out', 'before-file', 'after-file', 'compare', 'comparison'].map(id => [id, {
    value: ({ dur: '30', iter: '10', seed: '1', 'random-mode': 'legacy' } as Record<string, string>)[id] ?? '', textContent: '', innerHTML: '', disabled: false,
    hidden: id === 'export' || id === 'result-export', href: '',
    files: [] as { name: string; text: () => Promise<string> }[],
    handlers: new Map<string, (event?: unknown) => void | Promise<void>>(), reportValidity: () => true,
    addEventListener(type: string, handler: () => void | Promise<void>) { this.handlers.set(type, handler); },
    click() { return this.handlers.get('click')!(); },
  }]));
  // File.text()는 BOM을 제거하므로 실제 파일 읽기와 같이 바이트 입력을 제공합니다.
  for (const element of elements.values()) {
    let files = element.files;
    Object.defineProperty(element, 'files', { get: () => files, set: (value: typeof files) => {
      files = value.map(file => ({ ...file, arrayBuffer: async () => new TextEncoder().encode(await file.text()).buffer }));
    } });
  }
  const requests: WorkerRequest[] = [];
  const exports = new Map<string, Blob>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    if (!(blob instanceof Blob)) throw new Error('JSON 내보내기는 Blob을 사용해야 합니다.');
    const url = `blob:export-${exports.size}`;
    exports.set(url, blob);
    return url;
  });
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const instances: { onmessage: ((event: { data: WorkerResponse }) => void) | null; onerror: ((event: { message: string }) => void) | null; terminate: ReturnType<typeof vi.fn> }[] = [];
  const worker = { requests, instances, get onmessage() { return instances.at(-1)!.onmessage; } };
  vi.stubGlobal('document', { querySelector: (selector: string) => elements.get(selector.slice(1)) });
  vi.stubGlobal('Worker', class {
    onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    terminate = vi.fn();
    constructor() {
      if (failure === 'constructor') { failure = undefined; throw new Error('Worker 생성 실패'); }
      instances.push(this);
    }
    postMessage(request: WorkerRequest) {
      if (failure === 'postMessage') { failure = undefined; throw new Error('Worker 전송 실패'); }
      requests.push(request);
    }
  });
  await import('./main');
  const el = (id: string) => elements.get(id)!;
  return { el, worker, exports, revoke, load() { el('name').value = '조회 이름'; return el('load').click(); } };
}

describe('setting editor workflow', () => {
  const base = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-27-setting-files/current-base.json', 'utf8'));
  const expected = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-27-setting-files/current-changed.json', 'utf8'));
  // 과거 파일과 룬·보석 기대 입력은 보존하고 카드·게이지 후보 변경만 반영합니다.
  for (const saved of [base, expected]) {
    saved.setting.compiledWith = modelId;
    saved.build.params.cardDamageCoef = { emperor: 72.395, empress_knight: 120.65 };
    saved.build.params.cardDamageFlat = { emperor: 7791, empress_knight: 12984.5 };
    saved.build.params.gaugeFactors = { specialization: 0.0268, greed: 0 };
    const gaugeWarning = cardSupplyWarnings(saved.build).find(w => w.startsWith('카드 게이지 조합'))!;
    const warning = cardSupplyWarnings(saved.build).find(w => w.startsWith('황제·황후의 기사 기본 피해'))!;
    saved.warnings = saved.warnings.filter((w: string) => !/^황제 카드 기본 피해 계수|^황후의 기사 기본 피해 계수/.test(w))
      .map((w: string) => w.startsWith('황제·황후의 기사 피해는 기준') ? warning
        : w.startsWith('특화·패시브 게이지 증가는 합산') ? gaugeWarning : w);
    const supply = cardSupplyWarnings(saved.build), start = saved.warnings.indexOf(supply[0]!);
    saved.build.skills.find((s: { id: string }) => s.id === 'evoke').evokeGauge = { candidate: 'evoke-split', perHit: [.1196], warningVersion: 2 };
    saved.warnings.splice(start, supply.length, ...cardSupplyWarnings(saved.build));
  }
  const baseText = JSON.stringify(base) + '\n';
  async function editor(text = baseText) {
    const screen = await mount();
    screen.el('build-file').files = [{ name: '기준.json', text: async () => text }];
    await screen.el('build-file').handlers.get('change')!();
    return { ...screen, choose(axis: string, target: string, value: string) {
      return screen.el('setting-choices').handlers.get('change')!({ target: { dataset: { axis, target }, value } });
    } };
  }

  it('applies simultaneous selections, runs the regenerated input and preserves choices in both exports', async () => {
    const { el, choose, worker, exports } = await editor();
    expect(el('setting-choices').innerHTML).toContain('운명의 부름 룬');
    const originalExport = el('export').href;
    await choose('runes', 'call_of_destiny', 'return');
    await choose('cooldownGems', '1', '9');
    expect(el('run').disabled).toBe(true); expect(el('export').hidden).toBe(true);
    el('run').click(); expect(worker.requests).toHaveLength(0);
    expect(el('setting-status').textContent).toContain('아직 적용하지 않은');
    expect(el('export').href).toBe(originalExport);
    await el('apply-settings').click();
    expect(el('setting-status').textContent).toContain('선택 적용 완료');
    const savedText = await exports.get(el('export').href)!.text();
    expect(JSON.parse(savedText)).toEqual(expected);
    expect(el('build-file').value).toBe('');
    expect(el('apply-settings').disabled).toBe(true); expect(el('run').disabled).toBe(false);
    el('random-mode').value = 'partitioned-v1'; el('run').click();
    const request = worker.requests[0]!;
    expect(request.build).toEqual(expected.build);
    const result = { ...simulate(request.build, cardsFor(request.build.variant, request.build.deckOverrides), request.config), inputWarnings: request.inputWarnings };
    worker.onmessage!({ data: { id: request.id, summary: result, modelId } });
    const resultText = await exports.get(el('result-export').href)!.text();
    expect(JSON.parse(resultText).setting).toEqual(expected.setting);
    expect((await readSettingInput(resultText, '계산 결과', modelId)).status).toBe('editable');
    el('build-file').files = [{ name: '재입력.json', text: async () => savedText }];
    await el('build-file').handlers.get('change')!();
    expect(el('setting-choices').innerHTML).toContain('value="return" selected');
    expect(el('apply-settings').disabled).toBe(true);
  });

  it('cancels a draft to the last applied input and applies original selections to restore the full baseline', async () => {
    const { el, choose, exports } = await editor(JSON.stringify(expected));
    const saved = el('export').href;
    await choose('runes', 'return', '');
    el('cancel-settings').click();
    expect(el('export').href).toBe(saved); expect(el('export').hidden).toBe(false);
    expect(JSON.parse(await exports.get(saved)!.text())).toEqual(expected);
    el('reset-settings').click();
    expect(el('run').disabled).toBe(true);
    await el('apply-settings').click();
    expect(JSON.parse(await exports.get(el('export').href)!.text())).toEqual(base);
  });

  it('invalidates an in-flight Worker when a draft changes and rejects its late result', async () => {
    const { el, choose, worker } = await editor();
    el('run').click();
    const request = worker.requests[0]!, late = worker.onmessage!;
    await choose('runes', 'return', '');
    expect(worker.instances[0]!.terminate).toHaveBeenCalled();
    late({ data: { id: request.id, summary, modelId } });
    expect(el('result-export').hidden).toBe(true); expect(el('out').textContent).toBe('');
    expect(el('run').disabled).toBe(true);
  });

  it.each(['preset', 'file'] as const)('ignores an applying edit after switching to another %s', async mode => {
    const { el, choose, exports } = await editor();
    await choose('runes', 'return', '');
    const pending = el('apply-settings').click();
    expect(el('apply-settings').disabled).toBe(true); expect(el('reset-settings').disabled).toBe(true);
    if (mode === 'preset') el('preset').click();
    else {
      el('build-file').files = [{ name: '다른 파일.json', text: async () => JSON.stringify(expected) }];
      await el('build-file').handlers.get('change')!();
    }
    const href = el('export').href;
    await pending;
    expect(el('export').href).toBe(href);
    expect(JSON.parse(await exports.get(href)!.text()).build).toEqual(mode === 'preset' ? preset : expected.build);
    expect(el('run').disabled).toBe(false);
  });

  it('retains the draft after an apply failure and allows cancellation back to the original input', async () => {
    const { el, choose, exports } = await editor();
    const href = el('export').href;
    await choose('runes', 'return', '');
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('검사용 해시 실패'));
    await el('apply-settings').click();
    expect(el('setting-status').textContent).toContain('적용 실패: 검사용 해시 실패');
    expect(el('run').disabled).toBe(true); expect(el('cancel-settings').disabled).toBe(false);
    el('cancel-settings').click();
    expect(el('run').disabled).toBe(false); expect(el('export').hidden).toBe(false);
    expect(await exports.get(href)!.text()).toBe(baseText);
  });

  it.each(['legacy', 'model-changed', 'unsupported-version'] as const)('keeps %s files outside the editor', async mode => {
    const input = structuredClone(base);
    if (mode === 'legacy') delete input.setting;
    if (mode === 'model-changed') input.setting.compiledWith = 'sha256:' + '0'.repeat(64);
    if (mode === 'unsupported-version') input.setting = { version: 9 };
    const { el, choose, exports } = await editor(JSON.stringify(input));
    const href = el('export').href;
    expect(el('setting-choices').innerHTML).toBe(''); expect(el('reset-settings').disabled).toBe(true);
    await choose('runes', 'return', ''); await el('apply-settings').click();
    expect(el('export').href).toBe(href); expect(JSON.parse(await exports.get(href)!.text())).toEqual(input);
    expect(el('run').disabled).toBe(false);
    if (mode === 'model-changed') {
      await el('regenerate-setting').click();
      expect(el('setting-choices').innerHTML).toContain('운명의 부름 룬');
      expect(el('reset-settings').disabled).toBe(false);
    }
  });

  it('rejects a forged unsupported choice without changing the applied input', async () => {
    const { el, choose } = await editor();
    const href = el('export').href;
    await choose('cooldownGems', '1', '0');
    expect(el('setting-status').textContent).toContain('선택 실패');
    expect(el('apply-settings').disabled).toBe(true); expect(el('run').disabled).toBe(false);
    expect(el('export').href).toBe(href);
  });

  it('shows point overflow, rejects applying it, then accepts a supported evolution and rune combination', async () => {
    const { el, choose, exports, worker } = await editor();
    const before = el('export').href;
    await choose('evolution', 'master', '1');
    expect(el('setting-choices').innerHTML).toContain('4티어 포인트 초과: 30/20P');
    await el('apply-settings').click();
    expect(el('setting-status').textContent).toContain('적용 실패');
    expect(el('export').href).toBe(before); expect(el('run').disabled).toBe(true);
    await choose('evolution', 'crush', '0'); await choose('runes', 'call_of_destiny', 'return');
    expect(el('setting-choices').innerHTML).toContain('총 140P / 원본 공급 140P');
    await el('apply-settings').click();
    const saved = JSON.parse(await exports.get(el('export').href)!.text());
    expect(saved.setting.selections.evolution).toEqual([{ nodeId: 'master', level: 1 }, { nodeId: 'crush', level: 0 }]);
    expect(saved.build.skills.some((skill: any) => skill.onCast?.some((effect: any) => effect.id === 'master_crit'))).toBe(true);
    expect(saved.build.passiveMods.some((effect: any) => effect.source.startsWith('분쇄'))).toBe(false);
    el('run').click(); expect(worker.requests[0]!.build).toEqual(saved.build);
    el('reset-settings').click(); await el('apply-settings').click();
    expect(JSON.parse(await exports.get(el('export').href)!.text())).toEqual(base);
  });

  it('does not offer unobserved upper-tier levels or unsupported tier-one effects', async () => {
    const { el, choose } = await editor();
    expect(el('setting-choices').innerHTML).toContain('data-target="stat_치명"');
    expect(el('setting-choices').innerHTML).not.toContain('data-target="stat_제압"');
    await choose('evolution', 'limit_break', '2');
    expect(el('setting-status').textContent).toContain('선택 실패');
    expect(el('apply-settings').disabled).toBe(true);
    expect(el('run').disabled).toBe(false);
  });

  it('updates linked totals, preserves focused stat controls, applies inclusive totals and restores the original', async () => {
    const { el, choose, exports, worker } = await editor();
    await choose('evolution', 'stat_치명', '11'); await choose('evolution', 'stat_신속', '29');
    expect(el('stat-preview').textContent).toContain('치명 694 (근사 재계산)');
    expect(el('stat-preview').textContent).toContain('신속 1777 (근사 재계산)');
    const controls = el('setting-choices').innerHTML;
    await el('setting-choices').handlers.get('input')!({ target: { dataset: { stat: 'crit' }, value: '700' } });
    expect(el('setting-choices').innerHTML).toBe(controls);
    expect(el('stat-preview').textContent).toContain('치명 700');
    expect(el('run').disabled).toBe(true); expect(el('export').hidden).toBe(true);
    await el('apply-settings').click();
    const saved = JSON.parse(await exports.get(el('export').href)!.text());
    expect(saved.build.stats).toEqual({ crit: 700, spec: 75, swift: 1777 });
    expect(saved.setting.selections.stats).toEqual({ crit: 700 });
    el('run').click(); expect(worker.requests[0]!.build).toEqual(saved.build);
    el('reset-settings').click(); await el('apply-settings').click();
    expect(JSON.parse(await exports.get(el('export').href)!.text())).toEqual(base);
  });

  it.each([{ value: '-1' }, { value: '1.5' }, { value: '', validity: { badInput: true } }])('locks invalid stat input and can cancel: %j', async input => {
    const { el, exports } = await editor();
    const original = el('export').href;
    await el('setting-choices').handlers.get('input')!({ target: { dataset: { stat: 'spec' }, ...input } });
    expect(el('stat-preview').textContent).toContain('특성 적용 불가');
    expect(el('run').disabled).toBe(true); expect(el('export').hidden).toBe(true);
    await el('apply-settings').click();
    expect(el('setting-status').textContent).toContain('적용 실패');
    expect(el('export').href).toBe(original);
    el('cancel-settings').click(); expect(el('run').disabled).toBe(false);
    expect(JSON.parse(await exports.get(el('export').href)!.text())).toEqual(base);
  });

  it('rebuilds side effects, prevents stale calculation, reloads choices and restores the baseline', async () => {
    const { el, choose, exports, worker } = await editor();
    expect(el('setting-choices').innerHTML).toContain('깨달음 사이드');
    expect(el('setting-choices').innerHTML).toContain('사용 포인트 미확인 / 원본 공급 101P');
    expect(el('setting-choices').innerHTML).not.toContain('data-target="emperor_gift"');
    await choose('enlightenment', 'empress_knight', '3');
    expect(el('setting-status').textContent).toContain('선택 실패');
    await choose('enlightenment', 'empress_knight', '5');
    expect(el('run').disabled).toBe(true); expect(el('export').hidden).toBe(true);
    el('cancel-settings').click(); expect(el('run').disabled).toBe(false);
    await choose('enlightenment', 'empress_knight', '5'); await el('apply-settings').click();
    const text = await exports.get(el('export').href)!.text(), saved = JSON.parse(text);
    expect(saved.setting.selections.enlightenment).toEqual([{ nodeId: 'empress_knight', level: 5 }]);
    expect(saved.build.passiveMods.find((mod: { source: string }) => mod.source === '황후의 기사 Lv5').value).toBe(4);
    el('run').click(); expect(worker.requests[0]!.build).toEqual(saved.build);
    el('build-file').files = [{ name: 'side.json', text: async () => text }];
    await el('build-file').handlers.get('change')!();
    expect(el('result-export').hidden).toBe(true);
    expect(el('setting-choices').innerHTML).toContain('value="5" selected');
    await choose('enlightenment', 'empress_knight', '0'); await el('apply-settings').click();
    expect(JSON.parse(await exports.get(el('export').href)!.text()).build.deckOverrides.add).not.toContain('empress_knight');
    el('reset-settings').click(); await el('apply-settings').click();
    expect(JSON.parse(await exports.get(el('export').href)!.text())).toEqual(base);
  });

  it('blocks a core edit until approximation is selected, then saves, runs, reloads and restores', async () => {
    const { el, choose, exports, worker } = await editor();
    const choices = JSON.parse(readFileSync('data/core_choices.json', 'utf8')).choices;
    const heart = choices.find((item: { slot: { Name: string } }) => item.slot.Name.endsWith(' : 황제의 심장'));
    expect(el('setting-choices').innerHTML).toContain('코어·등급·포인트');
    await choose('cores', '1', heart.id);
    expect(el('run').disabled).toBe(true); expect(el('export').hidden).toBe(true);
    await el('apply-settings').click();
    expect(el('setting-status').textContent).toContain('개별 합산 근사');
    expect(el('run').disabled).toBe(true);
    await el('setting-choices').handlers.get('change')!({ target: { dataset: { coreGemMode: 'true' }, value: 'individual-approximation' } });
    await el('apply-settings').click();
    const text = await exports.get(el('export').href)!.text(), saved = JSON.parse(text);
    expect(saved.setting.selections.coreGemMode).toBe('individual-approximation');
    expect(saved.build.emperorHeartChance).toBe(0.18); expect(saved.build.stackHold).toBeUndefined();
    el('run').click(); expect(worker.requests[0]!.build).toEqual(saved.build);
    el('build-file').files = [{ name: 'core.json', text: async () => text }];
    await el('build-file').handlers.get('change')!();
    expect(el('setting-choices').innerHTML).toContain(`value="${heart.id}" selected`);
    expect(el('setting-choices').innerHTML).toContain('value="individual-approximation" selected');
    expect(el('result-export').hidden).toBe(true);
    await choose('cores', '1', ''); el('cancel-settings').click();
    expect(el('setting-choices').innerHTML).toContain(`value="${heart.id}" selected`);
    el('reset-settings').click(); await el('apply-settings').click();
    expect(JSON.parse(await exports.get(el('export').href)!.text())).toEqual(base);
  });

  it('applies tripod variants, saves evidence, reloads and restores, invalidating stale results', async () => {
    const { el, choose, exports, worker } = await editor();
    const choices = JSON.parse(readFileSync('data/tripod_choices.json', 'utf8')).choices;
    const flip = choices.find((item: any) => item.skillId === 'call_of_destiny' && item.tripod.Name === '페이크 플립' && item.enhancementLevel === null);
    expect(el('setting-choices').innerHTML).toContain('공개 Lv.1 후보');
    await choose('tripods', 'call_of_destiny:2', flip.id);
    expect(el('run').disabled).toBe(true); expect(el('export').hidden).toBe(true);
    await el('apply-settings').click();
    const text = await exports.get(el('export').href)!.text(), saved = JSON.parse(text);
    expect(saved.build.skills.find((s: any) => s.id === 'call_of_destiny').kind).toBe('stack');
    expect(saved.build.rotation.fillers).not.toContain('call_of_destiny');
    el('run').click(); expect(worker.requests[0]!.build).toEqual(saved.build);
    const late = worker.onmessage!, request = worker.requests[0]!;
    await choose('tripods', 'call_of_destiny:2', 'none');
    late({ data: { id: request.id, summary, modelId } });
    expect(el('result-export').hidden).toBe(true); expect(el('out').textContent).toBe('');
    el('cancel-settings').click(); expect(el('run').disabled).toBe(false);
    el('build-file').files = [{ name: 'tripods.json', text: async () => text }];
    await el('build-file').handlers.get('change')!();
    expect(el('setting-choices').innerHTML).toContain(`value="${flip.id}" selected`);
    el('reset-settings').click(); await el('apply-settings').click();
    expect(JSON.parse(await exports.get(el('export').href)!.text())).toEqual(base);
  });

  it('requires gem attack approximation, saves, reloads and restores without stale results', async () => {
    const baseline = await captureSettingBaseline(raw);
    const gemBase = await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId);
    const { el, choose, exports, worker } = await editor(gemBase);
    const choices = JSON.parse(readFileSync('data/gem_choices.json', 'utf8')).choices;
    const low = choices.find((c: any) => c.effect.Name === '황제' && c.gem.Level === 8);
    expect(el('setting-choices').innerHTML).toContain('실제 보석·등급·대상');
    await choose('gems', '0', low.id);
    expect(el('run').disabled).toBe(true); expect(el('export').hidden).toBe(true);
    await el('apply-settings').click();
    expect(el('setting-status').textContent).toContain('비율 환산 근사');
    await el('setting-choices').handlers.get('change')!({ target: { dataset: { gemAttackMode: 'true' }, value: 'ratio-approximation' } });
    expect(el('setting-choices').innerHTML).toContain('12.4% → 12%');
    await el('apply-settings').click();
    const text = await exports.get(el('export').href)!.text(), saved = JSON.parse(text);
    expect(saved.setting.selections.gemAttackMode).toBe('ratio-approximation');
    expect(saved.build.params.atkBase).toBeCloseTo(222811 * 112 / 112.4, 8);
    el('run').click(); expect(worker.requests[0]!.build).toEqual(saved.build);
    const late = worker.onmessage!, request = worker.requests[0]!;
    await choose('gems', '0', 'none'); late({ data: { id: request.id, summary, modelId } });
    expect(el('result-export').hidden).toBe(true); expect(el('out').textContent).toBe('');
    el('cancel-settings').click();
    el('build-file').files = [{ name: 'gems.json', text: async () => text }];
    await el('build-file').handlers.get('change')!();
    expect(el('setting-choices').innerHTML).toContain(`value="${low.id}" selected`);
    expect(el('setting-choices').innerHTML).toContain('value="ratio-approximation" selected');
    el('reset-settings').click(); await el('apply-settings').click();
    expect(JSON.parse(await exports.get(el('export').href)!.text())).toEqual(JSON.parse(gemBase));
  });

  it('clearing an explicit total returns to automatic linkage before applying', async () => {
    const { el, choose } = await editor();
    await choose('evolution', 'stat_치명', '11'); await choose('evolution', 'stat_신속', '29');
    const input = (value: string) => el('setting-choices').handlers.get('input')!({ target: { dataset: { stat: 'crit' }, value } });
    await input('700'); await input('');
    expect(el('stat-preview').textContent).toContain('치명 694');
    el('cancel-settings').click(); expect(el('stat-preview').textContent).toContain('치명 644 (원본 효과 유지)');
  });

  it.each(['manual-3-0', 'evoke-2-0-split', 'evoke-2-1-overlap'])('keeps old %s warnings on import and updates them only on regeneration', async name => {
    const original = readFileSync(`tests/fixtures/audit/2026-10-31-evoke-manual-candidate/final/inputs/${name}.json`, 'utf8');
    const { el, exports, worker } = await editor(original);
    const exported = async () => JSON.parse(await exports.get(el('export').href)!.text());
    expect((await exported()).build).toEqual(JSON.parse(original).build);
    expect((await exported()).warnings).toEqual(JSON.parse(original).warnings);
    await el('regenerate-setting').click();
    const next = await exported();
    expect(next.build.skills.find((s: { id: string }) => s.id === 'evoke').evokeGauge.warningVersion).toBe(2);
    expect(next.warnings.some((w: string) => w.includes('특화 1800') && w.includes('비교 가정'))).toBe(true);
    el('run').click(); expect(worker.requests[0]!.inputWarnings).toEqual(next.warnings);
  });

  it('preserves the old manual input, then selects, removes and exports only supported basic gauge states', async () => {
    const { tripodChoices } = await import('./engine/tripodSettings');
    const original = readFileSync('tests/fixtures/audit/2026-10-31-evoke-manual-candidate/before/inputs/manual-3-1.json', 'utf8');
    const { el, choose, exports, worker } = await editor(original);
    const exported = async () => JSON.parse(await exports.get(el('export').href)!.text());
    expect((await exported()).build).toEqual(JSON.parse(original).build);
    expect((await exported()).warnings).toEqual(JSON.parse(original).warnings);
    await el('regenerate-setting').click();
    expect((await exported()).warnings.some((w: string) => w.includes('변형 원점수'))).toBe(true);
    await choose('tripods', 'evoke:1', 'none');
    for (const name of [null, '빠른 준비', '정신 강화', '퀵 드로']) {
      const choice = name === null ? 'none' : tripodChoices.find(x => x.skillId === 'evoke' && x.source.kind === 'official-observed' && x.tripod.Name === name)!.id;
      await choose('tripods', 'evoke:0', choice); await el('apply-settings').click();
      expect((await exported()).build.skills.find((s: { id: string }) => s.id === 'evoke').evokeGauge)
        .toEqual({ candidate: 'evoke-manual-basic', perHit: [.1196], warningVersion: 2 });
      expect((await exported()).warnings.some((w: string) => w.includes('실게임 지급량 검증이 아닙니다'))).toBe(true);
    }
    const basicText = JSON.stringify(await exported());
    const poison = tripodChoices.find(x => x.skillId === 'evoke' && x.source.kind === 'official-observed' && x.tripod.Name === '마나 중독')!;
    await choose('tripods', 'evoke:1', poison.id); await el('apply-settings').click();
    expect((await exported()).build.skills.find((s: { id: string }) => s.id === 'evoke').evokeGauge).toBeUndefined();
    expect((await exported()).warnings.some((w: string) => w.includes('변형 원점수'))).toBe(true);
    el('build-file').files = [{ name: 'basic.json', text: async () => basicText }];
    await el('build-file').handlers.get('change')!();
    expect(await exported()).toEqual(JSON.parse(basicText));
    el('run').click();
    expect(worker.requests[0]!.build.skills.find(s => s.id === 'evoke')!.evokeGauge?.candidate).toBe('evoke-manual-basic');
    expect(worker.requests[0]!.inputWarnings).toEqual(JSON.parse(basicText).warnings);
  });
});

describe('character selection and simulation response ordering', () => {
  it.each(['preset', 'search', 'failed search'])('reloads the same file after switching to %s', async source => {
    const { el, worker, load } = await mount();
    const saved = { build: { ...preset, name: '저장 입력' }, warnings: ['파일 경고'] };
    const selectFile = async () => {
      // 실제 브라우저는 이미 선택된 같은 파일에 change를 다시 보내지 않습니다.
      if (el('build-file').value === 'saved.json') return;
      el('build-file').value = 'saved.json';
      el('build-file').files = [{ name: 'saved.json', text: async () => JSON.stringify(saved) }];
      await el('build-file').handlers.get('change')!();
    };
    await selectFile();
    if (source === 'preset') el('preset').click();
    else {
      if (source === 'search') fetchArmory.mockResolvedValueOnce(raw);
      else fetchArmory.mockRejectedValueOnce(new Error('조회 실패'));
      await load();
    }
    await selectFile();
    expect(el('build').textContent).toContain('파일: saved.json');
    expect(el('run').disabled).toBe(false);
    el('run').click();
    expect(worker.requests[0]!.build).toEqual(saved.build);
    expect(worker.requests[0]!.inputWarnings).toEqual(saved.warnings);
  });

  it('imports the complete saved Build and warnings and exports a fresh result with screen conditions', async () => {
    const { el, worker, exports } = await mount();
    const text = readFileSync('tests/fixtures/audit/2026-10-18-saved-build-run-42-0.json', 'utf8');
    const input = parseBuildInput(text, '입력');
    el('build-file').files = [{ name: '설정 <img src=x>.json', text: async () => text }];
    await el('build-file').handlers.get('change')!();
    expect(el('build').textContent).toContain('설정 <img src=x>.json');
    expect(el('build').innerHTML).toBe('');
    expect(parseBuildInput(await exports.get(el('export').href)!.text(), '재저장')).toEqual(input);
    el('run').click();
    const request = worker.requests[0]!;
    expect(request.build).toEqual(input.build);
    expect(request.inputWarnings).toEqual(input.warnings);
    expect(request.config).toEqual({ durationSec: 30, iterations: 10, seed: 1 });
    const calculated = { ...simulate(request.build, cardsFor(request.build.variant, request.build.deckOverrides), request.config), inputWarnings: request.inputWarnings };
    worker.onmessage!({ data: { id: request.id, summary: calculated, modelId } });
    const saved = parseResultInput(await exports.get(el('result-export').href)!.text(), '새 결과')!;
    expect(saved.build).toEqual(input.build);
    expect(saved.warnings).toEqual(input.warnings);
    expect(saved.config).toEqual(request.config);
    expect(saved.result).toEqual(calculated);
  });

  it('preserves unknown warning provenance through raw Build import and both exports', async () => {
    const { el, worker, exports } = await mount();
    el('build-file').files = [{ name: 'raw.json', text: async () => JSON.stringify(preset) }];
    await el('build-file').handlers.get('change')!();
    expect(el('build').textContent).toContain('입력 경고가 저장되지 않았습니다');
    expect(parseBuildInput(await exports.get(el('export').href)!.text(), '입력').warnings).toBeNull();
    el('run').click();
    const request = worker.requests[0]!;
    expect(request.inputWarnings).toBeUndefined();
    worker.onmessage!({ data: { id: request.id, summary: simulate(preset, cardsFor('empress'), request.config), modelId } });
    expect(parseResultInput(await exports.get(el('result-export').href)!.text(), '결과')!.warnings).toBeNull();
  });

  it.each(['different', 'missing'] as const)('rejects a %s model in a fresh Worker result and recovers without exposing the failed export', async kind => {
    const { el, worker, revoke } = await mount();
    el('preset').click(); el('run').click();
    worker.onmessage!({ data: { id: worker.requests[0]!.id, summary, modelId } });
    const prior = el('result-export').href;
    el('run').click();
    const failed = worker.instances[1]!, request = worker.requests[1]!;
    failed.onmessage!({ data: { id: request.id, summary,
      ...(kind === 'different' ? { modelId: 'sha256:' + '0'.repeat(64) } : {}) } as WorkerResponse });
    expect(revoke).toHaveBeenCalledWith(prior);
    expect(el('out').textContent).toContain('계산 모델');
    expect(el('out').textContent).toContain('실패:');
    expect(el('result-export').hidden).toBe(true);
    expect(el('result-export').href).toBe('');
    expect(failed.terminate).toHaveBeenCalledOnce();
    expect(el('run').disabled).toBe(false);
    el('run').click();
    worker.onmessage!({ data: { id: worker.requests[2]!.id, summary, modelId } });
    failed.onmessage!({ data: { id: request.id, summary, modelId } });
    expect(el('result-export').hidden).toBe(false);
    expect(el('out').textContent).not.toContain('실패:');
  });

  it('rejects a non-finite result from an edited input without offering a completed export', async () => {
    const { el, worker } = await mount();
    const edited = structuredClone(preset); edited.params.atkBase = 1e308;
    el('build-file').files = [{ name: 'overflow.json', text: async () => JSON.stringify(edited) }];
    await el('build-file').handlers.get('change')!();
    el('run').click();
    const request = worker.requests[0]!;
    const calculated = simulate(request.build, cardsFor('empress'), request.config);
    expect(calculated.samples.some(value => !Number.isFinite(value))).toBe(true);
    worker.onmessage!({ data: { id: request.id, summary: calculated, modelId } });
    expect(el('out').textContent).toContain('실패:');
    expect(el('result-export').hidden).toBe(true);
    expect(el('run').disabled).toBe(false);
  });

  it.each(['malformed', 'read failure'])('clears old input and calculation on %s and allows a new selection', async kind => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click();
    const old = worker.instances[0]!;
    el('build-file').files = [{ name: 'bad.json', text: async () => { if (kind === 'read failure') throw new Error('읽기 실패'); return '{'; } }];
    await el('build-file').handlers.get('change')!();
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(el('build').textContent).toContain('실패:');
    expect(el('run').disabled).toBe(true);
    expect(el('export').hidden).toBe(true);
    expect(el('result-export').hidden).toBe(true);
    el('preset').click();
    expect(el('run').disabled).toBe(false);
  });

  it.each(['load', 'compare'] as const)('rejects invalid UTF-8 bytes during %s and recovers with the valid file', async mode => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click();
    worker.onmessage!({ data: { id: worker.requests[0]!.id, summary, modelId } });
    const value = { ...preset, name: '파일~검사\uFEFF\uFFFD' }, text = '\uFEFF' + JSON.stringify(value);
    const bytes = new TextEncoder().encode(text).map(byte => byte === 0x7e ? 0xff : byte);
    const target = mode === 'load' ? 'build-file' : 'after-file';
    const submit = () => mode === 'load' ? el(target).handlers.get('change')!() : el('compare').click();
    el('before-file').files = [{ name: '기준.json', text: async () => text }];
    el(target).files = [{ name: '잘못된 바이트.json', text: async () => text }];
    Object.defineProperty(el(target).files[0], 'arrayBuffer', { value: async () => bytes.buffer });
    await submit();
    expect(el(mode === 'load' ? 'build' : 'comparison').textContent).toContain('실패:');
    if (mode === 'load') {
      expect(el('run').disabled).toBe(true);
      expect(el('export').hidden).toBe(true); expect(el('result-export').hidden).toBe(true);
    } else {
      expect(el('compare').disabled).toBe(false);
      expect(el('result-export').hidden).toBe(false);
    }
    el(target).files = [{ name: '정상.json', text: async () => text }];
    await submit();
    expect(el(mode === 'load' ? 'build' : 'comparison').textContent).toContain(value.name);
    expect(el(mode === 'load' ? 'build' : 'comparison').textContent).not.toContain('실패:');
  });

  it.each(['preset', 'file', 'search'])('ignores a file read superseded by a newer %s', async selection => {
    const { el, load } = await mount();
    let resolve!: (text: string) => void;
    el('build-file').files = [{ name: 'old.json', text: () => new Promise<string>(yes => { resolve = yes; }) }];
    const pending = el('build-file').handlers.get('change')!();
    if (selection === 'preset') el('preset').click();
    else if (selection === 'search') { fetchArmory.mockResolvedValueOnce(raw); await load(); }
    else {
      el('build-file').files = [{ name: 'new.json', text: async () => JSON.stringify(preset) }];
      await el('build-file').handlers.get('change')!();
    }
    const selected = el('build').textContent;
    resolve('{'); await pending;
    expect(el('build').textContent).toBe(selected);
    expect(el('run').disabled).toBe(false);
  });

  it('aborts an older search when a file is selected and ignores its late response', async () => {
    const { el, load } = await mount(), pending = deferred();
    fetchArmory.mockReturnValueOnce(pending.promise);
    const loading = load(), signal = fetchArmory.mock.calls[0]![1] as AbortSignal;
    el('build-file').files = [{ name: '선택.json', text: async () => JSON.stringify(preset) }];
    await el('build-file').handlers.get('change')!();
    expect(signal.aborted).toBe(true);
    const selected = el('build').textContent;
    pending.resolve(raw); await loading;
    expect(el('build').textContent).toBe(selected);
  });

  it('terminates a timed-out Worker, ignores its late success, and permits retry', async () => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click();
    const old = worker.instances[0]!, id = worker.requests[0]!.id;
    vi.advanceTimersByTime(30000);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(el('out').textContent).toContain('30초');
    expect(el('run').disabled).toBe(false);
    old.onmessage!({ data: { id, summary, modelId } });
    expect(el('result-export').hidden).toBe(true);
    el('run').click();
    worker.onmessage!({ data: { id: worker.requests[1]!.id, summary, modelId } });
    vi.advanceTimersByTime(30000);
    expect(el('result-export').hidden).toBe(false);
    expect(el('out').textContent).not.toContain('실패:');
  });

  it('does not let a previous selection timer terminate the replacement run', async () => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click();
    vi.advanceTimersByTime(29000);
    el('preset').click(); el('run').click();
    vi.advanceTimersByTime(1000);
    expect(worker.instances[1]!.terminate).not.toHaveBeenCalled();
    expect(el('out').textContent).toBe('실행 중...');
    vi.advanceTimersByTime(29000);
    expect(worker.instances[1]!.terminate).toHaveBeenCalledOnce();
  });

  it('shows saved result metrics and calculation warnings while preserving the selected build', async () => {
    const { el, worker } = await mount();
    el('preset').click();
    const selected = el('build').textContent;
    const input = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-ui-result-export-downloaded.json', 'utf8'));
    input.result.damageWarnings.push('계산 경고 <img src=x>');
    const text = JSON.stringify(input);
    el('before-file').files = [{ name: '기준.json', text: async () => text }];
    el('after-file').files = [{ name: '비교.json', text: async () => text }];
    await el('compare').click();
    expect(el('comparison').textContent).toContain('저장 결과 수치 차이 56개');
    expect(el('comparison').textContent).toContain('DPS 평균');
    expect(el('comparison').textContent).toContain('30초 · 10회 · seed 1');
    expect(el('comparison').textContent).toContain('계산 경고 <img src=x>');
    expect(el('comparison').textContent).toContain('엔진 버전');
    expect(el('comparison').innerHTML).toBe('');
    expect(el('build').textContent).toBe(selected);
    expect(worker.requests).toHaveLength(0);
  });

  it('shows both run conditions but no numeric deltas when saved seeds differ', async () => {
    const { el } = await mount();
    const input = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-ui-result-export-downloaded.json', 'utf8'));
    el('before-file').files = [{ name: '기준.json', text: async () => JSON.stringify({ ...input, config: { ...input.config, seed: 42 } }) }];
    el('after-file').files = [{ name: '비교.json', text: async () => JSON.stringify(input) }];
    await el('compare').click();
    expect(el('comparison').textContent).toContain('seed 42');
    expect(el('comparison').textContent).toContain('seed 1');
    expect(el('comparison').textContent).toContain('실행 조건 seed가 다릅니다.');
    expect(el('comparison').textContent).not.toContain('DPS 평균');
  });

  it('blocks numeric deltas in the UI when two stored model identities differ', async () => {
    const { el } = await mount();
    const input = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-ui-result-export-downloaded.json', 'utf8'));
    el('before-file').files = [{ name: '이전 모델.json', text: async () => JSON.stringify({ ...input, modelId: 'sha256:' + 'a'.repeat(64) }) }];
    el('after-file').files = [{ name: '새 모델.json', text: async () => JSON.stringify({ ...input, modelId }) }];
    await el('compare').click();
    expect(el('comparison').textContent).toContain('계산 모델 식별값이 다릅니다');
    expect(el('comparison').textContent).toContain('전체 설정 차이 0개');
    expect(el('comparison').textContent).not.toContain('DPS 평균');
  });

  it.each(['missing', 'malformed'])('keeps structural differences when one result is %s', async kind => {
    const { el } = await mount();
    const input = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-ui-result-export-downloaded.json', 'utf8'));
    const changed = structuredClone(input); changed.build.stats.crit++;
    if (kind === 'missing') { delete changed.result; delete changed.config; }
    else changed.result.samples.pop();
    el('before-file').files = [{ name: '기준.json', text: async () => JSON.stringify(input) }];
    el('after-file').files = [{ name: '변경.json', text: async () => JSON.stringify(changed) }];
    await el('compare').click();
    expect(el('comparison').textContent).toContain('전체 설정 차이 1개');
    expect(el('comparison').textContent).toContain('수치 비교 불가:');
    expect(el('comparison').textContent).not.toContain('DPS 평균');
    expect(el('compare').disabled).toBe(false);
  });

  it('exports the completed result with the original input, warnings, conditions, and samples', async () => {
    const { el, worker, exports, load } = await mount();
    expect(el('result-export').hidden).toBe(true);
    fetchArmory.mockResolvedValueOnce(raw);
    await load(); el('run').click();
    const request = worker.requests[0]!;
    const calculated = { ...simulate(request.build, cardsFor(request.build.variant, request.build.deckOverrides), request.config), inputWarnings: request.inputWarnings };
    el('dur').value = '60'; el('iter').value = '20'; el('seed').value = '42';
    worker.onmessage!({ data: { id: request.id, summary: calculated, modelId } });
    expect(el('result-export').hidden).toBe(false);
    const blob = exports.get(el('result-export').href)!;
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    const { setting, summary: savedSummary, ...completed } = JSON.parse(text);
    expect(completed).toEqual(JSON.parse(JSON.stringify({ build: request.build, warnings: request.inputWarnings, config: request.config, result: calculated, modelId })));
    expect(setting.baseline.raw).toEqual(raw);
    expect(savedSummary).toEqual(buildFromArmory(raw).summary);
    expect((await readSettingInput(text, '결과 선택 정보', modelId)).status).toBe('editable');
    expect(JSON.parse(text).config).toEqual({ durationSec: 30, iterations: 10, seed: 1 });
    const restored = parseBuildInput(text, '결과.json');
    expect(diffBuilds(restored.build, request.build)).toEqual([]);
    expect(restored.warnings).toEqual(request.inputWarnings);
  });

  it('revokes an earlier result on a new run, keeps a failed result unavailable, and permits retry', async () => {
    const { el, worker, exports, revoke } = await mount();
    el('preset').click(); el('run').click();
    worker.onmessage!({ data: { id: worker.requests[0]!.id, summary, modelId } });
    const previous = el('result-export').href;
    expect(exports.has(previous)).toBe(true);
    el('run').click();
    expect(el('result-export').hidden).toBe(true);
    expect(el('result-export').href).toBe('');
    expect(revoke).toHaveBeenCalledWith(previous);
    worker.onmessage!({ data: { id: worker.requests[1]!.id, error: '계산 실패' } });
    expect(el('result-export').hidden).toBe(true);
    el('run').click();
    worker.onmessage!({ data: { id: worker.requests[2]!.id, summary, modelId } });
    expect(el('result-export').hidden).toBe(false);
    expect(el('result-export').href).not.toBe(previous);
  });

  it.each(['preset', 'search'])('removes the completed download when a new %s replaces the input', async selection => {
    const { el, worker, load, revoke } = await mount();
    el('preset').click(); el('run').click();
    const first = worker.instances[0]!, request = worker.requests[0]!;
    first.onmessage!({ data: { id: request.id, summary, modelId } });
    const previous = el('result-export').href;
    expect(el('result-export').hidden).toBe(false);
    if (selection === 'preset') el('preset').click();
    else {
      fetchArmory.mockRejectedValueOnce(new Error('조회 실패'));
      await load();
    }
    expect(revoke).toHaveBeenCalledWith(previous);
    expect(el('result-export').hidden).toBe(true);
    expect(el('result-export').href).toBe('');
    first.onmessage!({ data: { id: request.id, summary, modelId } });
    expect(el('result-export').hidden).toBe(true);
  });

  it('does not replace the current download with a late result from a canceled run', async () => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click();
    const first = worker.instances[0]!, oldId = worker.requests[0]!.id;
    el('preset').click(); el('run').click();
    worker.onmessage!({ data: { id: worker.requests[1]!.id, summary, modelId } });
    const current = el('result-export').href;
    expect(current).not.toBe('');
    first.onmessage!({ data: { id: oldId, summary, modelId } });
    expect(el('result-export').href).toBe(current);
    expect(el('result-export').hidden).toBe(false);
  });

  it('aborts a stalled search at 30 seconds and allows a new search', async () => {
    vi.useFakeTimers();
    const { el, load } = await mount();
    fetchArmory.mockImplementationOnce((_name: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('body read aborted')), { once: true });
    }));
    const loading = load(), signal = fetchArmory.mock.calls[0]![1] as AbortSignal;
    await vi.advanceTimersByTimeAsync(29999);
    expect(signal.aborted).toBe(false);
    expect(el('build').textContent).toBe('불러오는 중...');
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    await loading;
    expect(el('build').textContent).toContain('30초');
    expect(el('build').textContent).toContain('다시 시도');
    expect(el('run').disabled).toBe(true);
    expect(el('export').hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    fetchArmory.mockResolvedValueOnce(raw);
    await load();
    expect(el('run').disabled).toBe(false);
    expect(el('export').hidden).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives a replacement search its own full timeout and clears the earlier timer', async () => {
    vi.useFakeTimers();
    const { el, load } = await mount();
    fetchArmory.mockImplementation((_name: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const first = load();
    await vi.advanceTimersByTimeAsync(20000);
    const second = load(), signal = fetchArmory.mock.calls[1]![1] as AbortSignal;
    await first;
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(signal.aborted).toBe(false);
    expect(el('build').textContent).toBe('불러오는 중...');
    await vi.advanceTimersByTimeAsync(20000);
    expect(signal.aborted).toBe(true);
    await second;
    expect(vi.getTimerCount()).toBe(0);
    expect(el('build').textContent).toContain('30초');
  });

  it('clears a search timer when a preset replaces the search', async () => {
    vi.useFakeTimers();
    const { el, load } = await mount();
    fetchArmory.mockImplementationOnce((_name: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const loading = load();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(20000);
    el('preset').click(); await loading;
    const selected = el('build').textContent, download = el('export').href;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(el('build').textContent).toBe(selected);
    expect(el('export').href).toBe(download);
    expect(el('run').disabled).toBe(false);
  });

  it('compares multiple changed settings and preserves both files warnings without changing the selected build', async () => {
    const { el, worker } = await mount();
    el('preset').click();
    const rendered = el('build').textContent, selectedDownload = el('export').href;
    const changed = structuredClone(preset);
    changed.stats.crit += 100;
    changed.skills[0]!.castTime += 0.1;
    el('before-file').files = [{ name: '기준.json', text: async () => JSON.stringify({ build: preset, warnings: ['기준 경고'] }) }];
    el('after-file').files = [{ name: '변경.json', text: async () => JSON.stringify({ build: changed, warnings: ['변경 경고 <img src=x>'] }) }];
    el('after-file').handlers.get('change')!();
    expect(el('compare').disabled).toBe(false);
    await el('compare').click();
    expect(el('comparison').textContent).toContain('전체 설정 차이 2개');
    expect(el('comparison').textContent).toContain('/stats/crit');
    expect(el('comparison').textContent).toContain('/skills/0/castTime');
    expect(el('comparison').textContent).toContain(`${preset.skills[0]!.name} · 시전 시간`);
    expect(el('comparison').textContent).toContain('특성 기록');
    expect(el('comparison').textContent).toContain('기준 경고');
    expect(el('comparison').textContent).toContain('변경 경고 <img src=x>');
    expect(el('comparison').textContent.indexOf('/stats/crit')).toBeLessThan(el('comparison').textContent.indexOf('기준 경고'));
    expect(el('comparison').innerHTML).toBe('');
    expect(el('build').textContent).toBe(rendered);
    expect(el('export').href).toBe(selectedDownload);
    expect(worker.requests).toHaveLength(0);
  });

  it('shows missing warning provenance even when the selected Build files are identical', async () => {
    const { el } = await mount();
    el('before-file').files = [{ name: '원본.json', text: async () => JSON.stringify(preset) }];
    el('after-file').files = [{ name: '포함.json', text: async () => JSON.stringify({ build: preset, warnings: [] }) }];
    await el('compare').click();
    expect(el('comparison').textContent).toContain('전체 설정 차이 0개');
    expect(el('comparison').textContent).toContain('입력 경고가 저장되지 않았습니다');
    expect(el('comparison').textContent).toContain('입력 경고 0개');
  });

  it('discards a pending comparison after a selected file is removed', async () => {
    const { el } = await mount();
    let finish!: (text: string) => void;
    const pending = new Promise<string>(resolve => { finish = resolve; });
    el('before-file').files = [{ name: '이전.json', text: () => pending }];
    el('after-file').files = [{ name: '다음.json', text: async () => JSON.stringify(preset) }];
    const comparing = el('compare').click();
    el('before-file').files = [];
    el('before-file').handlers.get('change')!();
    expect(el('comparison').textContent).toBe('');
    expect(el('compare').disabled).toBe(true);
    finish(JSON.stringify(preset)); await comparing;
    expect(el('comparison').textContent).toBe('');
    expect(el('compare').disabled).toBe(true);
  });

  it('shows the failed file and permits comparison after choosing a valid replacement', async () => {
    const { el } = await mount();
    el('before-file').files = [{ name: '깨진.json', text: async () => '{broken' }];
    el('after-file').files = [{ name: '정상.json', text: async () => JSON.stringify(preset) }];
    await el('compare').click();
    expect(el('comparison').textContent).toContain('실패: JSON 형식을 확인하세요: 깨진.json');
    expect(el('compare').disabled).toBe(false);
    el('before-file').files = el('after-file').files;
    el('before-file').handlers.get('change')!();
    await el('compare').click();
    expect(el('comparison').textContent).toContain('전체 설정 차이 0개');
  });

  it('cancels unfinished endpoint requests when the current import fails', async () => {
    const { el, load } = await mount(), pending = deferred();
    fetchArmory.mockReturnValueOnce(pending.promise);
    const loading = load(), signal = fetchArmory.mock.calls[0]![1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    pending.reject(new Error('503: gems')); await loading;
    expect(signal.aborted).toBe(true);
    expect(el('build').textContent).toBe('실패: 503: gems');
    expect(el('run').disabled).toBe(true);
    expect(el('export').hidden).toBe(true);
    fetchArmory.mockResolvedValueOnce(raw);
    await load();
    expect(el('run').disabled).toBe(false);
    expect(el('export').hidden).toBe(false);
  });

  it('exports the complete searched build, summary, and input warnings without calculating', async () => {
    const { el, load, exports, worker } = await mount();
    fetchArmory.mockResolvedValueOnce(raw);
    expect(el('export').hidden).toBe(true);
    await load();
    expect(el('export').hidden).toBe(false);
    const blob = exports.get(el('export').href)!;
    expect(blob.type).toBe('application/json');
    const text = await blob.text(), { setting, ...converted } = JSON.parse(text);
    expect(converted).toEqual(JSON.parse(JSON.stringify(buildFromArmory(raw))));
    expect(setting.baseline.raw).toEqual(raw);
    expect(setting.source.kind).toBe('api-snapshot');
    expect((await readSettingInput(text, '검색 저장', modelId)).status).toBe('editable');
    expect(worker.requests).toHaveLength(0);
  });

  it('exports a preset with its limitations and replaces the old download when selected again', async () => {
    const { el, exports, revoke } = await mount();
    el('preset').click();
    const previous = el('export').href, exported = JSON.parse(await exports.get(previous)!.text());
    expect(exported.build).toEqual(JSON.parse(JSON.stringify(preset)));
    expect(exported.warnings).toContain('손으로 옮긴 프리셋');
    expect(exported.warnings.length).toBeGreaterThan(1);
    expect(exported.summary[0]).toBe(preset.name);
    el('preset').click();
    expect(revoke).toHaveBeenCalledWith(previous);
    expect(el('export').href).not.toBe(previous);
  });

  it('removes the previous download during a search and keeps it unavailable after failure', async () => {
    const { el, load, revoke } = await mount(), pending = deferred();
    el('preset').click();
    const previous = el('export').href;
    fetchArmory.mockReturnValueOnce(pending.promise);
    const loading = load();
    expect(el('export').hidden).toBe(true);
    expect(el('export').href).toBe('');
    expect(revoke).toHaveBeenCalledWith(previous);
    pending.reject(new Error('조회 실패')); await loading;
    expect(el('export').hidden).toBe(true);
    expect(el('export').href).toBe('');
  });

  it('keeps the current preset download when an older search resolves', async () => {
    const { el, load, exports } = await mount(), pending = deferred();
    fetchArmory.mockReturnValueOnce(pending.promise);
    const loading = load();
    el('preset').click();
    const url = el('export').href;
    pending.resolve(raw); await loading;
    expect(el('export').href).toBe(url);
    expect(JSON.parse(await exports.get(url)!.text()).build.name).toBe(preset.name);
  });

  it('aborts a previous search without aborting the new search when the old promise rejects', async () => {
    const { el, load } = await mount(), first = deferred(), second = deferred();
    fetchArmory.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstLoad = load();
    const firstSignal = fetchArmory.mock.calls[0]![1] as AbortSignal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    const secondLoad = load();
    const secondSignal = fetchArmory.mock.calls[1]![1] as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    first.reject(new DOMException('취소', 'AbortError')); await firstLoad;
    expect(el('build').textContent).toBe('불러오는 중...');
    expect(secondSignal.aborted).toBe(false);
    second.resolve(raw); await secondLoad;
    expect(el('build').textContent).toContain(raw.profiles.CharacterName);
    expect(el('run').disabled).toBe(false);
  });

  it('aborts a pending search on preset selection and keeps that selection after rejection', async () => {
    const { el, load } = await mount(), pending = deferred();
    fetchArmory.mockReturnValueOnce(pending.promise);
    const loading = load(), signal = fetchArmory.mock.calls[0]![1] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    el('preset').click();
    expect(signal.aborted).toBe(true);
    const rendered = el('build').textContent;
    pending.reject(new DOMException('취소', 'AbortError')); await loading;
    expect(el('build').textContent).toBe(rendered);
    expect(el('run').disabled).toBe(false);
  });

  it.each(['constructor', 'postMessage'] as const)('recovers from a synchronous Worker %s failure and permits a new run', async failure => {
    const { el, worker } = await mount(failure);
    el('preset').click();
    expect(() => el('run').click()).not.toThrow();
    expect(el('out').textContent).toContain(failure === 'constructor' ? 'Worker 생성 실패' : 'Worker 전송 실패');
    expect(el('run').disabled).toBe(false);
    if (failure === 'postMessage') expect(worker.instances[0]!.terminate).toHaveBeenCalledOnce();
    el('run').click();
    worker.onmessage!({ data: { id: worker.requests[0]!.id, summary, modelId } });
    expect(el('out').textContent).toContain(summary.build);
  });

  it.each(['모듈 불러오기 실패', ''])('shows a native Worker error and permits a later run (%s)', async message => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click();
    const first = worker.instances[0]!;
    expect(first.onerror).toBeTypeOf('function');
    first.onerror!({ message });
    expect(el('out').textContent).toContain(message || '계산 작업을 시작하거나 실행하지 못했습니다.');
    expect(el('run').disabled).toBe(false);
    expect(first.terminate).toHaveBeenCalledOnce();
    el('run').click();
    worker.onmessage!({ data: { id: worker.requests[1]!.id, summary, modelId } });
    expect(el('out').textContent).toContain(summary.build);
  });

  it('ignores a native error from a Worker that was canceled or completed', async () => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click();
    const first = worker.instances[0]!;
    el('preset').click(); el('run').click();
    expect(first.onerror).toBeTypeOf('function');
    first.onerror!({ message: '취소된 계산의 오류' });
    expect(el('out').textContent).toBe('실행 중...');
    expect(el('run').disabled).toBe(true);
    const second = worker.instances[1]!;
    second.onmessage!({ data: { id: worker.requests[1]!.id, summary, modelId } });
    const rendered = el('out').textContent;
    second.onerror!({ message: '완료된 계산의 오류' });
    expect(el('out').textContent).toBe(rendered);
    expect(second.terminate).toHaveBeenCalledOnce();
  });

  it('terminates a superseded calculation and runs the new selection in a fresh Worker', async () => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click();
    const first = worker.instances[0]!, firstId = worker.requests[0]!.id;
    el('preset').click();
    expect(first.terminate).toHaveBeenCalledOnce();
    el('run').click();
    expect(worker.instances).toHaveLength(2);
    const second = worker.instances[1]!;
    expect(second).not.toBe(first);
    first.onmessage!({ data: { id: firstId, summary, modelId } });
    expect(el('out').textContent).toBe('실행 중...');
    second.onmessage!({ data: { id: worker.requests[1]!.id, summary, modelId } });
    expect(el('out').textContent).toContain(summary.build);
    expect(second.terminate).toHaveBeenCalledOnce();
  });

  it('stops the previous calculation as soon as a new search starts, before its response', async () => {
    const { el, worker, load } = await mount();
    el('preset').click(); el('run').click();
    const first = worker.instances[0]!, pending = deferred();
    fetchArmory.mockReturnValueOnce(pending.promise);
    const loading = load();
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(el('run').disabled).toBe(true);
    pending.resolve(raw); await loading;
    el('run').click();
    expect(worker.instances).toHaveLength(2);
    expect(worker.requests[1]!.build.name).toContain(raw.profiles.CharacterName);
  });

  it('carries unsupported imported effects into the result without duplicating common warnings', async () => {
    const { el, worker, load } = await mount(), imported = structuredClone(raw);
    imported.combatSkills.find(skill => skill.Name === '리턴')!.Rune = { Name: '출혈', Grade: '전설', Tooltip: '' };
    fetchArmory.mockResolvedValueOnce(imported);
    await load(); el('run').click();
    const request = worker.requests[0]!;
    const warning = '룬 출혈(도트) 미모델 (return)';
    expect(request.inputWarnings).toContain(warning);
    const calculated = simulate(request.build, cardsFor(request.build.variant, request.build.deckOverrides), request.config);
    const response = { id: request.id, modelId, summary: { ...calculated, inputWarnings: request.inputWarnings } };
    worker.onmessage!({ data: response });
    expect(el('out').textContent).toContain(warning);
    expect(el('out').textContent.split(calculated.damageWarnings[0]!).length - 1).toBe(1);
    el('preset').click(); el('run').click();
    const next = worker.requests[1]!;
    expect(next.inputWarnings).not.toContain(warning);
  });

  it('clears the old build immediately and keeps an unsupported class from running', async () => {
    const { el, worker, load } = await mount();
    el('preset').click(); el('run').click();
    const oldId = worker.requests[0]!.id, pending = deferred();
    fetchArmory.mockReturnValueOnce(pending.promise);
    const loading = load();
    expect(el('run').disabled).toBe(true); expect(el('out').textContent).toBe('');
    el('run').click(); expect(worker.requests).toHaveLength(1);
    pending.resolve({ ...raw, profiles: { ...raw.profiles, CharacterClassName: '바드' } });
    await loading;
    expect(el('build').textContent).toContain('아르카나 캐릭터만 지원합니다');
    expect(el('run').disabled).toBe(true);
    worker.onmessage!({ data: { id: oldId, summary, modelId } });
    worker.onmessage!({ data: { id: oldId, error: '오래된 오류' } });
    expect(el('out').textContent).toBe(''); expect(el('run').disabled).toBe(true);
    el('run').click(); expect(worker.requests).toHaveLength(1);
    el('preset').click(); expect(el('run').disabled).toBe(false);
  });

  it.each(['success', 'failure'])('ignores an older search %s after a newer search succeeds', async outcome => {
    const { el, load } = await mount(), first = deferred(), second = deferred();
    fetchArmory.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstLoad = load(), secondLoad = load();
    second.resolve({ ...raw, profiles: { ...raw.profiles, CharacterName: '새 검색' } }); await secondLoad;
    const display = el('build').textContent;
    expect(display).toContain('새 검색');
    if (outcome === 'success') first.resolve({ ...raw, profiles: { ...raw.profiles, CharacterName: '이전 검색' } });
    else first.reject(new Error('이전 검색 오류'));
    await firstLoad;
    expect(el('build').textContent).toBe(display); expect(el('run').disabled).toBe(false);
  });

  it.each(['success', 'failure'])('keeps a chosen preset when a pending search ends with %s', async outcome => {
    const { el, load } = await mount(), pending = deferred();
    fetchArmory.mockReturnValueOnce(pending.promise);
    const loading = load(); el('preset').click();
    const display = el('build').textContent;
    if (outcome === 'success') pending.resolve(raw); else pending.reject(new Error('검색 실패'));
    await loading;
    expect(el('build').textContent).toBe(display); expect(el('run').disabled).toBe(false);
  });

  it('ignores old Worker responses while a newer simulation remains pending', async () => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click(); const oldId = worker.requests[0]!.id;
    el('preset').click(); el('run').click(); const newId = worker.requests[1]!.id;
    worker.onmessage!({ data: { id: oldId, summary, modelId } });
    worker.onmessage!({ data: { id: oldId, error: '오래된 오류' } });
    expect(el('out').textContent).toBe('실행 중...'); expect(el('run').disabled).toBe(true);
    worker.onmessage!({ data: { id: newId, summary, modelId } });
    expect(el('out').textContent).toContain(summary.build); expect(el('run').disabled).toBe(false);
  });

  it('shows the current Worker error and permits a later run', async () => {
    const { el, worker } = await mount();
    el('preset').click(); el('run').click();
    worker.onmessage!({ data: { id: worker.requests[0]!.id, error: '계산 실패' } });
    expect(el('out').textContent).toBe('실패: 계산 실패'); expect(el('run').disabled).toBe(false);
    el('run').click();
    worker.onmessage!({ data: { id: worker.requests[1]!.id, summary, modelId } });
    expect(el('out').textContent).toContain(summary.build); expect(el('run').disabled).toBe(false);
  });
});

describe('selection file preservation and explicit regeneration', () => {
  async function selectionText() {
    const baseline = await captureSettingBaseline(raw);
    return saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId);
  }

  it('preserves a selection file verbatim on import and keeps its selections in a fresh result', async () => {
    const text = '\uFEFF' + await selectionText(), { el, worker, exports } = await mount();
    el('build-file').files = [{ name: '선택.json', text: async () => text }];
    await el('build-file').handlers.get('change')!();
    expect(new Uint8Array(await exports.get(el('export').href)!.arrayBuffer())).toEqual(new TextEncoder().encode(text));
    expect(el('regenerate-setting').hidden).toBe(true);
    el('run').click(); const request = worker.requests[0]!;
    const calculated = { ...simulate(request.build, cardsFor(request.build.variant, request.build.deckOverrides), request.config), inputWarnings: request.inputWarnings };
    worker.onmessage!({ data: { id: request.id, summary: calculated, modelId } });
    const resultText = await exports.get(el('result-export').href)!.text();
    expect((await readSettingInput(resultText, '새 결과', modelId)).status).toBe('editable');
    expect(JSON.parse(resultText).setting).toEqual(JSON.parse(text.slice(1)).setting);
  });

  it('rejects a mismatched selection file for loading and comparison, then recovers with a preset', async () => {
    const saved = JSON.parse(await selectionText()); saved.build.stats.crit++;
    const text = JSON.stringify(saved), { el, worker } = await mount();
    el('build-file').files = [{ name: '불일치.json', text: async () => text }];
    await el('build-file').handlers.get('change')!();
    expect(el('build').textContent).toContain('일치하지 않습니다'); expect(el('run').disabled).toBe(true);
    el('before-file').files = el('after-file').files = el('build-file').files;
    await el('compare').click(); expect(el('comparison').textContent).toContain('일치하지 않습니다');
    expect(el('comparison').textContent).not.toContain('DPS 평균');
    el('preset').click(); el('run').click(); expect(worker.requests).toHaveLength(1);
  });

  it('shows a different model, preserves the original file and regenerates only on request', async () => {
    const saved = JSON.parse(await selectionText()); saved.setting.compiledWith = 'sha256:' + '0'.repeat(64); saved.build.stats.crit++;
    saved.result = { old: true }; saved.config = { old: true };
    const text = JSON.stringify(saved), { el, exports } = await mount();
    el('build-file').files = [{ name: '이전 모델.json', text: async () => text }];
    await el('build-file').handlers.get('change')!();
    expect(el('build').textContent).toContain('모델이 다릅니다'); expect(el('regenerate-setting').hidden).toBe(false);
    expect(await exports.get(el('export').href)!.text()).toBe(text);
    await el('regenerate-setting').click();
    expect(el('build').textContent).toContain('계산 입력 차이 1개'); expect(el('regenerate-setting').hidden).toBe(true);
    const nextText = await exports.get(el('export').href)!.text();
    expect((await readSettingInput(nextText, '재생성', modelId)).status).toBe('editable');
    expect(JSON.parse(nextText)).not.toHaveProperty('result'); expect(JSON.parse(nextText)).not.toHaveProperty('config');
    expect(JSON.stringify(saved)).toBe(text);
  });

  it('does not apply a late regeneration after the user chooses a preset', async () => {
    const saved = JSON.parse(await selectionText()); saved.setting.compiledWith = 'sha256:' + '0'.repeat(64);
    const { el, exports } = await mount();
    el('build-file').files = [{ name: '이전 모델.json', text: async () => JSON.stringify(saved) }];
    await el('build-file').handlers.get('change')!();
    const regenerating = el('regenerate-setting').click(); el('preset').click();
    const selected = el('export').href; await regenerating;
    expect(el('export').href).toBe(selected); expect(JSON.parse(await exports.get(selected)!.text()).build.name).toBe(preset.name);
  });

  it('keeps an unknown selection version for replay without enabling regeneration', async () => {
    const saved = JSON.parse(await selectionText()); saved.setting = { version: 2, unknown: ['preserve'] };
    const text = JSON.stringify(saved), { el, exports, worker } = await mount();
    el('build-file').files = [{ name: '새 형식.json', text: async () => text }];
    await el('build-file').handlers.get('change')!();
    expect(el('build').textContent).toContain('버전 2'); expect(el('regenerate-setting').hidden).toBe(true);
    expect(await exports.get(el('export').href)!.text()).toBe(text);
    el('run').click(); expect(worker.requests[0]!.build).toEqual(saved.build);
  });

  it('restores the unchanged replay input when current-model regeneration cannot apply old choices', async () => {
    const saved = JSON.parse(await selectionText()); saved.setting.compiledWith = 'sha256:' + '0'.repeat(64);
    saved.setting.selections.runes = [{ targetSkillId: 'unknown', sourceSkillId: null }];
    const text = JSON.stringify(saved), { el, exports, worker } = await mount();
    el('build-file').files = [{ name: '이전 선택.json', text: async () => text }];
    await el('build-file').handlers.get('change')!(); await el('regenerate-setting').click();
    expect(el('build').textContent).toContain('재생성 실패'); expect(el('run').disabled).toBe(false);
    expect(await exports.get(el('export').href)!.text()).toBe(text);
    el('run').click(); expect(worker.requests[0]!.build).toEqual(saved.build);
  });
});
