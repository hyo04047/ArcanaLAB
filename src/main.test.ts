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

const { fetchArmory } = vi.hoisted(() => ({ fetchArmory: vi.fn() }));
vi.mock('./api', () => ({ fetchArmory }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); fetchArmory.mockReset(); });

const record = JSON.parse(readFileSync('tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', 'utf8')).records[0];
const raw = Object.fromEntries(record.responses.map((r: { endpoint: string; body: string }) =>
  [r.endpoint === 'combat-skills' ? 'combatSkills' : r.endpoint, JSON.parse(r.body)])) as unknown as RawArmory;
const preset = empressInkomsu440();
const summary = { ...simulate(preset, cardsFor('empress'), { durationSec: 30, iterations: 10, seed: 1 }),
  inputWarnings: ['손으로 옮긴 프리셋', ...damageWarnings(preset), ...cardSupplyWarnings(preset)] };

it('runs and exports the chosen partitioned mode even after the selector changes', async () => {
  const { el, worker, exports } = await mount();
  el('preset').click(); el('random-mode').value = 'partitioned-v1'; el('run').click();
  const request = worker.requests[0]!;
  expect(request.config.randomMode).toBe('partitioned-v1');
  const result = { ...simulate(request.build, cardsFor(request.build.variant, request.build.deckOverrides), request.config), inputWarnings: request.inputWarnings };
  el('random-mode').value = 'legacy';
  worker.onmessage!({ data: { id: request.id, summary: result, modelId } });
  const saved = parseResultInput(await exports.get(el('result-export').href)!.text(), '새 난수 결과')!;
  expect(saved.config.randomMode).toBe('partitioned-v1');
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

// 실제 이벤트 핸들러를 실행하는 DOM/Worker 통제입니다. 브라우저 레이아웃은 검증하지 않습니다.
async function mount(failure?: 'constructor' | 'postMessage') {
  vi.useFakeTimers();
  const elements = new Map(['app', 'name', 'load', 'preset', 'build-file', 'export', 'result-export', 'build', 'dur', 'iter', 'seed', 'random-mode', 'run', 'out', 'before-file', 'after-file', 'compare', 'comparison'].map(id => [id, {
    value: ({ dur: '30', iter: '10', seed: '1', 'random-mode': 'legacy' } as Record<string, string>)[id] ?? '', textContent: '', innerHTML: '', disabled: false,
    hidden: id === 'export' || id === 'result-export', href: '',
    files: [] as { name: string; text: () => Promise<string> }[],
    handlers: new Map<string, () => void | Promise<void>>(), reportValidity: () => true,
    addEventListener(type: string, handler: () => void | Promise<void>) { this.handlers.set(type, handler); },
    click() { return this.handlers.get('click')!(); },
  }]));
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

describe('character selection and simulation response ordering', () => {
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
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify({ build: request.build, warnings: request.inputWarnings, config: request.config, result: calculated, modelId })));
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
    expect(JSON.parse(await blob.text())).toEqual(JSON.parse(JSON.stringify(buildFromArmory(raw))));
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
