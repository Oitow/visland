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

export const SIZE = 160; // points across (x and z), one metre apart
export const HEIGHT = 64; // points up (y)
export const SEA = 12;
export const WATER_Y = 12.6; // the water's surface
export const CHUNK = 16; // cells across one mesh
export const CRYSTALS = 8; // crystals hidden on each island
const LIMIT = 4; // the field is kept within ±4: only its value near the surface matters

export class World {
  constructor(seed) {
    this.seed = seed;
    this.density = new Float32Array(SIZE * SIZE * HEIGHT);
    this.mat = new Uint8Array(SIZE * SIZE * HEIGHT);
    this.heights = new Float32Array(SIZE * SIZE); // the land's height per column, as it grew
    this.trees = [];
    this.crystals = [];
    this.lanterns = [];
    this.spawn = [SIZE / 2, 30, SIZE / 2];
  }

  idx(x, y, z) {
    return (y * SIZE + z) * SIZE + x;
  }

  // the field at a whole point: solid under the world, air beyond its edges and above it
  d(x, y, z) {
    if (y < 0) return LIMIT;
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y >= HEIGHT) return -LIMIT;
    return this.density[(y * SIZE + z) * SIZE + x];
  }

  m(x, y, z) {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y < 0 || y >= HEIGHT) return STONE;
    return this.mat[(y * SIZE + z) * SIZE + x];
  }

  // the field anywhere, blended from the eight points round it
  sample(x, y, z) {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const u = x - xi,
      v = y - yi,
      w = z - zi;
    const a = lerp(this.d(xi, yi, zi), this.d(xi + 1, yi, zi), u),
      b = lerp(this.d(xi, yi + 1, zi), this.d(xi + 1, yi + 1, zi), u),
      c = lerp(this.d(xi, yi, zi + 1), this.d(xi + 1, yi, zi + 1), u),
      e = lerp(this.d(xi, yi + 1, zi + 1), this.d(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(a, b, v), lerp(c, e, v), w);
  }

  solid(x, y, z) {
    return this.sample(x, y, z) > 0;
  }

  // the highest surface in a column (where the field last crosses 0, coming down)
  surfaceY(x, z) {
    const xi = Math.max(0, Math.min(SIZE - 1, Math.round(x))),
      zi = Math.max(0, Math.min(SIZE - 1, Math.round(z)));
    for (let y = HEIGHT - 2; y >= 0; y--) {
      const a = this.d(xi, y, zi);
      if (a > 0) {
        const b = this.d(xi, y + 1, zi);
        return y + a / (a - b);
      }
    }
    return 0;
  }

  // the highest ground under the water in a column (for the water's colour)
  floorY(x, z) {
    for (let y = Math.floor(WATER_Y); y >= 0; y--) {
      const a = this.d(x, y, z);
      if (a > 0) {
        const b = this.d(x, y + 1, z);
        return b > 0 ? y + 1 : y + a / (a - b);
      }
    }
    return -1;
  }

  /**
   * Change the ground in a ball: dig it away, or heap material on.
   * @returns {Map<number, number>} for digging, how much of each material went (in points)
   */
  brush(cx, cy, cz, r, add, material) {
    const took = new Map();
    const R = Math.ceil(r + 1);
    for (let y = Math.max(0, Math.floor(cy) - R); y <= Math.min(HEIGHT - 1, Math.floor(cy) + R); y++)
      for (let z = Math.max(0, Math.floor(cz) - R); z <= Math.min(SIZE - 1, Math.floor(cz) + R); z++)
        for (let x = Math.max(0, Math.floor(cx) - R); x <= Math.min(SIZE - 1, Math.floor(cx) + R); x++) {
          const i = this.idx(x, y, z),
            dist = Math.hypot(x - cx, y - cy, z - cz),
            old = this.density[i];
          if (add) {
            const v = Math.min(LIMIT, r - dist);
            if (v > old) {
              if (old <= 0.25) this.mat[i] = material; // the new surface is the new stuff
              this.density[i] = v;
            }
          } else {
            if (y <= 1) continue; // the island's floor stays
            const v = Math.max(-LIMIT, dist - r);
            if (v < old) {
              if (old > 0 && v <= 0) took.set(this.mat[i], (took.get(this.mat[i]) || 0) + 1);
              this.density[i] = v;
            }
          }
        }
    return took;
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
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
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
        this.heights[z * SIZE + x] = Math.max(1.5, Math.min(HEIGHT - 12, h));
      }

    // 2. the ground: what each column is made of, the field from its height, and caves through it
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        const col = z * SIZE + x,
          h = this.heights[col];
        const moist = fractalNoise(x / 45, z / 45, s + 3, 3);
        const snowLine = SEA + 24 + valueNoise(x / 12, z / 12, s + 4) * 5;
        let top, under;
        if (h < WATER_Y - 0.4) {
          top = h >= SEA - 4 || valueNoise(x / 9, z / 9, s + 6) > 0.55 ? SAND : GRAVEL;
          under = top;
        } else if (h < WATER_Y + 1.3 + latticeRandom(x >> 1, z >> 1, s + 7) * 0.8) {
          top = under = SAND;
        } else if (h >= snowLine) {
          top = SNOW;
          under = STONE;
        } else if (h > SEA + 21) {
          top = under = STONE;
        } else {
          top = moist < 0.42 ? DRYGRASS : GRASS;
          under = DIRT;
        }
        // caves: tunnels where two 3D noises both pass their middle (two surfaces crossing make a line), only under
        // land that stands well above the sea
        const caves = smoothstep(WATER_Y + 1, WATER_Y + 5, h);
        for (let y = 0; y < HEIGHT; y++) {
          let d = h - y;
          if (caves > 0 && y >= 3 && y < h + 1) {
            const a = valueNoise3(x / 16, y / 9, z / 16, s + 50),
              b = valueNoise3(x / 16, y / 9, z / 16, s + 61);
            const tunnel = (Math.abs(a - 0.5) + Math.abs(b - 0.5) - 0.07) * 28 + (1 - caves) * 10;
            d = Math.min(d, tunnel);
          }
          if (y === 0) d = Math.max(d, 1);
          const i = this.idx(x, y, z);
          this.density[i] = Math.max(-LIMIT, Math.min(LIMIT, d));
          const depth = h - y;
          this.mat[i] = depth < 1.3 ? top : depth < 4 ? under : STONE;
        }
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
        if (Math.abs(y - this.heights[z * SIZE + x]) > 0.6) continue; // over a cave mouth
        const top = this.m(x, Math.floor(y - 0.5), z),
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
    for (let tries = 0; tries < 20000; tries++) {
      const x = rng.int(8, SIZE - 9),
        z = rng.int(8, SIZE - 9),
        y = rng.int(4, 40);
      if (y + 4 > this.heights[z * SIZE + x] || y < WATER_Y + 1) continue;
      if (this.d(x, y, z) > 0 && this.d(x, y + 1, z) <= 0 && this.d(x, y + 2, z) <= 0 && far(x, z)) {
        const a = this.d(x, y, z),
          b = this.d(x, y + 1, z);
        place(x + 0.5, y + a / (a - b), z + 0.5);
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
        const h = this.heights[z * SIZE + x];
        if (h < WATER_Y + 0.8 || h > WATER_Y + 6) continue;
        const d = Math.hypot(x - SIZE / 2, z - SIZE / 2);
        if (d >= bestD) continue;
        let open = Math.abs(this.surfaceY(x, z) - h) < 0.3;
        for (let dz = -2; dz <= 2 && open; dz++)
          for (let dx = -2; dx <= 2 && open; dx++) if (Math.abs(this.heights[(z + dz) * SIZE + x + dx] - h) > 1) open = false;
        if (open && this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.5)) open = false;
        if (!open) continue;
        bestD = d;
        best = [x + 0.5, h + 0.05, z + 0.5];
      }
    this.spawn = best || [SIZE / 2, this.surfaceY(SIZE / 2, SIZE / 2) + 0.1, SIZE / 2];
  }
}
