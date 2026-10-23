// 사용: npx --no-install vite-node scripts/replay_result.ts saved-result.json > replayed-result.json
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseResultInput } from '../src/resultComparison';
import { runSavedBuild } from './run_saved_build';

try {
  const paths = process.argv.slice(2);
  if (paths.length !== 1) throw new Error('사용: npx --no-install vite-node scripts/replay_result.ts saved-result.json');
  const text = readFileSync(paths[0]!, 'utf8');
  const saved = parseResultInput(text, paths[0]!);
  if (!saved) throw new Error('실행 결과가 저장되지 않았습니다.');
  const replayed = runSavedBuild({ build: saved.build, warnings: saved.warnings ?? saved.result.inputWarnings ?? null }, saved.config);
  const matches = isDeepStrictEqual(saved.result, replayed.result);
  const warningGroups = ['damageWarnings', 'cardSupplyWarnings', 'inputWarnings'] as const;
  const [savedCalculation, currentCalculation] = [saved.result, replayed.result].map(result =>
    Object.fromEntries(Object.entries(result).filter(([key]) => !warningGroups.some(group => group === key))));
  console.log(JSON.stringify({ ...replayed, warnings: saved.warnings ?? undefined, replay: {
      source: paths[0], sourceSha256: createHash('sha256').update(text).digest('hex'), savedModelId: saved.modelId ?? null,
      matchesSavedResult: matches,
      matchesSavedCalculation: isDeepStrictEqual(savedCalculation, currentCalculation),
      changedWarningGroups: warningGroups.filter(group => !isDeepStrictEqual(saved.result[group], replayed.result[group])),
      boundary: '원본을 수정하지 않고 현재 엔진에서 전체 입력·조건을 다시 실행했습니다. 전체 일치에는 안내를 포함하며 계산 일치는 안내 배열만 제외한 수치·집계의 엄격한 비교입니다. 결과 일치는 과거 엔진 동일성이나 게임 정확도의 증명이 아닙니다. 불일치 시에도 이 파일의 result는 현재 실행 결과입니다.',
  } }, null, 2));
  if (!matches) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
