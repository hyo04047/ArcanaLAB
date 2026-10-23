// 사용: npx --no-install vite-node scripts/simulate_build.ts input.json [duration] [iterations] [seed] [randomMode]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseBuildInput } from '../src/compare';
import { runSavedBuild } from './run_saved_build';
import { validRandomMode } from '../src/engine/rng';

try {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 5) throw new Error('사용: npx --no-install vite-node scripts/simulate_build.ts input.json [duration] [iterations] [seed] [randomMode: legacy|partitioned-v1]');
  const [path, duration = '180', iterations = '500', seed = '1', randomMode = 'legacy'] = args;
  if (!validRandomMode(randomMode)) throw new Error('지원하지 않는 난수 방식입니다. legacy 또는 partitioned-v1을 사용하세요.');
  const text = readFileSync(path!, 'utf8'), input = parseBuildInput(text, path!);
  const calculated = runSavedBuild(input, { durationSec: Number(duration), iterations: Number(iterations), seed: Number(seed),
    ...(randomMode === 'partitioned-v1' ? { randomMode } : {}) });
  const { warnings, ...rest } = calculated;
  console.log(JSON.stringify({ ...rest, ...(warnings === null ? {} : { warnings }),
    source: { path, sha256: createHash('sha256').update(text).digest('hex') },
    boundary: '전체 Build의 현재 모델 실행입니다. 기록용 stats·attackPower만 바꾸어도 계산 효과가 재생성되지는 않습니다. 장착 적법성·게임 정확도·세팅 우열은 판정하지 않습니다.',
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
