// runSavedBuild 전용 계산 프로세스입니다. stdin JSON을 읽고 완료된 결과만 stdout에 출력합니다.
import { readFileSync } from 'node:fs';
import { cardsFor, simulate } from '../src/engine';
import { parseBuildInput } from '../src/compare';
import { modelIdentity } from './model_identity';

try {
  const text = readFileSync(0, 'utf8'), input = parseBuildInput(text, '계산 입력');
  const config = JSON.parse(text).config, modelId = modelIdentity(process.cwd());
  const result = simulate(input.build, cardsFor(input.build.variant, input.build.deckOverrides), config);
  if (input.warnings?.length) result.inputWarnings = [...input.warnings];
  if (modelIdentity(process.cwd()) !== modelId) throw new Error('실행 중 계산 소스가 변경됐습니다. 다시 실행하세요.');
  console.log(JSON.stringify({ build: input.build, ...(input.warnings === null ? {} : { warnings: input.warnings }), config, result, modelId }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
