// The world: a field of numbers grown from a seed. Each point of a grid holds how solid it is (above 0 inside the
// ground, below 0 in the air, about the distance to the surface) and what it is made of. The surface is where the
// field crosses 0; surfacenets.js turns it into a smooth mesh, and digging just lowers the field in a ball.
// The island's shape, river, trees and crystals come from the procedural almanac (vendor/almanac).
import { islandHeight, windingRiver } from '../vendor/almanac/land.js';
import { fractalNoise, ridgedNoise, valueNoise, latticeRandom } from '../vendor/almanac/noise.js';
import { SeededRandom, hash32 } from '../vendor/almanac/random.js';
import { smoothstep, lerp } from '../vendor/almanac/numbers.js';
import { branchingTree, swayingChain } from '../vendor/almanac/growth.js';
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

    // 3. trees, one at most in each 4 x 4 cell, the kind by where it stands
    const forest = (x, z) => fractalNoise(x / 38, z / 38, s + 20, 3);
    for (let cz = 1; cz < SIZE / 4 - 1; cz++)
      for (let cx = 1; cx < SIZE / 4 - 1; cx++) {
        const x = cx * 4 + Math.floor(latticeRandom(cx, cz, s + 21) * 4),
          z = cz * 4 + Math.floor(latticeRandom(cx, cz, s + 22) * 4);
        const y = this.surfaceY(x, z);
        if (Math.abs(y - this.heights[z * SIZE + x]) > 0.6) continue; // over a cave mouth
        const top = this.m(x, Math.floor(y - 0.5), z),
          roll = latticeRandom(cx, cz, s + 23);
        const rng = new SeededRandom(hash32(x * 7919 + z * 104729 + s));
        let tree = null;
        if (top === GRASS) {
          if (y > SEA + 14) {
            if (roll < 0.45) tree = pine(x, y, z, rng);
          } else if (roll < 0.05 + 0.6 * smoothstep(0.48, 0.7, forest(x, z))) tree = leafTree(x, y, z, rng);
        } else if (top === DRYGRASS) {
          if (roll < 0.09) tree = umbrellaTree(x, y, z, rng);
        } else if (top === SAND && y > WATER_Y + 0.3 && y < WATER_Y + 3) {
          if (roll < 0.3) tree = palm(x, y, z, rng);
        }
        if (tree) {
          tree.id = this.trees.length;
          this.trees.push(tree);
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
        if (open && this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3)) open = false;
        if (!open) continue;
        bestD = d;
        best = [x + 0.5, h + 0.05, z + 0.5];
      }
    this.spawn = best || [SIZE / 2, this.surfaceY(SIZE / 2, SIZE / 2) + 0.1, SIZE / 2];
  }
}

// --- trees as shapes: wood as segments (a start, an end, a radius), leaves as clumps; flora.js makes meshes of them

// a point of an almanac tree (drawn upward in a plane) set into the world, the plane turned to `turn`
const into = (x, y, z, turn) => (px, py) => [x + Math.cos(turn) * px, y - py, z + Math.sin(turn) * px];

// a leafy tree: the almanac's branchingTree in two crossed planes, a clump of leaves at every tip
function leafTree(x, y, z, rng) {
  const plan = { levels: 3, forks: 2, spread: 0.55, decay: 0.72, length: 3 + rng.range(0, 1.6), width: 1 };
  const turn = rng.range(0, Math.PI);
  const segs = [],
    clumps = [];
  let trunkTop = null;
  for (const t of [turn, turn + Math.PI / 2]) {
    const tree = branchingTree(0, 0, plan, 1, rng);
    const at = into(x, y - 0.3, z, t);
    // the second plane's branches grow from the first one's trunk
    const top = at(tree.segments[0].x1, tree.segments[0].y1);
    const shift = trunkTop ? trunkTop.map((v, k) => v - top[k]) : [0, 0, 0];
    trunkTop = trunkTop || top;
    const p = (px, py) => at(px, py).map((v, k) => v + shift[k]);
    for (const sg of tree.segments) {
      if (sg.level === plan.levels && segs.length) continue; // one trunk is enough
      const a = p(sg.x0, sg.y0),
        m = p(0.25 * sg.x0 + 0.5 * sg.cx + 0.25 * sg.x1, 0.25 * sg.y0 + 0.5 * sg.cy + 0.25 * sg.y1),
        b = p(sg.x1, sg.y1);
      const r = 0.1 + 0.1 * sg.level;
      segs.push({ a, b: m, r: r * 1.05 }, { a: m, b, r });
    }
    for (const [px, py] of tree.tips) clumps.push({ c: p(px, py), r: rng.range(1.5, 2.1), flat: 0.8 });
  }
  return { kind: 'leaf', x, y, z, segs, clumps, hue: rng.range(-1, 1) };
}

// an umbrella tree of the dry grass: wide forks, flat crowns
function umbrellaTree(x, y, z, rng) {
  const plan = { levels: 2, forks: 2, spread: 0.85, decay: 0.85, length: 3.2 + rng.range(0, 1), width: 1 };
  const tree = branchingTree(0, 0, plan, 1, rng);
  const p = into(x, y - 0.3, z, rng.range(0, Math.PI));
  const segs = tree.segments.map((sg) => ({ a: p(sg.x0, sg.y0), b: p(sg.x1, sg.y1), r: 0.12 + 0.1 * sg.level }));
  const clumps = tree.tips.map(([px, py]) => {
    const c = p(px, py);
    c[1] += 0.6;
    return { c, r: 2.6, flat: 0.35 };
  });
  return { kind: 'umbrella', x, y, z, segs, clumps, hue: rng.range(-1, 1) };
}

// a palm: its trunk bent like the almanac's swayingChain caught at one moment, fronds drooping all round
function palm(x, y, z, rng) {
  const pts = swayingChain(0, 0, { segments: 7, length: 6 + rng.range(0, 2.5), sway: 0.5, lean: rng.range(-1.2, 1.2) }, 1, rng.range(0, 10), 0);
  const p = into(x, y - 0.3, z, rng.range(0, Math.PI * 2));
  const segs = [];
  for (let j = 0; j < pts.length - 1; j++) segs.push({ a: p(...pts[j]), b: p(...pts[j + 1]), r: 0.26 - j * 0.015 });
  const top = p(...pts.at(-1));
  const fronds = [];
  const n = 6 + rng.int(0, 2),
    a0 = rng.range(0, Math.PI * 2);
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2 + rng.range(-0.2, 0.2),
      len = 3 + rng.range(0, 1.2),
      line = [];
    for (let i = 0; i <= 6; i++) {
      const d = (i / 6) * len;
      line.push([top[0] + Math.cos(a) * d, top[1] + 0.3 + d * 0.35 - d * d * 0.16, top[2] + Math.sin(a) * d]);
    }
    fronds.push(line);
  }
  return { kind: 'palm', x, y, z, segs, clumps: [], fronds, crown: top, hue: rng.range(-1, 1) };
}

// a pine: a straight trunk in tiers of needles, narrowing to the top
function pine(x, y, z, rng) {
  const h = 6 + rng.range(0, 4);
  const segs = [{ a: [x, y - 0.3, z], b: [x, y + h, z], r: 0.24 }];
  const cones = [];
  for (let k = 0; k < 4; k++) {
    const f = k / 4;
    cones.push({ c: [x, y + 1.8 + f * (h - 2.2), z], r: 2.3 * (1 - f) + 0.7, h: 2.6 - f * 0.6 });
  }
  return { kind: 'pine', x, y, z, segs, clumps: [], cones, hue: rng.range(-1, 1) };
}
