import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const source = JSON.parse(readFileSync(new URL('../tests/fixtures/audit/2026-10-17-fresh-armory-sources.json', import.meta.url), 'utf8'));
function summarize(record, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'arcanalab-parse-test-'));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(new URL('./parse_armory.mjs', import.meta.url), join(root, 'scripts/parse_armory.mjs'));
    const dir = join(root, 'data/raw', record.character); mkdirSync(dir, { recursive: true });
    for (const response of record.responses) writeFileSync(join(dir, response.endpoint + '.json'),
      Object.hasOwn(overrides, response.endpoint) ? JSON.stringify(overrides[response.endpoint]) : response.body);
    const result = spawnSync(process.execPath, [join(root, 'scripts/parse_armory.mjs'), record.character], { encoding: 'utf8', cwd: root, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(readFileSync(join(dir, 'parsed.json'), 'utf8'));
    return parsed;
  } finally {
    const absolute = resolve(root);
    assert.equal(dirname(absolute), resolve(tmpdir()));
    assert(basename(absolute).startsWith('arcanalab-parse-test-'));
    rmSync(absolute, { recursive: true, force: true });
  }
}
for (const record of source.records) test(`${record.character}: preserve both available T skills and minute cooldowns in the human-readable summary`, () => {
    const parsed = summarize(record);
    assert.deepEqual(parsed.skills.filter(s => s.skillType === 1).map(s => [s.name, s.level, s.cooldown]).sort(),
      [['더 데빌', 1, 60], ['더 썬', 1, 80]]);
    assert(parsed.skillSelectionNote.includes('장착 여부'));
    const original = JSON.parse(record.responses.find(r => r.endpoint === 'combat-skills').body);
    for (const item of original.filter(s => s.SkillType !== 1 && s.Level <= 1 && !(s.Tripods ?? []).some(t => t.IsSelected)))
      assert(!parsed.skills.some(s => s.name === item.Name), item.Name);
});

const expectedEffects = [
  [['공격력', '공격력 +2.01%'], ['아군 피해 강화', '아군 피해량 강화 효과 +0.26%'], ['보스 피해', '보스 등급 이상 몬스터에게 주는 피해 +1.75%'],
    ['추가 피해', '추가 피해 +3.23%'], ['낙인력', '낙인력 +5.16%'], ['아군 공격 강화', '아군 공격력 강화 효과 +0.52%']],
  [['추가 피해', '추가 피해 +4.20%'], ['공격력', '공격력 +2.05%'], ['아군 공격 강화', '아군 공격력 강화 효과 +0.26%'],
    ['보스 피해', '보스 등급 이상 몬스터에게 주는 피해 +1.08%'], ['아군 피해 강화', '아군 피해량 강화 효과 +0.57%'], ['낙인력', '낙인력 +2.66%']],
];
for (const [index, record] of source.records.entries()) test(`${record.character}: preserve six official aggregate grid descriptions`, () => {
  assert.deepEqual(summarize(record).arkgrid.effects.map(e => [e.name, e.desc]), expectedEffects[index]);
});
for (const endpoint of ['arkpassive', 'arkgrid', 'engravings']) test(`${endpoint}: preserve an official nullable response without aborting the summary`, () => {
  const parsed = summarize(source.records[0], { [endpoint]: null });
  assert.equal(parsed[endpoint], null);
  assert.equal(parsed.character.name, source.records[0].character);
  assert(parsed.skills.length > 0);
});
