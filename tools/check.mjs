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

  // walking straight at a tree trunk stops at its bark
  const tree = a.trees.find((t) => t.kind === 'oak' || t.kind === 'pine' || t.kind === 'birch');
  if (tree) {
    const q = new Player(a);
    Object.assign(q, { x: tree.x - 2, z: tree.z, y: a.surfaceY(tree.x - 2, tree.z) + 0.05, yaw: -Math.PI / 2, vy: 0 });
    for (let i = 0; i < 120; i++) q.update(1 / 60, { x: 0, z: 1, jump: false });
    // how near the body came to the bark, at its own height
    let gap = Infinity;
    for (const s of tree.segs.filter((s) => s.trunk))
      for (let h = q.y + 0.3; h <= q.y + 1.6; h += 0.1) {
        const f = (h - s.a[1]) / (s.b[1] - s.a[1]);
        if (f < 0 || f > 1) continue;
        gap = Math.min(gap, Math.hypot(q.x - (s.a[0] + (s.b[0] - s.a[0]) * f), q.z - (s.a[2] + (s.b[2] - s.a[2]) * f)) - s.r);
      }
    check(gap > 0.25, `${name}: a ${tree.kind} trunk stops the player (${gap.toFixed(2)} m from the bark)`);
  }

  // digging under the player's feet takes ground away; building puts it back
  const [gx, gy, gz] = [p.x, p.y - 0.4, p.z];
  const took = a.brush(gx, gy, gz, 1.25, false);
  check(took.size > 0 && !a.solid(gx, gy, gz), `${name}: digging takes ground away`);
  a.brush(gx, gy, gz, 1.1, true, 4);
  check(a.solid(gx, gy, gz), `${name}: building puts ground back`);
}
const { seedOf: so } = await import('../vendor/almanac/seeds.js');
check(so('Nebel-Bucht-7 ') === so('nebel-bucht-7'), 'seeds ignore case and spaces at the ends');
// every kind of tree grows somewhere among a handful of islands
const kinds = new Set();
for (const n of ['nebel-bucht-7', 'koralle-riff-3', 'sturm-kap-91']) {
  const w = new World(seedOf(n));
  w.generate();
  for (const t of w.trees) kinds.add(t.kind);
}
check(['oak', 'birch', 'pine', 'palm', 'umbrella', 'bush'].every((k) => kinds.has(k)), `every kind of tree grows (${[...kinds].join(', ')})`);
process.exit(failed ? 1 : 0);
