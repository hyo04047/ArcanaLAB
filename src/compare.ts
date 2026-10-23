import type { Build } from './engine/types';

/** 비교용 저장 형식만 확인하며 장착 조건이나 전체 계산 입력의 유효성을 판정하지 않습니다. */
export function parseBuildInput(text: string, label: string): { build: Build; warnings: string[] | null } {
  let input;
  let numberOverflow = false;
  try {
    input = JSON.parse(text, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) numberOverflow = true;
      return value;
    });
  }
  catch { throw new Error(`JSON 형식을 확인하세요: ${label}`); }
  if (numberOverflow) throw new Error(`JSON 숫자가 지원 범위를 벗어났습니다: ${label}`);
  const build = input?.build ?? input;
  if (!build || typeof build.name !== 'string' || !['empress', 'emperor'].includes(build.variant)
    || !Array.isArray(build.skills) || !Array.isArray(build.passiveMods)
    || !build.params || !build.rotation || !build.stats) throw new Error(`Build 형식을 확인하세요: ${label}`);
  const warnings = input?.build ? input.warnings : undefined;
  if (warnings !== undefined && (!Array.isArray(warnings) || !warnings.every((warning: unknown) => typeof warning === 'string')))
    throw new Error(`입력 경고 형식을 확인하세요: ${label}`);
  return { build: build as Build, warnings: warnings ?? null };
}

export interface BuildDifference {
  /** JSON Pointer. 배열의 순서는 운용 순서 등 계산 입력이므로 그대로 비교합니다. */
  path: string;
  change: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

/** 저장 가능한 전체 입력의 구조 차이입니다. 유효한 장착·효과 적용·성능 차이를 판정하지 않습니다. */
export function diffBuilds(before: Build, after: Build): BuildDifference[] {
  const changes: BuildDifference[] = [];
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (Object.is(a, b)) return;
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        const child = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        if (!Object.hasOwn(left, key)) changes.push({ path: child, change: 'added', after: right[key] });
        else if (!Object.hasOwn(right, key)) changes.push({ path: child, change: 'removed', before: left[key] });
        else walk(left[key], right[key], child);
      }
    } else changes.push({ path, change: 'changed', before: a, after: b });
  };
  // optional undefined는 저장 JSON에서 생략되므로 같은 기준으로 정규화합니다.
  walk(JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(after)), '');
  return changes;
}
