// Quick checks that need no browser: the same seed grows the same island, every island has its crystals and a
// place to stand, its ground meshes, digging takes ground away, and the player stands and walks on it.
// Run with: npm run check
import { World, SIZE, CHUNK, CRYSTALS, WATER_Y, VOX, NY } from '../src/world.js';
import { meshChunk } from '../src/surfacenets.js';
import { Player } from '../src/player.js';
import { seedOf } from '../vendor/almanac/seeds.js';
import { hash32 } from '../vendor/almanac/random.js';

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const digest = (w) => {
  let h = 7;
  w.dense.forEach((a, b) => {
    h = hash32(h ^ (b * 31 + w.uni[b]));
    if (a) for (let i = 0; i < a.length; i += 7) h = hash32(h ^ (a[i] * 131 + i));
  });
  return h;
};

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
  const tree = a.trees.find((t) => ['oak', 'pine', 'birch'].includes(t.kind) && [0.5, 1, 1.5, 2].every((d) => [-1, 0, 1].every((e) => Math.abs(a.surfaceY(t.x - d, t.z + e) - t.y) < 0.4)));
  if (tree) {
    const q = new Player(a);
    q.place(tree.x - 2, a.surfaceY(tree.x - 2, tree.z) + 0.05, tree.z);
    q.yaw = -Math.PI / 2;
    // how near the body ever came to the bark, at its own height, walking at it for two seconds
    let gap = Infinity;
    for (let i = 0; i < 120; i++) {
      q.update(1 / 60, { x: 0, z: 1, jump: false });
      for (const s of tree.segs.filter((s) => s.trunk))
        for (let h = q.y + 0.3; h <= q.y + 1.6; h += 0.1) {
          const f = (h - s.a[1]) / (s.b[1] - s.a[1]);
          if (f < 0 || f > 1) continue;
          gap = Math.min(gap, Math.hypot(q.x - (s.a[0] + (s.b[0] - s.a[0]) * f), q.z - (s.a[2] + (s.b[2] - s.a[2]) * f)) - s.r);
        }
    }
    check(gap > 0.25 && gap < 0.4, `${name}: a ${tree.kind} trunk keeps the player out (at least ${gap.toFixed(2)} m from the bark)`);
  }

  // the same walk at 20 and at 144 frames a second ends in the same place (the physics steps are fixed)
  const walk = (fps) => {
    const r = new Player(a);
    let acc = 0;
    for (let f = 0; f < fps * 2; f++) {
      acc += 1 / fps;
      while (acc >= 1 / 60) {
        r.update(1 / 60, { x: 0.3, z: 1, jump: f === 5 });
        acc -= 1 / 60;
      }
    }
    return [r.x, r.y, r.z];
  };
  const [w20, w144] = [walk(20), walk(144)];
  check(Math.hypot(w20[0] - w144[0], w20[1] - w144[1], w20[2] - w144[2]) < 0.2, `${name}: walking ends in the same place at 20 and 144 fps`);

  // digging under the player's feet takes ground away; building puts it back
  const [gx, gy, gz] = [p.x, p.y - 0.4, p.z];
  const took = a.brush(gx, gy, gz, 1.25, false);
  check(took.size > 0 && !a.solid(gx, gy, gz), `${name}: digging takes ground away`);
  a.brush(gx, gy, gz, 1.1, true, 4);
  check(a.solid(gx, gy, gz), `${name}: building puts ground back`);
}
// slopes, on a made-up field: ground flatter than 50° is stood on, steeper ground is slid down
for (const [deg, stays] of [
  [25, true],
  [40, true],
  [62, false],
]) {
  const f = new World(1);
  const k = Math.tan((deg * Math.PI) / 180);
  f.uni.fill(-124); // air, but for a patch round the middle
  for (let k2 = 120; k2 < 200; k2++)
    for (let i = 120; i < 200; i++)
      for (let j = 0; j < NY; j++) f.set(i, j, k2, (20 + (i * VOX - 80) * k - j * VOX) / Math.hypot(1, k), 4);
  f.spawn = [80.5, 20.6 + 0.5 * k, 80.5];
  const s = new Player(f);
  for (let i = 0; i < 180; i++) s.update(1 / 60, { x: 0, z: 0, jump: false });
  const moved = Math.hypot(s.x - 80.5, s.z - 80.5);
  check(stays ? moved < 0.15 && s.onGround : moved > 0.5, `a ${deg}° slope ${stays ? 'is stood on' : 'is slid down'} (moved ${moved.toFixed(2)} m)`);
}
// the worker's job: an island grown, every chunk meshed, then meshed again where it is dug, the same as the page's copy
{
  const { createJob } = await import('../src/worldjob.js');
  const got = [];
  const job = createJob((m) => got.push(m));
  const seed = seedOf('nebel-bucht-7');
  const t0 = performance.now();
  job({ type: 'grow', gen: 1, seed, ops: [['d', 80, 18, 80, 1.25]], trees: [[3, 'gone'], [5, 'active']], focus: null });
  const world = got.find((m) => m.type === 'world');
  const grounds = got.filter((m) => m.type === 'ground').length,
    treeMeshes = got.filter((m) => m.type === 'trees').length;
  check(world && grounds === 100 && treeMeshes === 100, `the worker grows an island and meshes all 100 chunks (${(performance.now() - t0).toFixed(0)} ms)`);
  const page = new World(seed);
  page.generate();
  page.brush(80, 18, 80, 1.25, false);
  const sent = new World(seed);
  sent.unpack(world.pack);
  check(digest(page) === digest(sent) && world.trees[3].state === 'gone' && world.trees[5].state === 'active', 'the worker sends the same world the page would grow, with the saved changes');
  got.length = 0;
  job({ type: 'brush', gen: 1, x: 40, y: 15, z: 40, r: 1.25, add: false, chunks: [[2, 2]] });
  job({ type: 'brush', gen: 0, x: 40, y: 15, z: 40, r: 1.25, add: false, chunks: [[2, 2]] });
  check(got.length === 1 && got[0].type === 'ground' && got[0].cx === 2, 'a dig is meshed again by the worker; one for an old island is ignored');
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
