import { describe, expect, it } from 'vitest';
import { empressInkomsu440 } from './engine/presets';
import { parseBuildInput } from './compare';
import { describeBuildPath } from './buildDifferenceDescriptions';

describe('input difference descriptions without semantic matching', () => {
  it('identifies both skills when array positions change', () => {
    const before = empressInkomsu440(), after = structuredClone(before);
    [after.skills[0], after.skills[1]] = [after.skills[1]!, after.skills[0]!];
    const description = describeBuildPath(before, after, '/skills/0/castTime');
    expect(description).toContain(`기준 스킬: ${before.skills[0]!.name}`);
    expect(description).toContain(`비교 스킬: ${after.skills[0]!.name}`);
    expect(description).toContain('시전 시간');
  });

  it('keeps added and removed skills tied to the existing side', () => {
    const before = empressInkomsu440(), after = structuredClone(before);
    after.skills.pop(); const index = after.skills.length;
    expect(describeBuildPath(before, after, `/skills/${index}`)).toBe(`삭제 스킬: ${before.skills[index]!.name} · 전체 스킬 입력`);
    expect(describeBuildPath(after, before, `/skills/${index}`)).toBe(`추가 스킬: ${before.skills[index]!.name} · 전체 스킬 입력`);
  });

  it('does not assume the lightweight parser validates every skill', () => {
    const before = empressInkomsu440();
    const after = parseBuildInput(JSON.stringify({ ...before, skills: [null], passiveMods: [null] }), '일부 구조').build;
    expect(() => describeBuildPath(before, after, '/skills/0')).not.toThrow();
    expect(describeBuildPath(after, after, '/skills/0/quickDraw')).toBe('이름 없음 · 퀵 드로');
    expect(describeBuildPath(after, after, '/passiveMods/0/value')).toBe('공통 효과 · 출처 없음');
  });

  it('does not label an unknown or escaped key as a supported effect', () => {
    const build = empressInkomsu440();
    expect(describeBuildPath(build, build, '/constructor/value')).toBe('기타 설정');
    expect(describeBuildPath(build, build, '/skills/0/onHit~1custom')).toBe(`${build.skills[0]!.name} · 스킬 설정`);
    expect(describeBuildPath(build, build, '/skills/0/constructor')).toBe(`${build.skills[0]!.name} · 스킬 설정`);
  });

  it('calls metadata records and does not mutate source builds', () => {
    const build = empressInkomsu440(), snapshot = JSON.stringify(build);
    expect(describeBuildPath(build, build, '/stats/crit')).toBe('특성 기록');
    expect(describeBuildPath(build, build, '/attackPower/total')).toBe('공격력 산출 기록');
    expect(JSON.stringify(build)).toBe(snapshot);
  });
});
