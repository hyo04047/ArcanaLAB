import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from '../presets';
import { simulate } from '../sim';
import type { SkillDef } from '../types';

function result(runes: { name: string; chance: number; fraction: number }[]) {
  const build = empressInkomsu440();
  build.skills = runes.map((rune, i): SkillDef => ({ id: `test_${i}`, name: rune.name, kind: 'normal',
    cooldown: 10, castTime: 1, directCoef: 1, hits: 1,
    runeCdReduce: { chance: rune.chance, fraction: rune.fraction } }));
  build.rotation = { ruinPriority: [], stackPriority: [], fillers: build.skills.map(skill => skill.id) };
  // 검색 변환 경고가 없는 단독 결과를 저장해도 확률의 한계가 남아야 합니다.
  return JSON.parse(JSON.stringify(simulate(build, [], { durationSec: 0.5, iterations: 1, seed: 42 })));
}

describe('quick recharge assumptions in standalone results', () => {
  it.each([0.1, 0.2])('preserves the actual %s input chance separately from the cooldown fraction', chance => {
    const summary = result([{ name: '룬 시험', chance, fraction: 0.16 }]);
    expect(summary.damageWarnings).toContainEqual(expect.stringContaining(`룬 시험 속행 발동 확률 [미확인] ${chance * 100}% 가정`));
    expect(summary.damageWarnings).toContainEqual(expect.stringContaining('남은 쿨 16% 감소율과 다릅니다'));
  });

  it('keeps different rune inputs associated with their skills', () => {
    const summary = result([{ name: '첫 스킬', chance: 0.2, fraction: 0.16 }, { name: '둘째 스킬', chance: 0.1, fraction: 0.12 }]);
    expect(summary.damageWarnings.filter((warning: string) => warning.includes('속행 발동 확률'))).toEqual([
      expect.stringMatching(/첫 스킬.*20%.*16%/), expect.stringMatching(/둘째 스킬.*10%.*12%/),
    ]);
  });

  it('does not claim a quick recharge assumption when no skill has that rune', () => {
    expect(result([]).damageWarnings.some((warning: string) => warning.includes('속행 발동 확률'))).toBe(false);
  });
});
