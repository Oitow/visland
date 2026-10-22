// Surface Nets: the smooth mesh of the ground. In every cell of the grid that the surface passes through (its corners
// not all solid or all air) one vertex is put, at the average of where the surface crosses the cell's edges; then
// for every edge the surface crosses, the four cells round that edge are joined into a quad. The result is a smooth
// skin, with normals from the field's slope, colours blended between materials, and shade where little light gets in.
// After S. F. F. Gibson, "Constrained elastic surface nets" (1998), as popularised by Mikola Lysenko's
// "Smooth voxel terrain" (0fps.net, 2012).
import { valueNoise } from '../vendor/almanac/noise.js';
import { hexToRgb, mixColour } from '../vendor/almanac/colour.js';
import { latticeRandom } from '../vendor/almanac/noise.js';
import { SIZE, HEIGHT, CHUNK, WATER_Y } from './world.js';
import { MATERIALS, GRASS, DRYGRASS } from './materials.js';

// the twelve edges of a cell, as pairs of its corners (corner k is at x = k & 1, y = (k >> 1) & 1, z = k >> 2)
const EDGES = [];
for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) if (!(a & bit)) EDGES.push([a, a | bit]);

const COLORS = {};
for (const [id, m] of Object.entries(MATERIALS)) COLORS[id] = { flat: hexToRgb(m.color).map((v) => v / 255), steep: hexToRgb(m.steep).map((v) => v / 255), grain: m.grain };

/**
 * The mesh of one chunk of the ground, as plain arrays for a BufferGeometry, and where grass tufts may grow on it.
 * @param {import('./world.js').World} world
 */
export function meshChunk(world, cx, cz) {
  const x0 = cx * CHUNK,
    z0 = cz * CHUNK,
    N = CHUNK + 1;
  // how high the ground's surface is over each column (anything well under it sees little of the sky)
  const surf = new Float32Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) surf[z * N + x] = world.surfaceY(x0 - 1 + x, z0 - 1 + z);
  const skyAt = (x, y, z) => {
    const s = surf[(Math.min(N - 1, Math.max(0, Math.round(z) - z0 + 1))) * N + Math.min(N - 1, Math.max(0, Math.round(x) - x0 + 1))];
    return Math.max(0.12, Math.min(1, 1 - (s - y - 1.2) / 4));
  };

  const cellVertex = new Int32Array(N * N * HEIGHT).fill(-1);
  const cell = (x, y, z) => (y * N + (z - z0 + 1)) * N + (x - x0 + 1);
  const pos = [],
    nor = [],
    col = [],
    light = [],
    index = [],
    tufts = [];
  const d = new Float32Array(8);

  // 1. a vertex in every cell the surface passes through
  for (let y = 0; y < HEIGHT - 1; y++)
    for (let z = z0 - 1; z < z0 + CHUNK; z++)
      for (let x = x0 - 1; x < x0 + CHUNK; x++) {
        let inside = 0;
        for (let k = 0; k < 8; k++) {
          d[k] = world.d(x + (k & 1), y + ((k >> 1) & 1), z + (k >> 2));
          if (d[k] > 0) inside |= 1 << k;
        }
        if (inside === 0 || inside === 255) continue;
        let px = 0,
          py = 0,
          pz = 0,
          n = 0;
        for (const [a, b] of EDGES) {
          if (d[a] > 0 === d[b] > 0) continue;
          const t = d[a] / (d[a] - d[b]);
          px += (a & 1) + t * ((b & 1) - (a & 1));
          py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          pz += (a >> 2) + t * ((b >> 2) - (a >> 2));
          n++;
        }
        const vx = x + px / n,
          vy = y + py / n,
          vz = z + pz / n;
        // the normal points down the field's slope (out of the ground)
        const e = 0.5;
        let gx = world.sample(vx - e, vy, vz) - world.sample(vx + e, vy, vz),
          gy = world.sample(vx, vy - e, vz) - world.sample(vx, vy + e, vz),
          gz = world.sample(vx, vy, vz - e) - world.sample(vx, vy, vz + e);
        const gl = Math.hypot(gx, gy, gz) || 1;
        gx /= gl;
        gy /= gl;
        gz /= gl;
        // the material: that of the solid corner nearest the surface
        let best = 9,
          mat = 4;
        for (let k = 0; k < 8; k++)
          if (d[k] > 0 && d[k] < best) {
            best = d[k];
            mat = world.m(x + (k & 1), y + ((k >> 1) & 1), z + (k >> 2));
          }
        const c = COLORS[mat] || COLORS[4];
        let rgb = mixColour(c.steep, c.flat, smooth(0.55, 0.8, gy));
        if (mat === GRASS || mat === DRYGRASS) {
          // meadows vary a little in hue from place to place
          const v = valueNoise(vx / 14, vz / 14, 91) - 0.5;
          rgb = [rgb[0] * (1 + v * 0.35), rgb[1] * (1 + v * 0.12), rgb[2] * (1 - v * 0.2)];
          if (gy > 0.82 && vy > WATER_Y + 0.2 && latticeRandom(x, z, y + 17) < 0.55) tufts.push([vx, vy, vz, mat, v]);
        }
        // ambient occlusion: how much of the field round the vertex is open air
        const o1 = -world.sample(vx + gx * 1.4, vy + gy * 1.4, vz + gz * 1.4) / 1.4,
          o2 = -world.sample(vx + gx * 3, vy + gy * 3, vz + gz * 3) / 3;
        const ao = 0.4 + 0.6 * Math.max(0, Math.min(1, (o1 + o2) * 0.5));
        cellVertex[cell(x, y, z)] = pos.length / 3;
        pos.push(vx, vy, vz);
        nor.push(gx, gy, gz);
        col.push(...rgb);
        light.push(ao, skyAt(vx, vy, vz), c.grain);
      }

  // 2. a quad across every edge the surface crosses, from the four cells round it, facing out of the ground
  const quad = (a, b, c, e, flip) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return;
    if (flip) index.push(a, e, c, a, c, b);
    else index.push(a, b, c, a, c, e);
  };
  for (let y = 1; y < HEIGHT - 1; y++)
    for (let z = z0; z < z0 + CHUNK; z++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        const here = world.d(x, y, z) > 0;
        if (here !== world.d(x + 1, y, z) > 0)
          quad(cellVertex[cell(x, y - 1, z)], cellVertex[cell(x, y - 1, z - 1)], cellVertex[cell(x, y, z - 1)], cellVertex[cell(x, y, z)], !here);
        if (here !== world.d(x, y + 1, z) > 0)
          quad(cellVertex[cell(x - 1, y, z)], cellVertex[cell(x, y, z)], cellVertex[cell(x, y, z - 1)], cellVertex[cell(x - 1, y, z - 1)], !here);
        if (here !== world.d(x, y, z + 1) > 0)
          quad(cellVertex[cell(x - 1, y - 1, z)], cellVertex[cell(x, y - 1, z)], cellVertex[cell(x, y, z)], cellVertex[cell(x - 1, y, z)], !here);
      }

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    color: new Float32Array(col),
    light: new Float32Array(light),
    index: new Uint32Array(index),
    tufts,
  };
}

const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
