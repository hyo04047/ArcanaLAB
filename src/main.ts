// 캐릭터 검색·계산과 저장 Build의 구조 비교입니다. 게임 세팅의 우열은 판정하지 않습니다.
import { fetchArmory } from './api';
import { buildFromArmory } from './engine/armory';
import { empressInkomsu440 } from './engine';
import { damageWarnings } from './engine/skilldata';
import { CARD_DRAW_LABELS, cardSupplyWarnings } from './engine/cards';
import type { Build, CardDrawSource, SimSummary } from './engine';
import type { WorkerRequest, WorkerResponse } from './worker';
import { diffBuilds, parseBuildInput } from './compare';
import { describeBuildPath } from './buildDifferenceDescriptions';
import { compareResults, parseResultInput } from './resultComparison';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>ArcanaLAB</h1>
  <p>황후끼리·황제끼리 확률 변동을 통제하는 세팅 비교 시뮬레이터 (개발 중). 비교하려는 효과의 지원 범위와 미확인 가정을 함께 확인하세요.</p>
  <details>
    <summary>저장한 두 입력·결과 비교</summary>
    <p>두 JSON 파일의 설정 차이와 경고를 확인합니다. 같은 계열·모델·조건의 판정별 난수 결과는 회차별 차이와 평균 차이의 표준오차도 비교합니다. 특성 기록만 수정하면 계산 효과가 다시 만들어지지 않으며, 장착 가능 여부는 확인하지 않습니다.</p>
    <label>기준 파일 <input id="before-file" type="file" accept=".json,application/json"></label>
    <label>비교 파일 <input id="after-file" type="file" accept=".json,application/json"></label>
    <button id="compare" disabled>파일 비교</button>
    <pre id="comparison" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
  </details>
  <fieldset>
    <legend>빌드</legend>
    <label>캐릭터명 <input id="name" type="text" placeholder="전투정보실 캐릭터명"></label>
    <button id="load">불러오기</button>
    <button id="preset">프리셋(참고 캐릭터)</button>
    <label>저장 Build 불러오기 <input id="build-file" type="file" accept=".json,application/json"></label>
    <p>파일의 전체 입력과 입력 경고를 불러옵니다. 특성 기록만 수정해도 계산 효과가 다시 만들어지지는 않습니다. 저장된 과거 결과 대신 아래 조건으로 새로 계산합니다.</p>
    <a id="export" download="arcanalab-build.json" hidden>입력 JSON 저장</a>
    <pre id="build"></pre>
  </fieldset>
  <fieldset>
    <legend>시뮬레이션</legend>
    <p>계산이 30초 안에 끝나지 않으면 종료합니다. 조건을 바꿔 다시 실행할 수 있습니다.</p>
    <label>전투 시간(초) <input id="dur" type="number" value="180" min="30" max="900" required></label>
    <label>반복 <input id="iter" type="number" value="500" min="10" max="20000" required></label>
    <label>시드 <input id="seed" type="number" value="1" required></label>
    <label>난수 방식 <select id="random-mode"><option value="legacy">기존 방식</option><option value="partitioned-v1">판정별 난수 (세팅 비교)</option></select></label>
    <p>판정별 난수는 치명·카드·퀵드로 등의 난수열을 나눕니다. 확률과 추가 시전의 효과는 유지되며, 덱·손패가 달라지면 카드 결과도 달라집니다.</p>
    <button id="run" disabled>실행</button>
    <a id="result-export" download="arcanalab-result.json" hidden>결과 JSON 저장</a>
  </fieldset>
  <pre id="out"></pre>
`;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
let worker: Worker | null = null;
let current: Build | null = null;
let currentWarnings: string[] | null = null;
let reqId = 0;
let loadId = 0;
let loadController: AbortController | null = null;
let exportUrl: string | null = null;
let resultExportUrl: string | null = null;
let runTimeout: ReturnType<typeof setTimeout> | null = null;
const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
let comparisonId = 0;

function comparisonReady(): boolean {
  return !!($<HTMLInputElement>('#before-file').files?.[0] && $<HTMLInputElement>('#after-file').files?.[0]);
}

for (const id of ['#before-file', '#after-file']) $(id).addEventListener('change', () => {
  comparisonId++;
  $('#comparison').textContent = '';
  $<HTMLButtonElement>('#compare').disabled = !comparisonReady();
});

$('#compare').addEventListener('click', async () => {
  const beforeFile = $<HTMLInputElement>('#before-file').files?.[0], afterFile = $<HTMLInputElement>('#after-file').files?.[0];
  if (!beforeFile || !afterFile) return;
  const id = ++comparisonId;
  $<HTMLButtonElement>('#compare').disabled = true;
  $('#comparison').textContent = '파일을 읽는 중...';
  try {
    const texts = await Promise.all([beforeFile.text(), afterFile.text()]);
    if (id !== comparisonId) return;
    const before = parseBuildInput(texts[0], beforeFile.name), after = parseBuildInput(texts[1], afterFile.name);
    const differences = diffBuilds(before.build, after.build);
    $('#comparison').textContent = [
      `기준: ${beforeFile.name} (${before.build.name})`, `비교: ${afterFile.name} (${after.build.name})`,
      `전체 설정 차이 ${differences.length}개`, '',
      ...differences.map(change => `${({ added: '추가', removed: '삭제', changed: '변경' })[change.change]} ${describeBuildPath(before.build, after.build, change.path)} [${change.path}]\n  기준: ${change.change === 'added' ? '없음' : JSON.stringify(change.before)}\n  비교: ${change.change === 'removed' ? '없음' : JSON.stringify(change.after)}`),
      '',
      ...[before, after].flatMap((input, index) => [
        `${index === 0 ? '기준' : '비교'}: ${input.warnings === null ? '입력 경고가 저장되지 않았습니다(경고 없음이 아닙니다).' : `입력 경고 ${input.warnings.length}개`}`,
        ...(input.warnings ?? []).map(warning => `  - ${warning}`), '',
      ]),
      ...savedResultLines(texts, [beforeFile.name, afterFile.name]),
    ].join('\n');
  } catch (error) {
    if (id === comparisonId) $('#comparison').textContent = `실패: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (id === comparisonId) $<HTMLButtonElement>('#compare').disabled = !comparisonReady();
  }
});

function savedResultLines(texts: [string, string], labels: [string, string]): string[] {
  try {
    const before = parseResultInput(texts[0], labels[0]), after = parseResultInput(texts[1], labels[1]);
    if (!before && !after) return [];
    if (!before || !after) return [`수치 비교 불가: 실행 결과가 저장되지 않았습니다: ${!before ? labels[0] : labels[1]}`];
    const compared = compareResults(before, after);
    const lines = ['저장 결과 비교', compared.boundary];
    for (const [index, input] of [before, after].entries()) {
      const warnings = [...new Set([...(input.result.inputWarnings ?? []), ...input.result.damageWarnings, ...input.result.cardSupplyWarnings])]
        .filter(warning => !input.warnings?.includes(warning));
      lines.push(`${index === 0 ? '기준' : '비교'} 실행: ${input.config.durationSec}초 · ${input.config.iterations}회 · seed ${input.config.seed} · ${input.config.randomMode === 'partitioned-v1' ? '판정별 난수 v1' : '기존 난수'}`,
        `추가 계산 경고 ${warnings.length}개`, ...warnings.map(warning => `  - ${warning}`));
    }
    if (!compared.metrics) return [...lines, ...compared.blockers.map(reason => `수치 비교 불가: ${reason}`)];
    const names: Record<string, string> = {
      mean: '평균', median: '중앙값', p10: 'p10', p90: 'p90', min: '최솟값', max: '최댓값', stdev: '표준편차',
      cardsPerMin: '분당 카드 획득', cardsUsedPerMin: '분당 카드 사용', cardsHeldAtEnd: '종료 손패 평균', ruinAt4Rate: '4스택 루인 비율(0~1)',
      casts: '평균 사용 횟수', direct: '직접 피해', stackEffect: '스택트 피해', dot: '중독 피해',
    };
    const number = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
    if (compared.paired) {
      const p = compared.paired;
      lines.push(`회차별 확률 통제 비교 ${p.samples.length}쌍 (비교 − 기준)`,
        `DPS 차이: 평균 ${number(p.dps.mean)} · 중앙값 ${number(p.dps.median)} · 표본 범위 ${number(p.dps.min)} ~ ${number(p.dps.max)}`,
        `평균 차이의 표준오차: ${number(p.standardError)} (게임 수치·운용 가정의 오차 제외)`,
        `비교 쪽 DPS가 높은 회차 ${p.positive} · 동일 ${p.equal} · 낮은 회차 ${p.negative}`);
    } else lines.push(...compared.pairedBlockers.map(reason => `회차별 비교 안내: ${reason}`));
    lines.push(`저장 결과 수치 차이 ${compared.metrics.length}개 (비교 − 기준)`);
    for (const row of compared.metrics) {
      const [group, id, field] = row.path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
      let label = names[group!] ?? group!;
      if (group === 'dps') label = `DPS ${names[id!]}`;
      else if (group === 'cardsPerMinBySource') label = `분당 카드 획득 · ${CARD_DRAW_LABELS[id as CardDrawSource]}`;
      else if (group === 'breakdown') {
        const left = before.result.breakdown.find(skill => skill.id === id)?.name ?? '없음';
        const right = after.result.breakdown.find(skill => skill.id === id)?.name ?? '없음';
        label = `${left === right ? left : `${left} → ${right}`} · ${names[field!]}`;
      }
      const percent = row.relativeChange === null ? null : row.relativeChange * 100;
      lines.push(`${label}: ${number(row.before)} → ${number(row.after)} · 차이 ${number(row.delta)} · 변화율 ${percent !== null && Number.isFinite(percent) ? `${number(percent)}%` : '계산 불가'}`);
    }
    return lines;
  } catch (error) {
    return [`수치 비교 불가: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function invalidateRun(): void {
  reqId++;
  if (runTimeout !== null) clearTimeout(runTimeout);
  runTimeout = null;
  worker?.terminate();
  worker = null;
  clearResultExport();
}

function clearResultExport(): void {
  if (resultExportUrl) URL.revokeObjectURL(resultExportUrl);
  resultExportUrl = null;
  const link = $<HTMLAnchorElement>('#result-export');
  link.href = '';
  link.hidden = true;
}

function clearExport(): void {
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = null;
  const link = $<HTMLAnchorElement>('#export');
  link.href = '';
  link.hidden = true;
}

function setBuild(b: Build, summary: string[], warnings: string[] | null): void {
  invalidateRun();
  $('#out').textContent = '';
  current = b;
  currentWarnings = warnings === null ? null : [...warnings];
  clearExport();
  exportUrl = URL.createObjectURL(new Blob([JSON.stringify({ build: b, warnings: warnings ?? undefined, summary }, null, 2) + '\n'], { type: 'application/json' }));
  const link = $<HTMLAnchorElement>('#export');
  link.href = exportUrl;
  link.hidden = false;
  $('#build').textContent = [...summary, '', warnings === null ? '입력 경고가 저장되지 않았습니다(경고 없음이 아닙니다).' : warnings.length ? `경고 ${warnings.length}건` : '경고 없음', ...(warnings ?? []).map((w) => '  - ' + w)].join('\n');
  $<HTMLButtonElement>('#run').disabled = false;
}

$('#build-file').addEventListener('change', async () => {
  const file = $<HTMLInputElement>('#build-file').files?.[0];
  if (!file) return;
  const id = ++loadId;
  loadController?.abort();
  loadController = null;
  invalidateRun();
  current = null;
  clearExport();
  $<HTMLButtonElement>('#run').disabled = true;
  $('#out').textContent = '';
  $('#build').textContent = '파일을 읽는 중...';
  try {
    const text = await file.text();
    if (id !== loadId) return;
    const { build, warnings } = parseBuildInput(text, file.name);
    setBuild(build, [`파일: ${file.name}`, build.name, `스킬: ${build.skills.map(s => `${s.name} Lv${s.level}`).join(', ')}`], warnings);
  } catch (error) {
    if (id === loadId) $('#build').textContent = `실패: ${error instanceof Error ? error.message : String(error)}`;
  }
});

$('#preset').addEventListener('click', () => {
  loadId++;
  loadController?.abort();
  loadController = null;
  const b = empressInkomsu440();
  setBuild(b, [b.name, `스킬: ${b.skills.map((s) => `${s.name} Lv${s.level}`).join(', ')}`], ['손으로 옮긴 프리셋', ...damageWarnings(b), ...cardSupplyWarnings(b)]);
});

$('#load').addEventListener('click', async () => {
  const name = $<HTMLInputElement>('#name').value.trim();
  if (!name) return;
  const id = ++loadId;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
  invalidateRun();
  current = null;
  clearExport();
  $<HTMLButtonElement>('#run').disabled = true;
  $('#out').textContent = '';
  $('#build').textContent = '불러오는 중...';
  try {
    const raw = await fetchArmory(name, controller.signal);
    if (id !== loadId) return;
    const { build, warnings, summary } = buildFromArmory(raw);
    setBuild(build, summary, warnings);
  } catch (e) {
    if (id === loadId) $('#build').textContent = timedOut
      ? '실패: 캐릭터 조회가 30초 안에 끝나지 않았습니다. 잠시 후 다시 시도하세요.' : `실패: ${(e as Error).message}`;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (id === loadId) loadController = null;
  }
});

function render(s: SimSummary): void {
  const d = s.dps;
  const spread = d.p10 > 0 ? (d.p90 / d.p10).toFixed(3) : '계산 불가(p10=0)';
  const totalDamage = d.mean * s.durationSec;
  $('#out').textContent = [
    `빌드: ${s.build}   ${s.iterations}회 × ${s.durationSec}초`,
    `난수: ${s.randomMode === 'partitioned-v1' ? '판정별 난수 v1' : '기존 방식'}`,
    ...[...new Set([...(s.inputWarnings ?? []), ...s.damageWarnings, ...s.cardSupplyWarnings])].map(w => '  - ' + w),
    '',
    `DPS(현재 모델·가정 포함)  중앙값 ${fmt(d.median)}  평균 ${fmt(d.mean)}  p10 ${fmt(d.p10)}  p90 ${fmt(d.p90)}  (p90/p10 ${spread})`,
    `분당 카드 획득 ${s.cardsPerMin.toFixed(2)}장 / 사용 ${s.cardsUsedPerMin.toFixed(2)}장   종료 손패 평균 ${s.cardsHeldAtEnd.toFixed(2)}장`,
    `4스택 루인 비율 ${(s.ruinAt4Rate * 100).toFixed(1)}%`,
    '  획득 경로: ' + (Object.keys(s.cardsPerMinBySource) as CardDrawSource[]).filter(k => s.cardsPerMinBySource[k] > 0)
      .map(k => `${CARD_DRAW_LABELS[k]} ${s.cardsPerMinBySource[k].toFixed(2)}장/분`).join(' · '),
    '',
    '스킬별 평균 피해 비중(임시값)',
    ...s.breakdown.map((b) => `  ${b.name.padEnd(12)} ${totalDamage > 0 ? (((b.direct + b.stackEffect + (b.dot ?? 0)) / totalDamage) * 100).toFixed(1).padStart(5) + '%' : '계산 불가'}  (직접 ${fmt(b.direct)} / 스택트 ${fmt(b.stackEffect)}${b.dot !== undefined ? ` / 중독 ${fmt(b.dot)}` : ''})  ${b.casts.toFixed(1)}회`),
  ].join('\n');
}

$('#run').addEventListener('click', () => {
  if (!current) return;
  for (const id of ['#dur', '#iter', '#seed']) if (!$<HTMLInputElement>(id).reportValidity()) return;
  const config = { durationSec: Number($<HTMLInputElement>('#dur').value), iterations: Number($<HTMLInputElement>('#iter').value), seed: Number($<HTMLInputElement>('#seed').value),
    ...($<HTMLSelectElement>('#random-mode').value === 'partitioned-v1' ? { randomMode: 'partitioned-v1' as const } : {}) };
  clearResultExport();
  $('#out').textContent = '실행 중...';
  $<HTMLButtonElement>('#run').disabled = true;
  const req: WorkerRequest = { id: ++reqId, build: current, config, inputWarnings: currentWarnings === null ? undefined : [...currentWarnings] };
  worker?.terminate();
  worker = null;
  if (runTimeout !== null) clearTimeout(runTimeout);
  runTimeout = setTimeout(() => failRun(req.id, '계산이 30초 안에 끝나지 않아 종료했습니다. 조건을 확인한 뒤 다시 실행하세요.'), 30000);
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ev => onWorkerMessage(ev, req);
    worker.onerror = ev => failRun(req.id, ev.message || '계산 작업을 시작하거나 실행하지 못했습니다.');
    worker.postMessage(req);
  } catch (error) {
    failRun(req.id, error instanceof Error ? error.message : String(error));
  }
});

function failRun(id: number, message: string): void {
  if (id !== reqId) return;
  invalidateRun();
  $<HTMLButtonElement>('#run').disabled = false;
  $('#out').textContent = `실패: ${message}`;
}

function onWorkerMessage(ev: MessageEvent<WorkerResponse>, request: WorkerRequest): void {
  if (ev.data.id !== reqId) return;
  invalidateRun();
  $<HTMLButtonElement>('#run').disabled = false;
  if ('error' in ev.data) $('#out').textContent = `실패: ${ev.data.error}`;
  else {
    try {
      const text = JSON.stringify({ build: request.build, warnings: request.inputWarnings, config: request.config, result: ev.data.summary, modelId: ev.data.modelId }, null, 2) + '\n';
      parseResultInput(text, '새 계산 결과');
      render(ev.data.summary);
      resultExportUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = $<HTMLAnchorElement>('#result-export');
      link.href = resultExportUrl;
      link.hidden = false;
    } catch (error) {
      $('#out').textContent = `실패: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
