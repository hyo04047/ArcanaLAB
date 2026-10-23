// 사용: npx --no-install vite-node scripts/compare_results.ts before.json after.json
import { readFileSync } from 'node:fs';
import { compareResults, parseResultInput } from '../src/resultComparison';
import { describeBuildPath } from '../src/buildDifferenceDescriptions';

try {
  const paths = process.argv.slice(2);
  if (paths.length !== 2) throw new Error('사용: npx --no-install vite-node scripts/compare_results.ts before.json after.json');
  const inputs = paths.map(path => {
    const input = parseResultInput(readFileSync(path, 'utf8'), path);
    if (!input) throw new Error(`실행 결과가 저장되지 않았습니다: ${path}`);
    return input;
  });
  const compared = compareResults(inputs[0]!, inputs[1]!);
  console.log(JSON.stringify({ paths, ...compared,
    differenceDescriptions: compared.differences.map(change => ({ path: change.path,
      description: describeBuildPath(inputs[0]!.build, inputs[1]!.build, change.path) })),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
