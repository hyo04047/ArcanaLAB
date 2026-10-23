import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { SimConfig } from '../src/engine/types';
import type { parseBuildInput } from '../src/compare';
import { parseResultInput } from '../src/resultComparison';
import { modelIdentity } from './model_identity';
import { validRandomMode } from '../src/engine/rng';

/** 외부 JSON의 완전한 계산 유효성을 가정하지 않고 별도 프로세스의 실행 시간을 제한합니다. */
export function runSavedBuild(input: ReturnType<typeof parseBuildInput>, config: SimConfig) {
  if (!validRandomMode(config.randomMode)) throw new Error('지원하지 않는 난수 방식입니다.');
  if (!Number.isFinite(config.durationSec) || config.durationSec <= 0 || config.durationSec > 900
    || !Number.isSafeInteger(config.iterations) || config.iterations < 1 || config.iterations > 20000
    || !Number.isSafeInteger(config.seed)) throw new Error('실행 조건을 확인하세요: 시간은 0초 초과·900초 이하, 반복은 1~20,000 정수, seed는 안전한 정수여야 합니다.');
  const modelId = modelIdentity(process.cwd());
  const command = spawnSync(process.execPath, [resolve('node_modules/vite-node/vite-node.mjs'), resolve('scripts/saved_build_worker.ts')], {
    encoding: 'utf8', input: JSON.stringify({ build: input.build, ...(input.warnings === null ? {} : { warnings: input.warnings }), config }),
    timeout: 30000, maxBuffer: 10 * 1024 * 1024,
  });
  if (command.error) throw new Error((command.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    ? '계산이 30초 제한을 넘어 종료됐습니다. 완료 결과가 없습니다.' : command.error.message);
  if (command.status !== 0) throw new Error(command.stderr.trim() || '계산에 실패했습니다.');
  const result = parseResultInput(command.stdout, '새 계산 결과')!;
  if (result.modelId !== modelId || modelIdentity(process.cwd()) !== modelId) throw new Error('실행 중 계산 소스가 변경됐습니다. 다시 실행하세요.');
  return result;
}
