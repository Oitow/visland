// The island's heavy work, away from the page: growing it, meshing its ground and its trees, and meshing again
// wherever it is dug or built or a tree is felled. It runs in a worker (worker.js), so the game never stutters while
// it works; the page keeps its own copy of the world (for walking and digging) and sends every change here too, so
// both copies stay the same.
//
// Messages in:  grow {gen, seed, ops, trees, focus}  ·  brush {gen, x, y, z, r, add, mat, chunks}  ·  tree {gen, id, state, cutY}
// Messages out: world {gen, density, mat, heights, trees, crystals, spawn}  ·  ground {gen, cx, cz, mesh}  ·  trees {gen, cx, cz, wood, leaves}
import { World, SIZE, CHUNK } from './world.js';
import { meshChunk } from './surfacenets.js';
import { treesGeometry } from './flora.js';

const buffers = (arrays) => (arrays ? Object.values(arrays).filter((v) => v?.buffer).map((v) => v.buffer) : []);

/** @param {function(object, ArrayBuffer[]): void} post sends a message (and hands over the buffers it lists) */
export function createJob(post) {
  let world = null,
    gen = 0;
  const treesIn = new Map();

  const ground = (cx, cz) => {
    if (cx < 0 || cz < 0 || cx >= SIZE / CHUNK || cz >= SIZE / CHUNK) return;
    const mesh = meshChunk(world, cx, cz);
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
      const density = world.density.slice(),
        mat = world.mat.slice(),
        heights = world.heights.slice();
      post({ type: 'world', gen, density, mat, heights, trees: world.trees, crystals: world.crystals, spawn: world.spawn }, [density.buffer, mat.buffer, heights.buffer]);
      // then every chunk, those nearest the player first, so the island fills in from where they stand
      const [fx, , fz] = m.focus || world.spawn;
      const order = [];
      for (let cz = 0; cz < SIZE / CHUNK; cz++) for (let cx = 0; cx < SIZE / CHUNK; cx++) order.push([cx, cz, Math.hypot((cx + 0.5) * CHUNK - fx, (cz + 0.5) * CHUNK - fz)]);
      order.sort((a, b) => a[2] - b[2]);
      for (const [cx, cz] of order) {
        ground(cx, cz);
        trees(cx, cz);
      }
    } else if (!world || m.gen !== gen) {
      // a message for an island that is no longer there
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
