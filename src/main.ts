// 캐릭터 검색·계산과 저장 Build의 구조 비교입니다. 게임 세팅의 우열은 판정하지 않습니다.
import { fetchArmory } from './api';
import { captureSettingBaseline, type SettingSelections } from './engine/settings';
import { empressInkomsu440 } from './engine';
import { damageWarnings } from './engine/skilldata';
import { CARD_DRAW_LABELS, cardSupplyWarnings } from './engine/cards';
import type { Build, CardDrawSource, SimSummary } from './engine';
import type { WorkerRequest, WorkerResponse } from './worker';
import { diffBuilds } from './compare';
import { describeBuildPath } from './buildDifferenceDescriptions';
import { compareResults, parseResultInput } from './resultComparison';
import { readSettingInput, regenerateSettingInput, saveSettingInput, type LoadedSettingInput, type SavedSetting } from './settingFiles';
import { chooseSettingOption, chooseStatInput, settingRows, settingHtml, evolutionSummary, statSummary, enlightenmentSummary, coreSummary, gemSummary } from './settingEditor';
import { statNames, type StatKey } from './engine/statSettings';
import modelId from 'virtual:arcanalab-model';

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
    <p>파일의 전체 입력과 경고를 불러옵니다. 선택 정보가 있으면 원본과 계산 입력의 일치를 확인합니다. 다른 모델의 입력은 자동으로 바꾸지 않으며, 저장된 과거 결과 대신 아래 조건으로 새로 계산합니다.</p>
    <button id="regenerate-setting" hidden>현재 모델로 입력 재생성</button>
    <a id="export" download="arcanalab-build.json" hidden>입력 JSON 저장</a>
    <fieldset id="setting-editor">
      <legend>룬·보석·진화·특성·깨달음 사이드·코어·트라이포드 변경</legend>
      <p id="setting-hint"></p>
      <p id="stat-preview" style="overflow-wrap:anywhere"></p>
      <div id="setting-choices" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px"></div>
      <p>
        <button id="apply-settings" disabled>선택 적용</button>
        <button id="cancel-settings" disabled>편집 취소</button>
        <button id="reset-settings" disabled>원본 선택으로 되돌리기</button>
      </p>
      <p id="setting-status" role="status" style="white-space:pre-wrap;overflow-wrap:anywhere"></p>
    </fieldset>
    <pre id="build" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
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
  <pre id="out" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
`;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
let worker: Worker | null = null;
let current: Build | null = null;
let currentWarnings: string[] | null = null;
let currentDocument: LoadedSettingInput | null = null;
let settingDraft: SettingSelections | null = null;
let settingBusy = false;
let reqId = 0;
let loadId = 0;
let loadController: AbortController | null = null;
let exportUrl: string | null = null;
let resultExportUrl: string | null = null;
let runTimeout: ReturnType<typeof setTimeout> | null = null;
const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
const fileText = async (file: File): Promise<string> =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
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
    const texts = await Promise.all([fileText(beforeFile), fileText(afterFile)]);
    if (id !== comparisonId) return;
    const [before, after] = await Promise.all([readSettingInput(texts[0], beforeFile.name, modelId), readSettingInput(texts[1], afterFile.name, modelId)]);
    if (id !== comparisonId) return;
    const differences = diffBuilds(before.build, after.build);
    $('#comparison').textContent = [
      `기준: ${beforeFile.name} (${before.build.name})`, `비교: ${afterFile.name} (${after.build.name})`,
      `전체 설정 차이 ${differences.length}개`, '',
      ...before.notices.map(notice => `기준: ${notice}`), ...after.notices.map(notice => `비교: ${notice}`),
      ...savedResultLines(texts, [beforeFile.name, afterFile.name]), '',
      ...differences.map(change => `${({ added: '추가', removed: '삭제', changed: '변경' })[change.change]} ${describeBuildPath(before.build, after.build, change.path)} [${change.path}]\n  기준: ${change.change === 'added' ? '없음' : JSON.stringify(change.before)}\n  비교: ${change.change === 'removed' ? '없음' : JSON.stringify(change.after)}`),
      '',
      ...[before, after].flatMap((input, index) => [
        `${index === 0 ? '기준' : '비교'}: ${input.warnings === null ? '입력 경고가 저장되지 않았습니다(경고 없음이 아닙니다).' : `입력 경고 ${input.warnings.length}개`}`,
        ...(input.warnings ?? []).map(warning => `  - ${warning}`), '',
      ]),
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
    const executionLines: string[] = [];
    for (const [index, input] of [before, after].entries()) {
      const warnings = [...new Set([...(input.result.inputWarnings ?? []), ...input.result.damageWarnings, ...input.result.cardSupplyWarnings])]
        .filter(warning => !input.warnings?.includes(warning));
      executionLines.push(`${index === 0 ? '기준' : '비교'} 실행: ${input.config.durationSec}초 · ${input.config.iterations}회 · seed ${input.config.seed} · ${input.config.randomMode === 'partitioned-v1' ? '판정별 난수 v1' : '기존 난수'}`,
        `추가 계산 경고 ${warnings.length}개`, ...warnings.map(warning => `  - ${warning}`));
    }
    if (!compared.metrics) return [...lines, ...compared.blockers.map(reason => `수치 비교 불가: ${reason}`), ...executionLines];
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
    lines.push(...executionLines, `저장 결과 수치 차이 ${compared.metrics.length}개 (비교 − 기준)`);
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
  currentDocument = null;
  $<HTMLButtonElement>('#regenerate-setting').hidden = true;
  settingDraft = null;
  settingBusy = false;
  renderSettingEditor();
}

function setBuild(b: Build, summary: string[], warnings: string[] | null, document?: LoadedSettingInput): void {
  invalidateRun();
  $('#out').textContent = '';
  current = b;
  currentWarnings = warnings === null ? null : [...warnings];
  clearExport();
  currentDocument = document ?? null;
  settingDraft = document?.status === 'editable' ? structuredClone((document.setting as unknown as SavedSetting).selections) : null;
  renderSettingEditor();
  $<HTMLButtonElement>('#regenerate-setting').hidden = document?.status !== 'model-changed';
  exportUrl = URL.createObjectURL(new Blob([document?.text ?? JSON.stringify({ build: b, warnings: warnings ?? undefined, summary }, null, 2) + '\n'], { type: 'application/json' }));
  const link = $<HTMLAnchorElement>('#export');
  link.href = exportUrl;
  link.hidden = false;
  $('#build').textContent = [...summary, '', warnings === null ? '입력 경고가 저장되지 않았습니다(경고 없음이 아닙니다).' : warnings.length ? `경고 ${warnings.length}건` : '경고 없음', ...(warnings ?? []).map((w) => '  - ' + w)].join('\n');
  $<HTMLButtonElement>('#run').disabled = false;
}

function editorSetting(): SavedSetting | null {
  return currentDocument?.status === 'editable' ? currentDocument.setting as unknown as SavedSetting : null;
}

function settingDirty(): boolean {
  const setting = editorSetting();
  return !!(setting && current && settingDraft && (JSON.stringify(settingRows(setting, current, settingDraft)) !== JSON.stringify(settingRows(setting, current))
    || JSON.stringify(settingDraft.stats ?? {}) !== JSON.stringify(setting.selections.stats ?? {})
    || settingDraft.coreGemMode !== setting.selections.coreGemMode
    || settingDraft.gemAttackMode !== setting.selections.gemAttackMode));
}

function renderSettingEditor(message?: string, preserveControls = false): void {
  const setting = editorSetting(), enabled = !!(setting && current && settingDraft), dirty = settingDirty();
  $('#setting-hint').textContent = enabled
    ? '룬·쿨감 효과는 다른 스킬이 쓰는 항목을 고르면 두 위치를 교환합니다. 진화는 적용 시 티어·포인트를 검사합니다. 1티어 치명·특화·신속 변경은 총합에 한 번만 반영하며 바뀐 특성 효과는 근사식으로 계산합니다. 깨달음은 메인 경로를 고정하고 관측된 사이드 레벨만 선택합니다. 실제 보석은 저장 관측 묶음으로 변경하며 전체 장착 규칙은 미확인입니다.'
    : currentDocument?.status === 'model-changed' ? '현재 모델로 입력을 재생성한 뒤 선택을 변경할 수 있습니다.'
      : currentDocument?.status === 'unsupported-version' ? '이 파일의 선택 정보 버전은 아직 편집할 수 없습니다. 저장된 입력으로 계산할 수 있습니다.'
        : '원본과 선택 정보가 있는 입력을 불러오면 편집할 수 있습니다. 원본 없는 과거 파일·프리셋은 기존 입력으로 계산합니다.';
  $('#stat-preview').textContent = enabled ? statSummary(setting!, settingDraft!) : '';
  if (!preserveControls) $('#setting-choices').innerHTML = enabled ? `<section><h3>최종 특성 총합</h3>
    <p>비우면 원본 총합에 진화 1티어 변화만 반영합니다. 직접 입력하면 진화 기여를 포함한 최종값으로 사용합니다. 바뀐 특성은 근사 계산이며 정확한 게임 환산값이 아닙니다.</p>
    ${(Object.keys(statNames) as StatKey[]).map(key => `<label style="display:block;margin:10px 0">최종 ${statNames[key]} (비우면 자동)
      <input type="number" min="0" step="1" aria-label="최종 ${statNames[key]}" data-stat="${key}" placeholder="자동 연동" value="${settingDraft!.stats?.[key] ?? ''}" style="display:block;width:100%;box-sizing:border-box" ${settingBusy ? 'disabled' : ''}></label>`).join('')}</section>`
    + Object.entries(settingRows(setting!, current!, settingDraft!)).map(([axis, rows]) => `
    <section><h3>${axis === 'runes' ? '룬 배치' : axis === 'evolution' ? '진화 노드' : axis === 'enlightenment' ? '깨달음 사이드' : axis === 'cores' ? '코어·등급·포인트' : axis === 'tripods' ? '트라이포드' : axis === 'gems' ? '실제 보석·등급·대상' : '쿨감 보석 효과 교환'}</h3>
    ${axis === 'gems' ? `<p>등급·레벨·대상·효과를 저장 관측 묶음으로 선택합니다. 같은 대상·종류의 중복과 쿨감 효과만의 교환 병용은 거절합니다. 옮길 때는 두 슬롯을 함께 바꾸세요. 실제 보유·전체 장착 규칙은 미확인입니다.</p>
      <label>보석 공격력 환산 방식 <select aria-label="보석 공격력 환산 방식" data-gem-attack-mode="true" style="display:block;width:100%" ${settingBusy ? 'disabled' : ''}>
        <option value="" ${!settingDraft!.gemAttackMode ? 'selected' : ''}>합계 동일 변경만 허용</option>
        <option value="ratio-approximation" ${settingDraft!.gemAttackMode ? 'selected' : ''}>기본 공격력 비율 환산 근사</option></select></label>
      <p>합계 변경 시 원본 기본 공격력 × (1+새 합계)/(1+옛 합계)를 사용합니다. 다른 기본 공격력 효과와의 결합·반올림은 미확인입니다. 프로필 표시 공격력은 원본 비교 참고값입니다.</p>
      <p>${settingHtml(gemSummary(setting!, settingDraft!))}</p>` : ''}
    ${axis === 'tripods' ? '<p>스킬 레벨은 원본을 유지합니다. 공식 관측은 강화 레벨 미확인, 공개 Lv.1은 현행 미검증 후보입니다. 저장 근거와 선택 요약이 일치하는 스킬만 표시합니다. 적용하면 피해·타수·쿨과 기본 운용을 함께 갱신합니다. 미지원 변형·효과는 아래 계산 경고를 확인하세요.</p>' : ''}
    ${axis === 'evolution' ? `<p>${settingHtml(evolutionSummary(setting!, settingDraft!))}</p>` : ''}
    ${axis === 'enlightenment' ? `<p>${settingHtml(enlightenmentSummary(setting!, settingDraft!))}</p>` : ''}
    ${axis === 'cores' ? `<p>저장된 코어·등급·포인트와 젬을 묶어서 변경합니다. 자유로운 포인트 조정과 미관측 등급 조합은 지원하지 않습니다. 기존 공식 젬 합계 대신 활성 젬의 표시값을 합산하면 반올림 차이가 생길 수 있습니다.</p>
      <label>코어 젬 합산 방식 <select aria-label="코어 젬 합산 방식" data-core-gem-mode="true" style="display:block;width:100%" ${settingBusy ? 'disabled' : ''}>
        <option value="" ${!settingDraft!.coreGemMode ? 'selected' : ''}>원본 합계 유지 (코어 변경 적용 불가)</option>
        <option value="individual-approximation" ${settingDraft!.coreGemMode ? 'selected' : ''}>활성 젬 설명의 개별 합산 근사</option></select></label>
      <p>${settingHtml(coreSummary(setting!, settingDraft!))}</p>` : ''}
    ${rows.length ? rows.map(row => `<label style="display:block;margin:10px 0">${settingHtml(row.label)}
      <select aria-label="${settingHtml(row.label)} ${axis === 'runes' ? '룬' : axis === 'evolution' || axis === 'enlightenment' ? '레벨' : axis === 'cores' ? '묶음' : axis === 'tripods' || axis === 'gems' ? '선택' : '쿨감 효과'}" data-axis="${axis}" data-target="${settingHtml(row.key)}" style="display:block;width:100%;min-width:0" ${settingBusy ? 'disabled' : ''}>
        ${row.options.map(option => `<option value="${settingHtml(option.value)}" ${option.value === row.value ? 'selected' : ''}>${settingHtml(option.label)}</option>`).join('')}
      </select>${axis === 'tripods' || axis === 'gems' ? `<small>${settingHtml(row.description ?? '')}</small>` : ''}</label>`).join('') : `<p>${axis === 'evolution' ? '원본 진화 노드의 티어·레벨을 확인할 수 없어 진화 편집을 열지 않습니다.' : axis === 'enlightenment' ? '원본 깨달음의 계열·티어·레벨을 확인할 수 없어 사이드 편집을 열지 않습니다.' : axis === 'cores' ? '원본 코어·젬·포인트 설명을 확인할 수 없어 코어 편집을 열지 않습니다.' : axis === 'tripods' ? '스킬 레벨·선택·설명의 저장 근거를 확인할 수 없어 트라이포드 편집을 열지 않습니다.' : axis === 'gems' ? '개별 보석·슬롯·공식 합계가 일치하는 원본이 필요합니다.' : '재배치할 수 있는 원본 효과가 없습니다.'}</p>`}</section>`).join('') : '';
  $<HTMLButtonElement>('#apply-settings').disabled = !enabled || !dirty || settingBusy;
  $<HTMLButtonElement>('#cancel-settings').disabled = !enabled || !dirty || settingBusy;
  $<HTMLButtonElement>('#reset-settings').disabled = !enabled || settingBusy;
  $('#setting-status').textContent = message ?? (enabled ? dirty
    ? '아직 적용하지 않은 선택입니다. 선택을 적용하거나 편집을 취소한 뒤 계산·저장하세요.' : '현재 적용된 선택입니다. 아래 입력으로 계산·저장할 수 있습니다.' : '');
}

function updateSettingDraft(draft: SettingSelections, preserveControls = false): void {
  settingDraft = draft;
  // 편집을 시작하면 이전 실행 결과가 새 선택의 결과로 보이지 않게 합니다.
  invalidateRun();
  $('#out').textContent = '';
  $<HTMLButtonElement>('#run').disabled = settingDirty();
  $<HTMLAnchorElement>('#export').hidden = settingDirty();
  renderSettingEditor(undefined, preserveControls);
}

$('#setting-choices').addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (!editorSetting() || !current || !settingDraft || settingBusy || !input.dataset.stat) return;
  updateSettingDraft(chooseStatInput(settingDraft, input.dataset.stat, input.validity?.badInput ? 'invalid' : input.value), true);
});

$('#setting-choices').addEventListener('change', event => {
  const setting = editorSetting(), select = event.target as HTMLSelectElement;
  const axis = select.dataset.axis;
  if (!setting || !current || !settingDraft || settingBusy) return;
  if (select.dataset.coreGemMode) {
    const next = structuredClone(settingDraft);
    if (select.value === '') delete next.coreGemMode;
    else if (select.value === 'individual-approximation') next.coreGemMode = select.value;
    else return;
    updateSettingDraft(next); return;
  }
  if (select.dataset.gemAttackMode) {
    const next = structuredClone(settingDraft);
    if (select.value === '') delete next.gemAttackMode;
    else if (select.value === 'ratio-approximation') next.gemAttackMode = select.value;
    else return;
    updateSettingDraft(next); return;
  }
  if (axis !== 'runes' && axis !== 'cooldownGems' && axis !== 'evolution' && axis !== 'enlightenment' && axis !== 'cores' && axis !== 'tripods' && axis !== 'gems') return;
  try { updateSettingDraft(chooseSettingOption(setting, current, settingDraft, axis, select.dataset.target!, select.value)); }
  catch (error) { renderSettingEditor(`선택 실패: ${error instanceof Error ? error.message : String(error)}`); }
});

$('#cancel-settings').addEventListener('click', () => {
  const setting = editorSetting();
  if (setting && !settingBusy) updateSettingDraft(structuredClone(setting.selections));
});

$('#reset-settings').addEventListener('click', () => {
  const setting = editorSetting();
  if (setting && !settingBusy) updateSettingDraft({ baselineFingerprint: setting.baseline.fingerprint });
});

$('#apply-settings').addEventListener('click', async () => {
  const previous = currentDocument, setting = editorSetting();
  if (!previous || !setting || !settingDraft || !settingDirty() || settingBusy) return;
  const id = ++loadId, draft = structuredClone(settingDraft);
  loadController?.abort(); loadController = null;
  settingBusy = true;
  invalidateRun();
  $<HTMLButtonElement>('#run').disabled = true;
  $<HTMLAnchorElement>('#export').hidden = true;
  renderSettingEditor('선택에서 전체 계산 입력을 다시 만드는 중...');
  try {
    const text = await saveSettingInput(setting.baseline, draft, modelId, setting.source);
    const input = await readSettingInput(text, '편집한 입력', modelId);
    if (id !== loadId) return;
    const changes = diffBuilds(previous.build, input.build);
    setBuild(input.build, [...input.summary, `이전 적용 입력과 계산 입력 차이 ${changes.length}개`,
      ...changes.map(change => describeBuildPath(previous.build, input.build, change.path))], input.warnings, input);
    $<HTMLInputElement>('#build-file').value = '';
    renderSettingEditor(`선택 적용 완료 · 계산 입력 차이 ${changes.length}개. 새 입력으로 계산·저장할 수 있습니다.`);
  } catch (error) {
    if (id !== loadId) return;
    settingBusy = false;
    renderSettingEditor(`적용 실패: ${error instanceof Error ? error.message : String(error)}\n선택을 수정하거나 편집을 취소하세요. 이전 입력은 유지됩니다.`);
  }
});

renderSettingEditor();

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
    const text = await fileText(file);
    if (id !== loadId) return;
    const input = await readSettingInput(text, file.name, modelId);
    if (id !== loadId) return;
    setBuild(input.build, [`파일: ${file.name}`, input.build.name, ...input.notices,
      `스킬: ${input.build.skills.map(s => `${s.name} Lv${s.level}`).join(', ')}`], input.warnings, input);
  } catch (error) {
    if (id === loadId) $('#build').textContent = `실패: ${error instanceof Error ? error.message : String(error)}`;
  }
});

$('#regenerate-setting').addEventListener('click', async () => {
  const previous = currentDocument;
  if (previous?.status !== 'model-changed') return;
  const id = ++loadId;
  loadController?.abort(); loadController = null;
  invalidateRun(); current = null; clearExport();
  $<HTMLButtonElement>('#run').disabled = true;
  $('#out').textContent = ''; $('#build').textContent = '선택 정보에서 입력을 다시 만드는 중...';
  try {
    const rebuilt = await regenerateSettingInput(previous.text, '선택한 파일', modelId);
    if (id !== loadId) return;
    const input = rebuilt.input;
    setBuild(input.build, ['현재 모델로 새 입력을 만들었습니다. 이전 파일과 결과는 보존됩니다.',
      `계산 입력 차이 ${rebuilt.changes.length}개`,
      ...rebuilt.changes.map(change => describeBuildPath(previous.build, input.build, change.path)),
      `경고 추가 ${rebuilt.warningsAdded.length}개 · 제거 ${rebuilt.warningsRemoved?.length ?? '미기록'}`,
      ...input.summary], input.warnings, input);
  } catch (error) {
    if (id === loadId) setBuild(previous.build, [`재생성 실패: ${error instanceof Error ? error.message : String(error)}`,
      '저장된 계산 입력을 유지합니다.', ...previous.notices], previous.warnings, previous);
  }
});

$('#preset').addEventListener('click', () => {
  loadId++;
  $<HTMLInputElement>('#build-file').value = '';
  loadController?.abort();
  loadController = null;
  const b = empressInkomsu440();
  setBuild(b, [b.name, `스킬: ${b.skills.map((s) => `${s.name} Lv${s.level}`).join(', ')}`], ['손으로 옮긴 프리셋', ...damageWarnings(b), ...cardSupplyWarnings(b)]);
});

$('#load').addEventListener('click', async () => {
  const name = $<HTMLInputElement>('#name').value.trim();
  if (!name) return;
  const id = ++loadId;
  $<HTMLInputElement>('#build-file').value = '';
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
    const baseline = await captureSettingBaseline(raw);
    const text = await saveSettingInput(baseline, { baselineFingerprint: baseline.fingerprint }, modelId,
      { kind: 'api-snapshot', reference: raw.profiles.CharacterName, capturedAt: new Date().toISOString() });
    const input = await readSettingInput(text, '검색 입력', modelId);
    if (id !== loadId) return;
    setBuild(input.build, input.summary, input.warnings, input);
  } catch (e) {
    if (id === loadId) $('#build').textContent = timedOut
      ? '실패: 캐릭터 조회가 30초 안에 끝나지 않았습니다. 잠시 후 다시 시도하세요.' : `실패: ${(e as Error).message}`;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (id === loadId) loadController = null;
  }
});

function render(s: SimSummary, seed: number): void {
  const d = s.dps;
  const spread = d.p10 > 0 ? (d.p90 / d.p10).toFixed(3) : '계산 불가(p10=0)';
  const totalDamage = d.mean * s.durationSec;
  $('#out').textContent = [
    `빌드: ${s.build}   ${s.iterations}회 × ${s.durationSec}초`,
    `난수: ${s.randomMode === 'partitioned-v1' ? '판정별 난수 v1' : '기존 방식'} · seed ${seed}`,
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
  if (!current || settingBusy || settingDirty()) return;
  for (const id of ['#dur', '#iter', '#seed']) if (!$<HTMLInputElement>(id).reportValidity()) return;
  const config = { durationSec: Number($<HTMLInputElement>('#dur').value), iterations: Number($<HTMLInputElement>('#iter').value), seed: Number($<HTMLInputElement>('#seed').value),
    ...($<HTMLSelectElement>('#random-mode').value === 'partitioned-v1' ? { randomMode: 'partitioned-v1' as const } : {}) };
  clearResultExport();
  $('#out').textContent = '실행 중...';
  $<HTMLButtonElement>('#run').disabled = true;
  const req: WorkerRequest = { id: ++reqId, build: current, config, inputWarnings: currentWarnings === null ? undefined : [...currentWarnings] };
  const selection = currentDocument?.setting === undefined ? undefined
    : structuredClone({ setting: currentDocument.setting, summary: currentDocument.summary });
  worker?.terminate();
  worker = null;
  if (runTimeout !== null) clearTimeout(runTimeout);
  runTimeout = setTimeout(() => failRun(req.id, '계산이 30초 안에 끝나지 않아 종료했습니다. 조건을 확인한 뒤 다시 실행하세요.'), 30000);
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ev => onWorkerMessage(ev, req, selection);
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

function onWorkerMessage(ev: MessageEvent<WorkerResponse>, request: WorkerRequest, selection?: { setting: Record<string, unknown>; summary: string[] }): void {
  if (ev.data.id !== reqId) return;
  invalidateRun();
  $<HTMLButtonElement>('#run').disabled = false;
  if ('error' in ev.data) $('#out').textContent = `실패: ${ev.data.error}`;
  else {
    try {
      if (ev.data.modelId !== modelId) throw new Error('화면과 계산 모델이 다릅니다. 페이지를 새로고침한 뒤 다시 실행하세요.');
      const text = JSON.stringify({ build: request.build, warnings: request.inputWarnings, config: request.config, result: ev.data.summary, modelId: ev.data.modelId,
        ...selection }, null, 2) + '\n';
      parseResultInput(text, '새 계산 결과');
      render(ev.data.summary, request.config.seed);
      resultExportUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = $<HTMLAnchorElement>('#result-export');
      link.href = resultExportUrl;
      link.hidden = false;
    } catch (error) {
      $('#out').textContent = `실패: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
