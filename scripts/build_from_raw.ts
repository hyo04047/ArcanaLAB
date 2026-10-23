// data/raw/<캐릭터명>/ 원본을 변환한다. --json은 변환만, 기본 모드는 요약·경고와 시뮬 결과를 출력한다.
// 사용: npx --no-install vite-node scripts/build_from_raw.ts 캐릭터명 [iterations | --json]
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFromArmory, type RawArmory } from '../src/engine/armory';
import { cardsFor, simulate } from '../src/engine';

const name = process.argv[2];
if (!name) { console.error('캐릭터명을 주세요'); process.exit(1); }
if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(name)) { console.error('캐릭터명에 경로 문자나 지원하지 않는 문자가 있습니다.'); process.exit(1); }
const dir = resolve(import.meta.dirname, '..', 'data', 'raw', name);
const load = (f: string) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
const raw: RawArmory = { profiles: load('profiles.json'), combatSkills: load('combat-skills.json'), arkpassive: load('arkpassive.json'), arkgrid: load('arkgrid.json'), engravings: load('engravings.json'), gems: load('gems.json') };
raw.equipment = existsSync(resolve(dir, 'equipment.json')) ? load('equipment.json') : null;
raw.cards = existsSync(resolve(dir, 'cards.json')) ? load('cards.json') : null;

const { build, warnings, summary } = buildFromArmory(raw);
if (process.argv[3] === '--json') {
  console.log(JSON.stringify({ build, warnings, summary }, null, 2));
} else {
  console.log(summary.join('\n'));
  console.log(`\n경고 ${warnings.length}건`);
  for (const w of warnings) console.log('  - ' + w);
  console.log('\n로테이션', JSON.stringify(build.rotation));
  console.log('\n스킬 상세');
  for (const s of build.skills) console.log(`  ${s.name.padEnd(12)} ${s.kind.padEnd(16)} cd ${s.cooldown.toFixed(1).padStart(5)} cast ${s.castTime.toFixed(2)} flat ${s.directFlat ?? 0} coef ${s.directCoef} mods ${(s.mods ?? []).map((m) => `${m.bucket}${m.value >= 0 ? '+' : ''}${(m.value * 100).toFixed(1)}%`).join(',')} onCast ${(s.onCast ?? []).map((e) => e.id).join(',')}`);

  const n = Number(process.argv[3] ?? 200);
  const s = simulate(build, cardsFor(build.variant, build.deckOverrides), { durationSec: 180, iterations: n, seed: 1 });
  const f = (x: number) => Math.round(x).toLocaleString('ko-KR');
  console.log(`\n시뮬 ${n}회 × 180초: DPS(임시값, 세팅 비교 불가) 중앙값 ${f(s.dps.median)} p10 ${f(s.dps.p10)} p90 ${f(s.dps.p90)}  분당 카드 ${s.cardsPerMin.toFixed(1)}  4스택 루인 ${(s.ruinAt4Rate * 100).toFixed(0)}%`);
  for (const b of s.breakdown.slice(0, 6)) console.log(`  ${b.name.padEnd(12)} ${s.dps.mean > 0 ? (((b.direct + b.stackEffect + (b.dot ?? 0)) / (s.dps.mean * s.durationSec)) * 100).toFixed(1).padStart(5) + '%' : '계산 불가'}  ${b.casts.toFixed(1)}회`);
}
