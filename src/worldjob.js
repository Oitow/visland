// The island's heavy work, away from the page: growing it, meshing its ground and its trees, and meshing again
// wherever it is dug or built or a tree is felled. It runs in a worker (worker.js), so the game never stutters while
// it works; the page keeps its own copy of the world (for walking and digging) and sends every change here too, so
// both copies stay the same.
//
// Messages in:  grow {gen, seed, ops, trees, focus}  ·  brush {gen, x, y, z, r, add, mat, chunks}  ·  tree {gen, id, state, cutY}
//                focus {gen, x, z}: where the player is, so chunks near them are meshed finely and far ones coarsely
// Messages out: world {gen, pack, trees, crystals, spawn}  ·  ground {gen, cx, cz, mesh}  ·  trees {gen, cx, cz, wood, leaves}
import { World, SIZE, CHUNK } from './world.js';
import { meshChunk } from './surfacenets.js';
import { treesGeometry } from './flora.js';

const buffers = (arrays) => (arrays ? Object.values(arrays).filter((v) => v?.buffer).map((v) => v.buffer) : []);

/** @param {function(object, ArrayBuffer[]): void} post sends a message (and hands over the buffers it lists) */
export function createJob(post) {
  let world = null,
    gen = 0,
    focus = [SIZE / 2, SIZE / 2];
  const treesIn = new Map();
  const stride = new Map(); // how finely each chunk is meshed now: 1 near the player, 2 far off
  const NEAR = 36,
    FAR = 44; // (between the two a chunk keeps what it has, so it does not flicker back and forth)
  const want = (cx, cz) => {
    const dist = Math.hypot((cx + 0.5) * CHUNK - focus[0], (cz + 0.5) * CHUNK - focus[1]);
    const now = stride.get(cx + ',' + cz);
    return dist < NEAR ? 1 : dist > FAR ? 2 : now || 1;
  };

  const ground = (cx, cz) => {
    if (cx < 0 || cz < 0 || cx >= SIZE / CHUNK || cz >= SIZE / CHUNK) return;
    const s = want(cx, cz);
    stride.set(cx + ',' + cz, s);
    const mesh = meshChunk(world, cx, cz, s);
    post({ type: 'ground', gen, cx, cz, mesh }, buffers(mesh));
  };
  const trees = (cx, cz) => {
    const { wood, leaves } = treesGeometry(treesIn.get(cx + ',' + cz) || []);
    post({ type: 'trees', gen, cx, cz, wood, leaves }, [...buffers(wood), ...buffers(leaves)]);
  };

  return function handle(m) {
    if (m.type === 'grow') {
      gen = m.gen;
      world = new World(m.seed);
      world.generate();
      // the player's changes, laid again over the island as it grew
      for (const [kind, x, y, z, r, mat] of m.ops) world.brush(x, y, z, r, kind === 'b', mat);
      for (const e of m.trees) {
        const [id, state] = Array.isArray(e) ? e : [e, 'gone']; // an older save lists only trees that are gone
        if (world.trees[id]) Object.assign(world.trees[id], { state, cutY: world.trees[id].y + 0.55 });
      }
      treesIn.clear();
      for (const t of world.trees) {
        const k = Math.floor(t.x / CHUNK) + ',' + Math.floor(t.z / CHUNK);
        if (!treesIn.has(k)) treesIn.set(k, []);
        treesIn.get(k).push(t);
      }
      // the page gets a copy of the world to walk on; this one stays here for meshing
      const pack = world.copy();
      const buf = [...pack.dense, ...pack.mdense].filter(Boolean).map((a) => a.buffer);
      post({ type: 'world', gen, pack, trees: world.trees, crystals: world.crystals, spawn: world.spawn }, [...buf, pack.heights.buffer]);
      // then every chunk, those nearest the player first, so the island fills in from where they stand
      const [fx, , fz] = m.focus || world.spawn;
      focus = [fx, fz];
      stride.clear();
      const order = [];
      for (let cz = 0; cz < SIZE / CHUNK; cz++) for (let cx = 0; cx < SIZE / CHUNK; cx++) order.push([cx, cz, Math.hypot((cx + 0.5) * CHUNK - fx, (cz + 0.5) * CHUNK - fz)]);
      order.sort((a, b) => a[2] - b[2]);
      for (const [cx, cz] of order) {
        ground(cx, cz);
        trees(cx, cz);
      }
    } else if (!world || m.gen !== gen) {
      // a message for an island that is no longer there
    } else if (m.type === 'focus') {
      // the player moved: chunks that came near are meshed finely, those left behind coarsely
      focus = [m.x, m.z];
      const order = [...stride.keys()].map((k) => k.split(',').map(Number)).filter(([cx, cz]) => want(cx, cz) !== stride.get(cx + ',' + cz));
      order.sort((a, b) => Math.hypot(a[0] * CHUNK - m.x, a[1] * CHUNK - m.z) - Math.hypot(b[0] * CHUNK - m.x, b[1] * CHUNK - m.z));
      for (const [cx, cz] of order) ground(cx, cz);
    } else if (m.type === 'brush') {
      world.brush(m.x, m.y, m.z, m.r, m.add, m.mat);
      for (const [cx, cz] of m.chunks) ground(cx, cz);
    } else if (m.type === 'tree') {
      const t = world.trees[m.id];
      if (!t) return;
      t.state = m.state;
      if (m.cutY !== undefined) t.cutY = m.cutY;
      trees(Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK));
    }
  };
}
