import { Deck } from '../src/engine/deck';
import { createRng } from '../src/engine/rng';

const mode = process.argv[2];
const cards = mode === 'one' ? [{ id: 'control', name: 'control', duration: null, weight: 1, availability: ['empress'] }] : [];
const deck = new Deck(cards), rng = createRng(42);
process.stdout.write('started\n');
try {
  const drawn = deck.addGauge(mode === 'infinite' ? Infinity : 1e20, rng);
  process.stdout.write(JSON.stringify({ drawn, gauge: deck.gauge, hand: deck.hand, next: rng.next() }) + '\n');
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
