import { diffBuilds, parseBuildInput } from './compare';
import { CARD_DRAW_LABELS } from './engine/cards';
import { summarize } from './engine/stats';
import { validRandomMode } from './engine/rng';
import type { SimConfig, SimSummary } from './engine/types';

export interface SavedResult extends ReturnType<typeof parseBuildInput> {
  config: SimConfig;
  result: SimSummary;
  modelId?: string;
}

const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));

/** 저장 파일의 내부 일관성 검사입니다. 엔진 동일성·원본 진위·게임 정확도는 검증하지 않습니다. */
export function parseResultInput(text: string, label: string): SavedResult | null {
  const input = parseBuildInput(text, label), saved = JSON.parse(text);
  if (!Object.hasOwn(saved, 'result') && !Object.hasOwn(saved, 'config')) return null;
  const fail = (): never => { throw new Error(`저장 결과 형식을 확인하세요: ${label}`); };
  if (Object.hasOwn(saved, 'modelId') && (typeof saved.modelId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(saved.modelId))) return fail();
  const config = saved.config as SimConfig | undefined, result = saved.result as SimSummary | undefined;
  if (!config || !result || !nonnegative(config.durationSec) || config.durationSec === 0
    || !validRandomMode(config.randomMode) || !validRandomMode(result.randomMode)
    || (config.randomMode ?? 'legacy') !== (result.randomMode ?? 'legacy')
    || !Number.isSafeInteger(config.iterations) || config.iterations < 1 || !Number.isSafeInteger(config.seed)
    || result.build !== input.build.name || result.durationSec !== config.durationSec || result.iterations !== config.iterations
    || !Array.isArray(result.samples) || result.samples.length !== config.iterations || !result.samples.every(nonnegative)
    || !strings(result.damageWarnings) || !strings(result.cardSupplyWarnings)
    || (result.inputWarnings !== undefined && !strings(result.inputWarnings))) return fail();
  if (input.warnings !== null && JSON.stringify(result.inputWarnings ?? []) !== JSON.stringify(input.warnings)) return fail();
  const expected = summarize(result.samples);
  for (const key of Object.keys(expected) as (keyof typeof expected)[])
    if (!nonnegative(result.dps?.[key]) || !close(result.dps[key], expected[key])) return fail();
  if (![result.cardsPerMin, result.cardsUsedPerMin, result.cardsHeldAtEnd, result.ruinAt4Rate].every(nonnegative)
    || result.cardsHeldAtEnd > 2 || result.ruinAt4Rate > 1) return fail();
  const sources = Object.keys(CARD_DRAW_LABELS) as (keyof typeof CARD_DRAW_LABELS)[];
  if (!result.cardsPerMinBySource || Object.keys(result.cardsPerMinBySource).length !== sources.length
    || !sources.every(key => nonnegative(result.cardsPerMinBySource[key]))
    || !close(sources.reduce((sum, key) => sum + result.cardsPerMinBySource[key], 0), result.cardsPerMin)
    || !close(result.cardsUsedPerMin + result.cardsHeldAtEnd * 60 / config.durationSec, result.cardsPerMin)) return fail();
  if (!Array.isArray(result.breakdown) || !result.breakdown.every(skill => skill && typeof skill.id === 'string' && skill.id.length > 0
    && typeof skill.name === 'string' && [skill.casts, skill.direct, skill.stackEffect].every(nonnegative)
    && (skill.dot === undefined || nonnegative(skill.dot)))
    || new Set(result.breakdown.map(skill => skill.id)).size !== result.breakdown.length
    || !close(result.breakdown.reduce((sum, skill) => sum + skill.direct + skill.stackEffect + (skill.dot ?? 0), 0), result.dps.mean * config.durationSec)) return fail();
  return { ...input, config, result, ...(saved.modelId === undefined ? {} : { modelId: saved.modelId }) };
}

export interface ResultMetric {
  path: string;
  before: number;
  after: number;
  delta: number;
  /** 기준값이0이거나 변화율이 표현 범위를 넘으면 null입니다. */
  relativeChange: number | null;
}

export function compareResults(before: SavedResult, after: SavedResult) {
  const blockers: string[] = [];
  const modelStatus = before.modelId && after.modelId ? before.modelId === after.modelId ? 'same' : 'different' : 'unknown';
  if (modelStatus === 'different') blockers.push('계산 모델 식별값이 다릅니다. 같은 엔진·데이터에서 다시 계산하세요.');
  if ((before.config.randomMode ?? 'legacy') !== (after.config.randomMode ?? 'legacy')) blockers.push('난수 방식이 다릅니다. 같은 방식으로 다시 계산하세요.');
  for (const key of ['durationSec', 'iterations', 'seed'] as const)
    if (before.config[key] !== after.config[key]) blockers.push(`실행 조건 ${key}가 다릅니다.`);
  if (before.config.iterations < 2 || after.config.iterations < 2) blockers.push('수치 비교에는 양쪽 모두 2회 이상의 표본이 필요합니다.');
  const metrics: ResultMetric[] = [];
  const add = (path: string, left: number, right: number) => {
    const delta = right - left, relative = left === 0 ? null : delta / left;
    if (!Number.isFinite(delta)) throw new Error(`결과 차이가 지원 숫자 범위를 벗어났습니다: ${path}`);
    metrics.push({ path, before: left, after: right, delta, relativeChange: relative !== null && Number.isFinite(relative) ? relative : null });
  };
  if (!blockers.length) {
    for (const key of Object.keys(summarize([])) as (keyof SimSummary['dps'])[])
      add(`/dps/${key}`, before.result.dps[key], after.result.dps[key]);
    for (const key of ['cardsPerMin', 'cardsUsedPerMin', 'cardsHeldAtEnd', 'ruinAt4Rate'] as const)
      add(`/${key}`, before.result[key], after.result[key]);
    for (const key of Object.keys(CARD_DRAW_LABELS) as (keyof typeof CARD_DRAW_LABELS)[])
      add(`/cardsPerMinBySource/${key}`, before.result.cardsPerMinBySource[key], after.result.cardsPerMinBySource[key]);
    const left = new Map(before.result.breakdown.map(skill => [skill.id, skill]));
    const right = new Map(after.result.breakdown.map(skill => [skill.id, skill]));
    for (const id of [...new Set([...left.keys(), ...right.keys()])].sort())
      for (const key of ['casts', 'direct', 'stackEffect', 'dot'] as const)
        add(`/breakdown/${id.replace(/~/g, '~0').replace(/\//g, '~1')}/${key}`, left.get(id)?.[key] ?? 0, right.get(id)?.[key] ?? 0);
  }
  const pairedBlockers = [...blockers];
  if (before.build.variant !== after.build.variant) pairedBlockers.push('회차별 확률 통제 비교는 황후끼리 또는 황제끼리 지원합니다.');
  if (modelStatus === 'unknown') pairedBlockers.push('회차별 비교에는 양쪽의 같은 계산 모델 식별값이 필요합니다.');
  if (before.config.randomMode !== 'partitioned-v1' || after.config.randomMode !== 'partitioned-v1')
    pairedBlockers.push('회차별 확률 통제 비교에는 양쪽 모두 판정별 난수 방식이 필요합니다.');
  let paired = null;
  if (!pairedBlockers.length) {
    const samples = after.result.samples.map((value, index) => value - before.result.samples[index]!);
    const dps = summarize(samples), standardError = dps.stdev / Math.sqrt(samples.length);
    if (![...Object.values(dps), standardError].every(Number.isFinite)) throw new Error('회차별 결과 차이가 지원 숫자 범위를 벗어났습니다.');
    paired = { samples, dps, standardError, positive: samples.filter(value => value > 0).length,
      equal: samples.filter(value => value === 0).length, negative: samples.filter(value => value < 0).length };
  }
  return {
    boundary: (paired ? '같은 계열·같은 계산 조건에서 확률 변동을 통제한 모델 내 비교입니다. 실제 세팅 판단에는 변경 효과의 지원 범위와 가정 민감도를 확인해야 합니다. '
      : '저장된 모델 결과의 산술 차이이며 세팅 우열 판정이 아닙니다. ')
      + (modelStatus === 'unknown' ? '엔진 버전 정보가 없어 같은 엔진의 결과인지 확인할 수 없습니다. '
        : modelStatus === 'same' ? '저장된 계산 소스 식별값이 같습니다. 파일 진위·실행 환경·게임 정확도를 보증하지 않습니다. ' : '저장된 계산 소스 식별값이 다릅니다. ')
      + (before.config.randomMode === 'partitioned-v1' && after.config.randomMode === 'partitioned-v1'
        ? '같은 종류·스킬의 판정 순서에 같은 난수를 사용합니다. 덱·손패·발동 횟수가 달라지면 카드와 전투 흐름도 달라집니다. '
        : '같은 시작 seed도 같은 카드 추첨을 보장하지 않습니다. ')
      + '표본 분포는 별도 반복 묶음의 범위나 신뢰구간이 아닙니다. '
      + (paired ? '평균 차이의 표준오차는 반복 표본의 변동 추정이며 미확인 게임 수치·운용 가정의 오차를 포함하지 않습니다. ' : '')
      + '변화율 null은 기준값0 또는 표현 범위 초과입니다.',
    before, after, modelStatus, differences: diffBuilds(before.build, after.build), blockers, metrics: blockers.length ? null : metrics,
    pairedBlockers, paired,
  };
}
