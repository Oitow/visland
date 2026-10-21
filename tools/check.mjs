// Quick checks that need no browser: the same seed grows the same island, every island has its crystals and a
// place to stand, and its chunks mesh. Run with: npm run check
import { World, SIZE, SEA, CHUNK, CRYSTALS } from '../src/world.js';
import { meshChunk } from '../src/mesher.js';
import { seedOf } from '../vendor/almanac/seeds.js';
import { hash32 } from '../vendor/almanac/random.js';
import { AIR } from '../src/blocks.js';

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const digest = (w) => w.data.reduce((h, v, i) => (v ? hash32(h ^ (i * 31 + v)) : h), 7);

for (const name of ['nebel-bucht-7', 'koralle-riff-3', 'sturm-kap-91', 'lava-klippe-47', '12345']) {
  const t0 = performance.now();
  const a = new World(seedOf(name));
  a.generate();
  const ms = performance.now() - t0;
  const b = new World(seedOf(name));
  b.generate();
  check(digest(a) === digest(b), `${name}: the same seed grows the same island (${ms.toFixed(0)} ms)`);
  check(a.crystals.length === CRYSTALS, `${name}: ${a.crystals.length} crystals hidden`);
  const [x, y, z] = a.spawn.map(Math.floor);
  check(y > SEA && a.get(x, y, z) === AIR && a.get(x, y + 1, z) === AIR && a.get(x, y - 1, z) !== AIR, `${name}: the spawn is open ground above the sea`);
  let faces = 0;
  const m0 = performance.now();
  for (let cz = 0; cz < SIZE / CHUNK; cz++) for (let cx = 0; cx < SIZE / CHUNK; cx++) faces += meshChunk(a, cx, cz).index.length / 6;
  check(faces > 10000, `${name}: meshed ${faces} faces in ${(performance.now() - m0).toFixed(0)} ms`);
}
check(seedOf('Nebel-Bucht-7 ') === seedOf('nebel-bucht-7'), 'seeds ignore case and spaces at the ends');
process.exit(failed ? 1 : 0);
