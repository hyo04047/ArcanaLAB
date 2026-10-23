// 사용: npx --no-install vite-node scripts/compare_builds.ts before.json after.json
// Build 또는 buildFromArmory 결과 { build, warnings, summary }를 읽고 stdout에 JSON을 출력합니다.
import { readFileSync } from 'node:fs';
import { diffBuilds, parseBuildInput } from '../src/compare';
import { describeBuildPath } from '../src/buildDifferenceDescriptions';

function readInput(path: string) {
  return { path, ...parseBuildInput(readFileSync(path, 'utf8'), path) };
}

try {
  const paths = process.argv.slice(2);
  if (paths.length !== 2) throw new Error('사용: npx --no-install vite-node scripts/compare_builds.ts before.json after.json');
  const before = readInput(paths[0]!), after = readInput(paths[1]!);
  const differences = diffBuilds(before.build, after.build);
  console.log(JSON.stringify({
    boundary: '변환된 Build 전체의 구조 차이입니다. 실제 장착 가능 여부·효과 반영·세팅 우열은 판정하지 않습니다. stats·attackPower 기록만 바꾸면 계산 효과는 재생성되지 않습니다. warnings가 null이면 입력 당시 안내가 제공되지 않은 것이며 경고 없음이 아닙니다.',
    before: { path: before.path, name: before.build.name, inputWarnings: before.warnings },
    after: { path: after.path, name: after.build.name, inputWarnings: after.warnings },
    differenceCount: differences.length, differences,
    differenceDescriptions: differences.map(change => ({ path: change.path, description: describeBuildPath(before.build, after.build, change.path) })),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
