// The world: a field of numbers grown from a seed. Each point of a grid holds how solid it is (above 0 inside the
// ground, below 0 in the air, about the distance to the surface) and what it is made of. The surface is where the
// field crosses 0; surfacenets.js turns it into a smooth mesh, and digging just lowers the field in a ball.
// The island's shape, river, trees and crystals come from the procedural almanac (vendor/almanac).
import { islandHeight, windingRiver } from '../vendor/almanac/land.js';
import { fractalNoise, ridgedNoise, valueNoise, latticeRandom } from '../vendor/almanac/noise.js';
import { SeededRandom, hash32 } from '../vendor/almanac/random.js';
import { smoothstep, lerp } from '../vendor/almanac/numbers.js';
import { growTree, growBush } from './trees.js';
import { valueNoise3 } from './noise3.js';
import { SAND, GRASS, DIRT, STONE, SNOW, DRYGRASS, GRAVEL } from './materials.js';

export const SIZE = 160; // metres across (x and z)
export const HEIGHT = 64; // metres up (y)
export const VOX = 0.5; // metres between two points of the grid
export const NX = SIZE / VOX; // points across
export const NY = HEIGHT / VOX; // points up
export const SEA = 12;
export const WATER_Y = 12.6; // the water's surface
export const CHUNK = 16; // metres across one mesh
export const CRYSTALS = 8; // crystals hidden on each island
const LIMIT = 3.9; // the field is kept within ±3.9 m: only its value near the surface matters
const Q = 32; // the field is stored in steps of 1/32 m, one byte a point

// The grid is stored in blocks of 16 points each way (8 m). A block that is all one thing (all air, or solid rock
// deep down) is kept as one number; only blocks the surface runs through hold all their points.
export const B = 16;
export const BX = NX / B,
  BY = NY / B;

export class World {
  constructor(seed) {
    this.seed = seed;
    this.dense = new Array(BX * BY * BX).fill(null); // per block: Int8Array of its field, or null when it is one value
    this.uni = new Int8Array(BX * BY * BX); // that one value
    this.mdense = new Array(BX * BY * BX).fill(null); // the same for materials
    this.muni = new Uint8Array(BX * BY * BX);
    this.heights = new Float32Array(NX * NX); // the land's height (m) per column of points, as it grew
    this.trees = [];
    this.crystals = [];
    this.lanterns = [];
    this.spawn = [SIZE / 2, 30, SIZE / 2];
  }

  // the field at a point of the grid (whole numbers), in metres: solid under the world, air beyond its edges
  d(i, j, k) {
    if (j < 0) return LIMIT;
    if (i < 0 || k < 0 || i >= NX || k >= NX || j >= NY) return -LIMIT;
    const b = ((j >> 4) * BX + (k >> 4)) * BX + (i >> 4),
      a = this.dense[b];
    return (a ? a[(((j & 15) << 4) + (k & 15)) * 16 + (i & 15)] : this.uni[b]) / Q;
  }

  m(i, j, k) {
    if (i < 0 || k < 0 || i >= NX || k >= NX || j < 0 || j >= NY) return STONE;
    const b = ((j >> 4) * BX + (k >> 4)) * BX + (i >> 4),
      a = this.mdense[b];
    return a ? a[(((j & 15) << 4) + (k & 15)) * 16 + (i & 15)] : this.muni[b];
  }

  // write a point (blocks that were one value get all their points first)
  set(i, j, k, dm, mat) {
    const b = ((j >> 4) * BX + (k >> 4)) * BX + (i >> 4),
      l = (((j & 15) << 4) + (k & 15)) * 16 + (i & 15);
    if (!this.dense[b]) this.dense[b] = new Int8Array(4096).fill(this.uni[b]);
    this.dense[b][l] = Math.round(Math.max(-LIMIT, Math.min(LIMIT, dm)) * Q);
    if (mat !== undefined) {
      if (!this.mdense[b]) this.mdense[b] = new Uint8Array(4096).fill(this.muni[b]);
      this.mdense[b][l] = mat;
    }
  }

  // a block that turns out all one value is kept as that value
  compact(b) {
    for (const [dense, uni] of [
      [this.dense, this.uni],
      [this.mdense, this.muni],
    ]) {
      const a = dense[b];
      if (a && a.every((v) => v === a[0])) {
        uni[b] = a[0];
        dense[b] = null;
      }
    }
  }

  // the field anywhere (metres in, metres out), blended from the eight points round it
  sample(x, y, z) {
    const gx = x / VOX,
      gy = y / VOX,
      gz = z / VOX;
    const xi = Math.floor(gx),
      yi = Math.floor(gy),
      zi = Math.floor(gz);
    const u = gx - xi,
      v = gy - yi,
      w = gz - zi;
    const a = lerp(this.d(xi, yi, zi), this.d(xi + 1, yi, zi), u),
      b = lerp(this.d(xi, yi + 1, zi), this.d(xi + 1, yi + 1, zi), u),
      c = lerp(this.d(xi, yi, zi + 1), this.d(xi + 1, yi, zi + 1), u),
      e = lerp(this.d(xi, yi + 1, zi + 1), this.d(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(a, b, v), lerp(c, e, v), w);
  }

  solid(x, y, z) {
    return this.sample(x, y, z) > 0;
  }

  // what the ground is made of nearest a place (metres)
  matAt(x, y, z) {
    return this.m(Math.round(x / VOX), Math.round(y / VOX), Math.round(z / VOX));
  }

  heightAt(x, z) {
    const i = Math.max(0, Math.min(NX - 1, Math.round(x / VOX))),
      k = Math.max(0, Math.min(NX - 1, Math.round(z / VOX)));
    return this.heights[k * NX + i];
  }

  // the highest surface in a column (where the field last crosses 0, coming down), and the highest under the water
  surfaceY(x, z, from = HEIGHT - VOX) {
    const i = Math.max(0, Math.min(NX - 1, Math.round(x / VOX))),
      k = Math.max(0, Math.min(NX - 1, Math.round(z / VOX)));
    for (let j = Math.floor(from / VOX); j >= 0; j--) {
      const a = this.d(i, j, k);
      if (a > 0) {
        const b = this.d(i, j + 1, k);
        return (j + (b > 0 ? 1 : a / (a - b))) * VOX;
      }
    }
    return 0;
  }

  floorY(x, z) {
    const y = this.surfaceY(x, z, WATER_Y);
    return y > 0 ? y : -1;
  }

  /**
   * Change the ground in a ball (metres): dig it away, or heap material on.
   * @returns {Map<number, number>} for digging, how much of each material went (in points)
   */
  brush(cx, cy, cz, r, add, material) {
    const took = new Map();
    const R = Math.ceil((r + 1) / VOX);
    const ci = Math.round(cx / VOX),
      cj = Math.round(cy / VOX),
      ck = Math.round(cz / VOX);
    const touched = new Set();
    for (let j = Math.max(0, cj - R); j <= Math.min(NY - 1, cj + R); j++)
      for (let k = Math.max(0, ck - R); k <= Math.min(NX - 1, ck + R); k++)
        for (let i = Math.max(0, ci - R); i <= Math.min(NX - 1, ci + R); i++) {
          const dist = Math.hypot(i * VOX - cx, j * VOX - cy, k * VOX - cz),
            old = this.d(i, j, k);
          if (add) {
            const v = Math.min(LIMIT, r - dist);
            if (v > old + 0.01) this.set(i, j, k, v, old <= 0.25 ? material : undefined); // the new surface is the new stuff
          } else {
            if (j <= 2) continue; // the island's floor stays
            const v = Math.max(-LIMIT, dist - r);
            if (v < old - 0.01) {
              if (old > 0 && v <= 0) {
                const m = this.m(i, j, k);
                took.set(m, (took.get(m) || 0) + 1);
              }
              this.set(i, j, k, v);
            }
          }
          touched.add(((j >> 4) * BX + (k >> 4)) * BX + (i >> 4));
        }
    for (const b of touched) this.compact(b);
    return took;
  }

  // everything that must travel between threads (the worker grows; the page walks)
  pack() {
    return { dense: this.dense, uni: this.uni, mdense: this.mdense, muni: this.muni, heights: this.heights };
  }
  unpack(p) {
    Object.assign(this, p);
  }
  buffers() {
    return [...this.dense, ...this.mdense].filter(Boolean).map((a) => a.buffer);
  }
  copy() {
    const c = (list) => list.map((a) => a && a.slice());
    return { dense: c(this.dense), uni: this.uni.slice(), mdense: c(this.mdense), muni: this.muni.slice(), heights: this.heights.slice() };
  }

  // the lights that warm the ground at night: lanterns, and crystals not yet found
  lights() {
    return [
      ...this.lanterns.map(([x, y, z]) => [x, y + 0.6, z, 8]),
      ...this.crystals.filter((c) => !c.found).map((c) => [c.x, c.y + 0.5, c.z, 4]),
    ];
  }

  generate() {
    const s = this.seed % 9973;

    // 1. the land's height: an island from the almanac, mountains of ridged noise in its middle, a river through it
    for (let k = 0; k < NX; k++)
      for (let i = 0; i < NX; i++) {
        const x = i * VOX,
          z = k * VOX;
        const e = islandHeight(x, z, SIZE, s);
        const ridge = ridgedNoise(x / 40, z / 40, s + 11, 4);
        const m = smoothstep(0.4, 0.85, e);
        let h = 3 + e * 24 + m * m * ridge * 24;
        const river = windingRiver(x * 2.4, z * 2.4, s + 5, 0.18);
        if (h > SEA - 1 && river.depth > -2) {
          // the banks slope down to the river, which runs at the sea's level
          const bank = smoothstep(-2, 0, river.depth);
          h = lerp(h, Math.min(h, SEA + 1.2), bank * bank);
          if (river.depth > 0) h = Math.min(h, SEA - 0.5 - river.depth * 2);
        }
        this.heights[k * NX + i] = Math.max(1.5, Math.min(HEIGHT - 12, h));
      }

    // 2. the ground, block by block: what each column is made of, the field from its height, caves through it
    const top = new Uint8Array(NX * NX),
      under = new Uint8Array(NX * NX);
    for (let k = 0; k < NX; k++)
      for (let i = 0; i < NX; i++) {
        const x = i * VOX,
          z = k * VOX,
          col = k * NX + i,
          h = this.heights[col];
        const moist = fractalNoise(x / 45, z / 45, s + 3, 3);
        const snowLine = SEA + 24 + valueNoise(x / 12, z / 12, s + 4) * 5;
        let t, u;
        if (h < WATER_Y - 0.4) {
          t = u = h >= SEA - 4 || valueNoise(x / 9, z / 9, s + 6) > 0.55 ? SAND : GRAVEL;
        } else if (h < WATER_Y + 1.3 + latticeRandom(Math.floor(x / 2), Math.floor(z / 2), s + 7) * 0.8) {
          t = u = SAND;
        } else if (h >= snowLine) {
          t = SNOW;
          u = STONE;
        } else if (h > SEA + 21) {
          t = u = STONE;
        } else {
          t = moist < 0.42 ? DRYGRASS : GRASS;
          u = DIRT;
        }
        top[col] = t;
        under[col] = u;
      }
    for (let bj = 0; bj < BY; bj++)
      for (let bk = 0; bk < BX; bk++)
        for (let bi = 0; bi < BX; bi++) {
          const b = (bj * BX + bk) * BX + bi;
          // a block wholly above the land is air (and its material nothing): no need to work it out point by point
          let maxH = 0;
          for (let lk = 0; lk < 16; lk++) for (let li = 0; li < 16; li++) maxH = Math.max(maxH, this.heights[(bk * 16 + lk) * NX + bi * 16 + li]);
          if (bj * 16 * VOX > maxH + LIMIT + 1) {
            this.uni[b] = -LIMIT * Q;
            continue;
          }
          const dd = new Int8Array(4096),
            mm = new Uint8Array(4096);
          for (let lj = 0; lj < 16; lj++)
            for (let lk = 0; lk < 16; lk++)
              for (let li = 0; li < 16; li++) {
                const i = bi * 16 + li,
                  j = bj * 16 + lj,
                  k = bk * 16 + lk;
                const col = k * NX + i,
                  h = this.heights[col],
                  y = j * VOX;
                let d = h - y;
                // caves: tunnels where two 3D noises both pass their middle (two surfaces crossing make a line), only
                // under land that stands well above the sea
                const caves = smoothstep(WATER_Y + 1, WATER_Y + 5, h);
                if (caves > 0 && y >= 3 && y < h + 1) {
                  const x = i * VOX,
                    z = k * VOX;
                  const a = valueNoise3(x / 16, y / 9, z / 16, s + 50),
                    c = valueNoise3(x / 16, y / 9, z / 16, s + 61);
                  d = Math.min(d, (Math.abs(a - 0.5) + Math.abs(c - 0.5) - 0.07) * 28 + (1 - caves) * 10);
                }
                if (j <= 1) d = Math.max(d, 1);
                const l = ((lj << 4) + lk) * 16 + li;
                dd[l] = Math.round(Math.max(-LIMIT, Math.min(LIMIT, d)) * Q);
                const depth = h - y;
                mm[l] = d <= -0.5 ? 0 : depth < 1.3 ? top[col] : depth < 4 ? under[col] : STONE;
              }
          this.dense[b] = dd;
          this.mdense[b] = mm;
          this.compact(b);
        }

    // 3. trees, one at most in each 4 x 4 cell, the kind by where it stands; bushes between them
    const forest = (x, z) => fractalNoise(x / 38, z / 38, s + 20, 3);
    const plant = (kind, x, y, z, rng) => {
      const t = kind === 'bush' ? growBush([x, y - 0.15, z], rng) : growTree(kind, [x, y - 0.15, z], rng, s + 70);
      t.id = this.trees.length;
      t.state = 'standing';
      this.trees.push(t);
    };
    for (let cz = 1; cz < SIZE / 4 - 1; cz++)
      for (let cx = 1; cx < SIZE / 4 - 1; cx++) {
        const x = cx * 4 + Math.floor(latticeRandom(cx, cz, s + 21) * 4),
          z = cz * 4 + Math.floor(latticeRandom(cx, cz, s + 22) * 4);
        const y = this.surfaceY(x, z);
        if (Math.abs(y - this.heightAt(x, z)) > 0.6) continue; // over a cave mouth
        const top = this.matAt(x, y - 0.3, z),
          roll = latticeRandom(cx, cz, s + 23);
        const rng = new SeededRandom(hash32(x * 7919 + z * 104729 + s));
        if (top === GRASS) {
          if (y > SEA + 14) {
            if (roll < 0.45) plant('pine', x, y, z, rng);
          } else if (roll < 0.05 + 0.6 * smoothstep(0.48, 0.7, forest(x, z))) plant(valueNoise(x / 26, z / 26, s + 30) > 0.62 ? 'birch' : 'oak', x, y, z, rng);
          else if (roll > 0.82) plant('bush', x + 2, this.surfaceY(x + 2, z + 1), z + 1, rng);
        } else if (top === DRYGRASS) {
          if (roll < 0.09) plant('umbrella', x, y, z, rng);
          else if (roll > 0.9) plant('bush', x, y, z, rng);
        } else if (top === SAND && y > WATER_Y + 0.3 && y < WATER_Y + 3) {
          if (roll < 0.3) plant('palm', x, y, z, rng);
        }
      }

    this.hideCrystals(s);
    this.findSpawn();
  }

  // eight crystals: one on the sea floor, one up in the mountains, one in a cave, the rest anywhere
  hideCrystals(s) {
    const rng = new SeededRandom(s * 31 + 7);
    const place = (x, y, z) => this.crystals.push({ id: this.crystals.length, x, y, z, found: false });
    const far = (x, z) => !this.crystals.some((c) => Math.hypot(c.x - x, c.z - z) < 20);
    const surface = (want) => {
      for (let tries = 0; tries < 4000; tries++) {
        const x = rng.int(8, SIZE - 9) + 0.5,
          z = rng.int(8, SIZE - 9) + 0.5,
          y = this.surfaceY(x, z);
        if (want(y) && far(x, z)) return place(x, y, z);
      }
    };
    surface((y) => y < SEA - 1 && y > SEA - 7);
    surface((y) => y > SEA + 16);
    // a cave: a floor of solid ground with air over it, well under the land's surface
    for (let tries = 0; tries < 40000; tries++) {
      const i = rng.int(16, NX - 17),
        k = rng.int(16, NX - 17),
        j = rng.int(8, 80);
      const y = j * VOX;
      if (y + 4 > this.heights[k * NX + i] || y < WATER_Y + 1) continue;
      if (this.d(i, j, k) > 0 && this.d(i, j + 1, k) <= 0 && this.d(i, j + 3, k) <= 0 && far(i * VOX, k * VOX)) {
        const a = this.d(i, j, k),
          b = this.d(i, j + 1, k);
        place(i * VOX, (j + a / (a - b)) * VOX, k * VOX);
        this.crystals.at(-1).cave = true;
        break;
      }
    }
    for (let k = 0; k < 40 && this.crystals.length < CRYSTALS; k++) surface((y) => y > SEA - 6);
  }

  // a place on low, open, flat ground as near the island's middle as there is
  findSpawn() {
    let best = null,
      bestD = Infinity;
    for (let z = 4; z < SIZE - 4; z++)
      for (let x = 4; x < SIZE - 4; x++) {
        const h = this.heightAt(x, z);
        if (h < WATER_Y + 0.8 || h > WATER_Y + 6) continue;
        const d = Math.hypot(x - SIZE / 2, z - SIZE / 2);
        if (d >= bestD) continue;
        let open = Math.abs(this.surfaceY(x, z) - h) < 0.3;
        for (let dz = -2; dz <= 2 && open; dz++)
          for (let dx = -2; dx <= 2 && open; dx++) if (Math.abs(this.heightAt(x + dx, z + dz) - h) > 1) open = false;
        if (open && this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.5)) open = false;
        if (!open) continue;
        bestD = d;
        best = [x + 0.5, h + 0.05, z + 0.5];
      }
    this.spawn = best || [SIZE / 2, this.surfaceY(SIZE / 2, SIZE / 2) + 0.1, SIZE / 2];
  }
}
