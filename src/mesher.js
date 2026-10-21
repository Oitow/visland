// Turns a chunk of blocks into a mesh: only the faces that touch something see-through are kept, each corner is
// darkened by the blocks around it (ambient occlusion) and warmed by lanterns nearby.
import { BLOCKS, AIR, isOpaque } from './blocks.js';
import { SIZE, HEIGHT, CHUNK } from './world.js';
import { COLS, ROWS } from './textures.js';

// the six faces: normal, four corners counter-clockwise seen from outside (bottom-left, bottom-right, top-right,
// top-left), which tile of the block they use (0 top, 1 side, 2 bottom), and their own shade
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], tile: 1, shade: 0.82 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], tile: 1, shade: 0.82 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], tile: 0, shade: 1 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], tile: 2, shade: 0.6 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], tile: 1, shade: 0.72 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], tile: 1, shade: 0.72 },
];
const UVS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const AO = [0.45, 0.65, 0.82, 1];

// for each face and corner: the three neighbours (two sides and the corner) in front of the face that shade it
for (const f of FACES) {
  const axis = f.n.findIndex((v) => v !== 0),
    tang = [0, 1, 2].filter((a) => a !== axis);
  f.ao = f.c.map((corner) => {
    const s1 = [...f.n],
      s2 = [...f.n];
    s1[tang[0]] += corner[tang[0]] ? 1 : -1;
    s2[tang[1]] += corner[tang[1]] ? 1 : -1;
    const k = [...f.n];
    k[tang[0]] += corner[tang[0]] ? 1 : -1;
    k[tang[1]] += corner[tang[1]] ? 1 : -1;
    return [s1, s2, k];
  });
}

const tileUV = (tile) => {
  // a small inset keeps neighbouring tiles from bleeding in at the edges
  const e = 0.02,
    u0 = (tile % COLS) / COLS,
    v1 = 1 - Math.floor(tile / COLS) / ROWS;
  return [u0 + e / COLS, v1 - 1 / ROWS + e / ROWS, 1 / COLS - (2 * e) / COLS, 1 / ROWS - (2 * e) / ROWS];
};

// whether the face of block b toward its neighbour nb shows
const faceShows = (b, nb) => nb === AIR || (BLOCKS[nb].see && nb !== b);

/**
 * The mesh of one chunk, as plain arrays for a BufferGeometry.
 * @returns {{position: Float32Array, normal: Float32Array, uv: Float32Array, light: Float32Array, index: Uint32Array}}
 */
export function meshChunk(world, cx, cz) {
  const x0 = cx * CHUNK,
    z0 = cz * CHUNK;
  const pos = [],
    nor = [],
    uv = [],
    light = [],
    index = [];
  // the lights near enough to reach this chunk
  const lamps = [];
  for (const [i, r] of world.lights) {
    const lx = i % SIZE,
      lz = Math.floor(i / SIZE) % SIZE,
      ly = Math.floor(i / (SIZE * SIZE));
    if (lx >= x0 - r && lx < x0 + CHUNK + r && lz >= z0 - r && lz < z0 + CHUNK + r) lamps.push([lx + 0.5, ly + 0.5, lz + 0.5, r]);
  }
  const glowAt = (x, y, z) => {
    let g = 0;
    for (const [lx, ly, lz, r] of lamps) {
      const d = Math.hypot(x - lx, y - ly, z - lz);
      if (d < r) g += (1 - d / r) * (1 - d / r);
    }
    return Math.min(1.3, g);
  };
  const get = (x, y, z) => world.get(x, y, z);

  for (let y = 0; y < HEIGHT; y++)
    for (let z = z0; z < z0 + CHUNK; z++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        const b = get(x, y, z);
        if (b === AIR) continue;
        const def = BLOCKS[b];
        for (const f of FACES) {
          if (!faceShows(b, get(x + f.n[0], y + f.n[1], z + f.n[2]))) continue;
          const [u0, v0, du, dv] = tileUV(def.tiles[f.tile]);
          const base = pos.length / 3;
          const ao = [];
          for (let k = 0; k < 4; k++) {
            const c = f.c[k];
            const [s1, s2, cc] = f.ao[k];
            const o1 = isOpaque(get(x + s1[0], y + s1[1], z + s1[2])) ? 1 : 0,
              o2 = isOpaque(get(x + s2[0], y + s2[1], z + s2[2])) ? 1 : 0,
              o3 = isOpaque(get(x + cc[0], y + cc[1], z + cc[2])) ? 1 : 0;
            const a = def.emit ? 3 : o1 && o2 ? 0 : 3 - (o1 + o2 + o3);
            ao.push(a);
            const px = x + c[0],
              py = y + c[1],
              pz = z + c[2];
            pos.push(px, py, pz);
            nor.push(f.n[0], f.n[1], f.n[2]);
            uv.push(u0 + UVS[k][0] * du, v0 + UVS[k][1] * dv);
            light.push(AO[a] * f.shade, glowAt(px + f.n[0] * 0.5, py + f.n[1] * 0.5, pz + f.n[2] * 0.5), def.emit || 0);
          }
          // split the quad along the diagonal that keeps the shading smooth
          if (ao[0] + ao[2] >= ao[1] + ao[3]) index.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else index.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        }
      }
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    uv: new Float32Array(uv),
    light: new Float32Array(light),
    index: new Uint32Array(index),
  };
}
