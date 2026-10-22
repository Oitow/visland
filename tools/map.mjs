// Prints an island as an ASCII map, to see its shape without a browser: node tools/map.mjs [seed]
import { World, SIZE, WATER_Y } from '../src/world.js';
import { MATERIALS } from '../src/materials.js';
import { seedOf } from '../vendor/almanac/seeds.js';
const w = new World(seedOf(process.argv[2] || 'nebel-bucht-7'));
w.generate();
const ch = { Sand: '.', Gras: '"', Steppengras: ',', Stein: '^', Schnee: '*', Kies: ':', Erde: '%' };
const trees = new Set(w.trees.map((t) => (Math.floor(t.z / 2) * SIZE) / 2 + Math.floor(t.x / 2)));
const crystals = new Set(w.crystals.map((c) => (Math.floor(c.z / 2) * SIZE) / 2 + Math.floor(c.x / 2)));
for (let z = 0; z < SIZE; z += 2) {
  let row = '';
  for (let x = 0; x < SIZE; x += 2) {
    const k = (z / 2) * (SIZE / 2) + x / 2;
    const y = w.surfaceY(x, z);
    if (crystals.has(k)) row += '@';
    else if (trees.has(k)) row += 'T';
    else if (y < WATER_Y) row += y > WATER_Y - 3 ? '~' : ' ';
    else row += ch[MATERIALS[w.m(x, Math.floor(y - 0.3), z)]?.name] || '?';
  }
  console.log(row);
}
