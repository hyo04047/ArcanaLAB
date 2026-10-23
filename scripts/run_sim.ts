// CLI 실행: npx vite-node scripts/run_sim.ts [duration] [iterations] [seed]
import { cardsFor, empressInkomsu440, simulate } from '../src/engine';
import { CARD_DRAW_LABELS } from '../src/engine/cards';
import type { CardDrawSource } from '../src/engine';

const [d = '180', n = '300', seed = '1'] = process.argv.slice(2);
const build = empressInkomsu440();
const s = simulate(build, cardsFor(build.variant, build.deckOverrides), { durationSec: Number(d), iterations: Number(n), seed: Number(seed) });
const f = (x: number) => Math.round(x).toLocaleString('ko-KR');
console.log(`${s.build} — ${s.iterations}회 × ${s.durationSec}초`);
for (const warning of s.damageWarnings) console.log('  - ' + warning);
for (const warning of s.cardSupplyWarnings) console.log('  - ' + warning);
console.log(`DPS(임시값, 세팅 비교 불가) 중앙값 ${f(s.dps.median)} 평균 ${f(s.dps.mean)} p10 ${f(s.dps.p10)} p90 ${f(s.dps.p90)} stdev ${f(s.dps.stdev)} (p90/p10 ${s.dps.p10 > 0 ? (s.dps.p90 / s.dps.p10).toFixed(3) : '계산 불가(p10=0)'})`);
console.log(`분당 카드 획득 ${s.cardsPerMin.toFixed(2)}장 / 사용 ${s.cardsUsedPerMin.toFixed(2)}장  종료 손패 평균 ${s.cardsHeldAtEnd.toFixed(2)}장`);
console.log(`4스택 루인 비율 ${(s.ruinAt4Rate * 100).toFixed(1)}%`);
for (const source of Object.keys(s.cardsPerMinBySource) as CardDrawSource[]) {
  if (s.cardsPerMinBySource[source]) console.log(`  ${CARD_DRAW_LABELS[source]} ${s.cardsPerMinBySource[source].toFixed(2)}장/분`);
}
for (const b of s.breakdown) {
  const tot = b.direct + b.stackEffect + (b.dot ?? 0);
  console.log(`  ${b.name.padEnd(12)} ${s.dps.mean > 0 ? ((tot / (s.dps.mean * s.durationSec)) * 100).toFixed(1).padStart(5) + '%' : '계산 불가'}  직접 ${f(b.direct).padStart(10)}  스택트 ${f(b.stackEffect).padStart(10)}${b.dot !== undefined ? `  중독 ${f(b.dot)}` : ''}  ${b.casts.toFixed(1)}회`);
}
