// Prints an island as an ASCII map, to see its shape without a browser: node tools/map.mjs [seed]
import { World, SIZE, SEA } from '../src/world.js';
import { seedOf } from '../vendor/almanac/seeds.js';
import { BLOCKS } from '../src/blocks.js';
const seed = seedOf(process.argv[2] || 'nebel-bucht-7');
const t0 = performance.now();
const w = new World(seed);
w.generate();
console.log(`seed ${seed}: ${(performance.now() - t0).toFixed(0)} ms, crystals ${w.crystals.length}, spawn ${w.spawn}`);
const ch = { Sand: '.', Gras: '"', Steppengras: ',', Stein: '^', Schnee: '*', Holz: 'T', Laub: 'T', Nadeln: 'A', Palmblatt: 'P', Kies: ':', Kristall: '@' };
let hist = {};
for (let z = 0; z < SIZE; z += 2) {
  let row = '';
  for (let x = 0; x < SIZE; x += 2) {
    const y = w.topY(x, z), b = BLOCKS[w.get(x, y, z)].name;
    hist[b] = (hist[b] || 0) + 1;
    row += y <= SEA - 1 ? (y > SEA - 4 ? '~' : ' ') : ch[b] || '?';
  }
  console.log(row);
}
console.log(hist, 'max ground', Math.max(...w.ground));
