// 사용: npx --no-install vite-node scripts/compare_results.ts before.json after.json
import { readSavedText } from './read_saved_text';
import { compareResults, parseResultInput } from '../src/resultComparison';
import { describeBuildPath } from '../src/buildDifferenceDescriptions';
import { readSettingInput } from '../src/settingFiles';
import { modelIdentity } from './model_identity';

try {
  const paths = process.argv.slice(2);
  if (paths.length !== 2) throw new Error('사용: npx --no-install vite-node scripts/compare_results.ts before.json after.json');
  const parsed = await Promise.all(paths.map(async path => {
    const text = readSavedText(path);
    const selection = await readSettingInput(text, path, modelIdentity(process.cwd()));
    const input = parseResultInput(text, path);
    if (!input) throw new Error(`실행 결과가 저장되지 않았습니다: ${path}`);
    return { input, notices: selection.setting === undefined ? null : selection.notices };
  }));
  const inputs = parsed.map(item => item.input);
  const notices = parsed.flatMap((item, index) => item.notices === null ? [] : [{ path: paths[index], notices: item.notices }]);
  const compared = compareResults(inputs[0]!, inputs[1]!);
  console.log(JSON.stringify({ paths, ...compared,
    ...(notices.length ? { selectionNotices: notices } : {}),
    differenceDescriptions: compared.differences.map(change => ({ path: change.path,
      description: describeBuildPath(inputs[0]!.build, inputs[1]!.build, change.path) })),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
