// The world: a grid of blocks grown from a seed. The island's shape, river, trees and crystals all come from the
// procedural almanac (vendor/almanac), so the same seed always grows the same island and nothing needs storing
// except what the player changed.
import { islandHeight, windingRiver } from '../vendor/almanac/land.js';
import { fractalNoise, ridgedNoise, valueNoise, latticeRandom } from '../vendor/almanac/noise.js';
import { SeededRandom, hash32 } from '../vendor/almanac/random.js';
import { smoothstep, lerp } from '../vendor/almanac/numbers.js';
import { branchingTree, swayingChain } from '../vendor/almanac/growth.js';
import {
  AIR,
  SAND,
  GRASS,
  DIRT,
  STONE,
  SNOW,
  WOOD,
  LEAVES,
  PINE,
  PALM,
  DRYGRASS,
  GRAVEL,
  CRYSTAL,
  BEDROCK,
  BLOCKS,
  isSolid,
} from './blocks.js';

export const SIZE = 160; // blocks across (x and z)
export const HEIGHT = 64; // blocks up (y)
export const SEA = 12; // the highest block row that is under water
export const WATER_Y = SEA + 0.85; // where the water's surface is drawn
export const CHUNK = 16; // blocks across one mesh
export const CRYSTALS = 8; // crystals hidden on each island

export class World {
  constructor(seed) {
    this.seed = seed;
    this.data = new Uint8Array(SIZE * SIZE * HEIGHT);
    this.ground = new Int16Array(SIZE * SIZE); // the land's height per column, as generated
    this.lights = new Map(); // block index -> light radius, for every block that glows
    this.crystals = []; // where the crystals were hidden: [x, y, z]
    this.spawn = [SIZE / 2, 30, SIZE / 2];
  }

  idx(x, y, z) {
    return (y * SIZE + z) * SIZE + x;
  }

  get(x, y, z) {
    if (y < 0) return BEDROCK;
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y >= HEIGHT) return AIR;
    return this.data[(y * SIZE + z) * SIZE + x];
  }

  set(x, y, z, b) {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y < 0 || y >= HEIGHT) return;
    const i = this.idx(x, y, z);
    this.data[i] = b;
    if (BLOCKS[b].light) this.lights.set(i, BLOCKS[b].light);
    else this.lights.delete(i);
  }

  // below the sea's surface and not inside a block
  isWater(x, y, z) {
    return y <= SEA && !isSolid(this.get(x, y, z));
  }

  // the highest solid block at or under the sea in a column (for the water's colour)
  floorY(x, z) {
    for (let y = SEA; y >= 0; y--) if (isSolid(this.get(x, y, z))) return y;
    return -1;
  }

  // the highest solid block in a column
  topY(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) if (isSolid(this.get(x, y, z))) return y;
    return -1;
  }

  generate() {
    const s = this.seed % 9973;
    const heights = new Float32Array(SIZE * SIZE);

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
          h = lerp(h, Math.min(h, SEA + 1.5), bank * bank);
          if (river.depth > 0) h = Math.min(h, SEA - 1 - river.depth * 2);
        }
        heights[z * SIZE + x] = h;
      }

    // 2. the ground's layers: what each column is made of, from bedrock to its top
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        const h = Math.max(1, Math.min(HEIGHT - 12, Math.floor(heights[z * SIZE + x])));
        this.ground[z * SIZE + x] = h;
        let slope = 0;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = Math.min(SIZE - 1, Math.max(0, x + dx)),
            nz = Math.min(SIZE - 1, Math.max(0, z + dz));
          slope = Math.max(slope, Math.abs(h - Math.floor(heights[nz * SIZE + nx])));
        }
        const moist = fractalNoise(x / 45, z / 45, s + 3, 3);
        const snowLine = SEA + 25 + valueNoise(x / 12, z / 12, s + 4) * 5;
        let top, under;
        if (h < SEA) {
          top = h >= SEA - 4 || valueNoise(x / 9, z / 9, s + 6) > 0.55 ? SAND : GRAVEL;
          under = top;
        } else if (h <= SEA + 1 || (h === SEA + 2 && latticeRandom(x, z, s + 7) < 0.5)) {
          top = under = SAND;
        } else if (h >= snowLine) {
          top = SNOW;
          under = STONE;
        } else if (slope >= 3 || h > SEA + 21) {
          top = under = STONE;
        } else {
          top = moist < 0.42 ? DRYGRASS : GRASS;
          under = DIRT;
        }
        this.set(x, 0, z, BEDROCK);
        for (let y = 1; y <= h; y++) this.set(x, y, z, y === h ? top : y > h - 4 ? under : STONE);
      }

    // 3. trees, one at most in each 4 x 4 cell, the kind by where it stands
    const forest = (x, z) => fractalNoise(x / 38, z / 38, s + 20, 3);
    for (let cz = 1; cz < SIZE / 4 - 1; cz++)
      for (let cx = 1; cx < SIZE / 4 - 1; cx++) {
        const x = cx * 4 + Math.floor(latticeRandom(cx, cz, s + 21) * 4),
          z = cz * 4 + Math.floor(latticeRandom(cx, cz, s + 22) * 4);
        const h = this.ground[z * SIZE + x],
          top = this.get(x, h, z),
          roll = latticeRandom(cx, cz, s + 23);
        const rng = new SeededRandom(hash32(x * 7919 + z * 104729 + s));
        if (top === GRASS) {
          if (h > SEA + 14) {
            if (roll < 0.45) this.pine(x, h + 1, z, rng);
          } else if (roll < 0.05 + 0.6 * smoothstep(0.48, 0.7, forest(x, z))) this.leafTree(x, h + 1, z, rng);
        } else if (top === DRYGRASS) {
          if (roll < 0.09) this.umbrellaTree(x, h + 1, z, rng);
        } else if (top === SAND && h >= SEA + 1 && h <= SEA + 3) {
          if (roll < 0.3) this.palm(x, h + 1, z, rng);
        }
      }

    this.hideCrystals(s);
    this.findSpawn();
  }

  // a block of leaves, only where there is nothing yet
  leaf(x, y, z, b) {
    if (this.get(x, y, z) === AIR) this.set(x, y, z, b);
  }

  // wood along a curve from the almanac's branchingTree (drawn in a plane turned to the angle `turn`)
  woodCurve(seg, bx, by, bz, turn) {
    const c = Math.cos(turn),
      sn = Math.sin(turn);
    for (let t = 0; t <= 1.001; t += 0.12) {
      const u = 1 - t,
        px = u * u * seg.x0 + 2 * u * t * seg.cx + t * t * seg.x1,
        py = u * u * seg.y0 + 2 * u * t * seg.cy + t * t * seg.y1;
      const x = Math.round(bx + c * px),
        y = Math.round(by - py),
        z = Math.round(bz + sn * px);
      if (this.get(x, y, z) === AIR || BLOCKS[this.get(x, y, z)].see) this.set(x, y, z, WOOD);
    }
  }

  blob(x, y, z, r, b, rng, flat = 1) {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++)
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.hypot(dx, dy / flat, dz);
          if (d <= r - 0.3 || (d <= r + 0.3 && rng.chance(0.5))) this.leaf(x + dx, y + dy, z + dz, b);
        }
  }

  // a leafy tree: the almanac's branchingTree in two planes crossed, with a clump of leaves at every tip
  leafTree(x, y, z, rng) {
    const plan = { levels: 3, forks: 2, spread: 0.55, decay: 0.72, length: 3 + rng.range(0, 1.6), width: 1 };
    const turn = rng.range(0, Math.PI);
    const tips = [];
    for (const t of [turn, turn + Math.PI / 2]) {
      const tree = branchingTree(0, 0, plan, 1, rng);
      for (const seg of tree.segments) this.woodCurve(seg, x, y, z, t);
      for (const [px, py] of tree.tips) tips.push([x + Math.cos(t) * px, y - py, z + Math.sin(t) * px]);
    }
    for (const [px, py, pz] of tips) this.blob(Math.round(px), Math.round(py), Math.round(pz), rng.range(1.8, 2.5), LEAVES, rng, 0.8);
  }

  // an umbrella tree of the dry grass: wide forks, flat crowns
  umbrellaTree(x, y, z, rng) {
    const plan = { levels: 2, forks: 2, spread: 0.85, decay: 0.85, length: 3.2 + rng.range(0, 1), width: 1 };
    const t = rng.range(0, Math.PI);
    const tree = branchingTree(0, 0, plan, 1, rng);
    for (const seg of tree.segments) this.woodCurve(seg, x, y, z, t);
    for (const [px, py] of tree.tips) {
      const cx = Math.round(x + Math.cos(t) * px),
        cy = Math.round(y - py),
        cz = Math.round(z + Math.sin(t) * px);
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.hypot(dx, dz);
          if (d < 2.6 || (d < 3.2 && rng.chance(0.4))) this.leaf(cx + dx, cy + 1, cz + dz, LEAVES);
          if (d < 1.6) this.leaf(cx + dx, cy + 2, cz + dz, LEAVES);
        }
    }
  }

  // a palm: its trunk bent like the almanac's swayingChain caught at one moment, fronds drooping all round
  palm(x, y, z, rng) {
    const turn = rng.range(0, Math.PI * 2),
      c = Math.cos(turn),
      sn = Math.sin(turn);
    const pts = swayingChain(0, 0, { segments: 8, length: 6 + rng.range(0, 2.5), sway: 0.5, lean: rng.range(-1.2, 1.2) }, 1, rng.range(0, 10), 0);
    let top = [x, y, z];
    for (let j = 0; j < pts.length - 1; j++)
      for (let t = 0; t < 1; t += 0.25) {
        const px = lerp(pts[j][0], pts[j + 1][0], t),
          py = lerp(pts[j][1], pts[j + 1][1], t);
        top = [Math.round(x + c * px), Math.round(y - py), Math.round(z + sn * px)];
        this.set(top[0], top[1], top[2], WOOD);
      }
    const [tx, ty, tz] = top;
    this.leaf(tx, ty + 1, tz, PALM);
    const fronds = 5 + rng.int(0, 2),
      a0 = rng.range(0, Math.PI * 2);
    for (let k = 0; k < fronds; k++) {
      const a = a0 + (k / fronds) * Math.PI * 2,
        len = 3 + rng.range(0, 1.5);
      for (let i = 1; i <= len; i += 0.5)
        this.leaf(Math.round(tx + Math.cos(a) * i), Math.round(ty + 1 - i * i * 0.1), Math.round(tz + Math.sin(a) * i), PALM);
    }
  }

  // a pine: a straight trunk in tiers of needles, narrowing to the top
  pine(x, y, z, rng) {
    const h = 6 + rng.int(0, 4);
    for (let i = 0; i < h; i++) this.set(x, y + i, z, WOOD);
    this.leaf(x, y + h, z, PINE);
    for (let i = 2; i < h; i++) {
      const fromTop = h - i,
        r = (fromTop % 2 === 0 ? 0.9 : 1.6) + fromTop * 0.28;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dz) <= r) this.leaf(x + dx, y + i, z + dz, PINE);
    }
  }

  // eight crystals spread over the island, at least one under the sea and one up high
  hideCrystals(s) {
    const rng = new SeededRandom(s * 31 + 7);
    const wants = [
      (h) => h < SEA - 1 && h > SEA - 7, // on the sea floor
      (h) => h > SEA + 16, // up in the mountains
      () => true,
    ];
    for (let tries = 0; tries < 6000 && this.crystals.length < CRYSTALS; tries++) {
      const x = rng.int(8, SIZE - 9),
        z = rng.int(8, SIZE - 9);
      const y = this.topY(x, z),
        want = wants[Math.min(this.crystals.length, wants.length - 1)];
      if (y < SEA - 8 || !want(y) || this.get(x, y + 1, z) !== AIR) continue;
      if (this.crystals.some(([cx, , cz]) => Math.hypot(cx - x, cz - z) < 22)) continue;
      this.set(x, y + 1, z, CRYSTAL);
      this.crystals.push([x, y + 1, z]);
    }
  }

  // a place on low, open ground as near the island's middle as there is
  findSpawn() {
    let best = null,
      bestD = Infinity;
    for (let z = 4; z < SIZE - 4; z++)
      for (let x = 4; x < SIZE - 4; x++) {
        const h = this.ground[z * SIZE + x];
        if (h < SEA + 2 || h > SEA + 7) continue;
        if (this.get(x, h + 1, z) !== AIR || this.get(x, h + 2, z) !== AIR) continue;
        // open ground: everything within two blocks about as high, and nothing growing overhead
        let open = true;
        for (let dz = -2; dz <= 2 && open; dz++)
          for (let dx = -2; dx <= 2 && open; dx++) {
            const nx = x + dx,
              nz = z + dz;
            if (Math.abs(this.ground[nz * SIZE + nx] - h) > 1 || this.topY(nx, nz) > this.ground[nz * SIZE + nx]) open = false;
          }
        if (!open) continue;
        const d = Math.hypot(x - SIZE / 2, z - SIZE / 2);
        if (d < bestD) {
          bestD = d;
          best = [x + 0.5, h + 1, z + 0.5];
        }
      }
    if (best) this.spawn = best;
    else this.spawn = [SIZE / 2 + 0.5, this.topY(SIZE / 2, SIZE / 2) + 1, SIZE / 2 + 0.5];
  }
}
