// Quick checks that need no browser: the same seed grows the same island, every island has its crystals and a
// place to stand, its ground meshes, digging takes ground away, and the player stands and walks on it.
// Run with: npm run check
import { World, SIZE, CHUNK, CRYSTALS, WATER_Y } from '../src/world.js';
import { meshChunk } from '../src/surfacenets.js';
import { Player } from '../src/player.js';
import { seedOf } from '../vendor/almanac/seeds.js';
import { hash32 } from '../vendor/almanac/random.js';

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const digest = (w) => w.density.reduce((h, v, i) => (v > 0 ? hash32(h ^ (i * 31 + w.mat[i])) : h), 7);

for (const name of ['nebel-bucht-7', 'koralle-riff-3', 'sturm-kap-91', 'lava-klippe-47', '12345']) {
  const t0 = performance.now();
  const a = new World(seedOf(name));
  a.generate();
  const ms = performance.now() - t0;
  const b = new World(seedOf(name));
  b.generate();
  check(digest(a) === digest(b), `${name}: the same seed grows the same island (${ms.toFixed(0)} ms, ${a.trees.length} trees)`);
  check(a.crystals.length === CRYSTALS && a.crystals.some((c) => c.cave), `${name}: ${a.crystals.length} crystals hidden, one in a cave`);
  const [x, y, z] = a.spawn;
  check(y > WATER_Y && !a.solid(x, y + 0.2, z) && a.solid(x, y - 0.3, z), `${name}: the spawn is open ground above the sea`);
  let tris = 0,
    bad = 0;
  const m0 = performance.now();
  for (let cz = 0; cz < SIZE / CHUNK; cz++)
    for (let cx = 0; cx < SIZE / CHUNK; cx++) {
      const m = meshChunk(a, cx, cz);
      tris += m.index.length / 3;
      for (const v of m.position) if (!Number.isFinite(v)) bad++;
    }
  check(tris > 20000 && !bad, `${name}: meshed ${tris} triangles in ${(performance.now() - m0).toFixed(0)} ms`);

  // the player lands on the ground and stays there, then walks
  const p = new Player(a);
  for (let i = 0; i < 60; i++) p.update(1 / 60, { x: 0, z: 0, jump: false });
  check(p.onGround && Math.abs(p.y - y) < 0.4, `${name}: the player stands on the ground (y ${p.y.toFixed(2)} at ${y.toFixed(2)})`);
  const start = [p.x, p.z];
  for (let i = 0; i < 120; i++) p.update(1 / 60, { x: 0, z: 1, jump: false });
  const moved = Math.hypot(p.x - start[0], p.z - start[1]);
  check(moved > 1 && !a.solid(p.x, p.y + 0.5, p.z), `${name}: the player walks ${moved.toFixed(1)} m and is not inside the ground`);

  // digging under the player's feet takes ground away; building puts it back
  const [gx, gy, gz] = [p.x, p.y - 0.4, p.z];
  const took = a.brush(gx, gy, gz, 1.25, false);
  check(took.size > 0 && !a.solid(gx, gy, gz), `${name}: digging takes ground away`);
  a.brush(gx, gy, gz, 1.1, true, 4);
  check(a.solid(gx, gy, gz), `${name}: building puts ground back`);
}
const { seedOf: so } = await import('../vendor/almanac/seeds.js');
check(so('Nebel-Bucht-7 ') === so('nebel-bucht-7'), 'seeds ignore case and spaces at the ends');
process.exit(failed ? 1 : 0);
