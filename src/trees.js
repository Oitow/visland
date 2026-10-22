// Trees grown in three dimensions, as data: branches as tapering tubes (a line of points with a radius at each) and
// leaves as clusters. Each branch forks into children turned round it by the golden angle (137.5°, as leaves and
// branches spiral on real plants), bent up toward the light or down by their weight, and wobbled by noise.
// After the branching models in Prusinkiewicz and Lindenmayer, "The Algorithmic Beauty of Plants" (1990), which the
// almanac's 2D branchingTree also follows; flora.js turns the data into meshes.
import { valueNoise } from '../vendor/almanac/noise.js';
import { lerp } from '../vendor/almanac/numbers.js';

const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 137.5°

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// any direction square to a
const across = (a) => norm(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
// v turned round the axis k by angle t (Rodrigues)
function turn(v, k, t) {
  const c = Math.cos(t),
    s = Math.sin(t),
    d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const kv = cross(k, v);
  return [v[0] * c + kv[0] * s + k[0] * d * (1 - c), v[1] * c + kv[1] * s + k[1] * d * (1 - c), v[2] * c + kv[2] * s + k[2] * d * (1 - c)];
}

// what each kind of tree is like
export const SPECIES = {
  oak: { name: 'Eiche', levels: 4, len: [2.2, 3], r: [0.3, 0.4], kids: [3, 4], spread: [0.55, 0.95], lenK: 0.66, rK: 0.6, up: 0.18, droop: 0, wobble: 0.35, leaf: 1.35, bark: '#5b4130', barkB: '#4a3426', leafTint: '#4f9a3c' },
  birch: { name: 'Birke', levels: 4, len: [3.5, 4.5], r: [0.17, 0.22], kids: [2, 3], spread: [0.4, 0.6], lenK: 0.6, rK: 0.58, up: 0.1, droop: 0.28, wobble: 0.25, leaf: 1.0, bark: '#e8e4da', barkB: '#2e2a26', leafTint: '#86c14f' },
  umbrella: { name: 'Schirmakazie', levels: 3, len: [2.4, 3], r: [0.22, 0.28], kids: [2, 3], spread: [0.6, 0.85], lenK: 0.85, rK: 0.62, up: 0.05, droop: 0, wobble: 0.3, leaf: 1.6, flat: true, bark: '#6b5236', barkB: '#55402a', leafTint: '#7aa043' },
  pine: { name: 'Kiefer', bark: '#5a3d27', barkB: '#45301f', leafTint: '#2f6b46' },
  palm: { name: 'Palme', bark: '#9a7a52', barkB: '#7d6141', leafTint: '#6ab44c' },
};

/**
 * One tree, its shape fixed by its random numbers.
 * @param {string} kind a key of SPECIES
 * @param {number[]} base where it stands
 * @param {{range: function, int: function, next: function}} rng a SeededRandom
 * @param {number} seed for the noise that wobbles its branches
 * @returns {{kind: string, x: number, y: number, z: number, wood: object[], leaves: object[], segs: object[],
 *   balls: number[][], height: number, crown: number[]}}
 *   wood: tubes {pts, r, depth}; leaves: clusters {c, r, flat}; segs and balls: what the body bumps into and what the
 *   eye's ray hits (the trunk's pieces, and a ball per leaf cluster)
 */
export function growTree(kind, base, rng, seed) {
  const wood = [],
    leaves = [];
  if (kind === 'pine') pine(base, rng, wood, leaves);
  else if (kind === 'palm') palm(base, rng, wood, leaves);
  else branchy(SPECIES[kind], base, rng, seed, wood, leaves);
  // roots flaring out at the foot of the trunk
  const trunk = wood[0];
  const nRoots = kind === 'palm' ? 0 : 4 + rng.int(0, 1);
  for (let i = 0; i < nRoots; i++) {
    const a = (i / nRoots) * Math.PI * 2 + rng.range(-0.3, 0.3),
      r0 = trunk.r[0] * 0.38;
    const p0 = [base[0] + Math.cos(a) * trunk.r[0] * 0.4, base[1] + 0.35, base[2] + Math.sin(a) * trunk.r[0] * 0.4];
    const p1 = [p0[0] + Math.cos(a) * 0.35, base[1] + 0.12, p0[2] + Math.sin(a) * 0.35];
    const p2 = [p0[0] + Math.cos(a) * 0.75, base[1] - 0.15, p0[2] + Math.sin(a) * 0.75];
    wood.push({ pts: [p0, p1, p2], r: [r0, r0 * 0.55, 0.03], depth: 1, root: true, parent: 0, at: 0 });
  }
  const segs = [];
  for (const w of wood)
    if (w.depth === 0 || (w.depth === 1 && !w.root && w.r[0] > 0.12))
      for (let i = 0; i < w.pts.length - 1; i++) segs.push({ a: w.pts[i], b: w.pts[i + 1], r: w.r[i], trunk: w.depth === 0 });
  let top = base[1];
  for (const w of wood) for (const p of w.pts) top = Math.max(top, p[1]);
  for (const l of leaves) top = Math.max(top, l.c[1] + l.r * 0.6);
  const crown = leaves.length ? leaves.reduce((s, l) => add(s, mul(l.c, 1 / leaves.length)), [0, 0, 0]) : [base[0], top, base[2]];
  return { kind, x: base[0], y: base[1], z: base[2], wood, leaves, segs, balls: leaves.map((l) => [...l.c, l.r]), height: top - base[1], crown };
}

// a branching broadleaf: each branch a bent tube, its children spiralling off along its upper part
function branchy(sp, base, rng, seed, wood, leaves) {
  const branch = (start, dir, len, r, depth, parent, at) => {
    const n = depth === 0 ? 6 : depth === 1 ? 4 : 3, // fewer bends in the thin twigs
      pts = [start],
      rs = [r];
    let p = start,
      d = dir;
    for (let i = 1; i <= n; i++) {
      // bend toward the light, sag under its weight, and wander a little
      const w = [valueNoise(p[0] * 0.7 + depth * 3, p[2] * 0.7, seed) - 0.5, 0, valueNoise(p[2] * 0.7, p[0] * 0.7 + depth * 3, seed + 1) - 0.5];
      d = norm(add(add(d, mul(w, sp.wobble)), [0, sp.up - sp.droop * (depth / sp.levels) * (i / n), 0]));
      p = add(p, mul(d, len / n));
      pts.push(p);
      rs.push(lerp(r, r * sp.rK, i / n));
    }
    const me = wood.length;
    wood.push({ pts, r: rs, depth, parent, at });
    if (depth >= sp.levels - 1) {
      leaves.push({ c: p, r: sp.leaf * rng.range(0.85, 1.15), flat: sp.flat ? 0.35 : 0.8, on: me });
      return;
    }
    const kids = rng.int(sp.kids[0], sp.kids[1]);
    const side = across(d);
    const phase = rng.range(0, Math.PI * 2);
    for (let k = 0; k < kids; k++) {
      // the last child carries on from the tip; the others leave along the upper half
      const last = k === kids - 1;
      const at = last ? n : Math.floor(lerp(n * 0.45, n - 1, k / Math.max(1, kids - 1)));
      const tilt = last ? rng.range(0.1, 0.3) : rng.range(sp.spread[0], sp.spread[1]);
      const out = turn(turn(d, side, tilt), d, phase + k * GOLDEN);
      branch(pts[at], out, len * sp.lenK * rng.range(0.85, 1.1), rs[at] * (last ? 0.9 : 0.75), depth + 1, me, at);
    }
    // a few leaves along the way on the outer branches, so the crown is full
    if (depth === sp.levels - 2) leaves.push({ c: pts[Math.floor(n * 0.7)], r: sp.leaf * 0.75, flat: sp.flat ? 0.35 : 0.8, on: me });
  };
  const lean = [rng.range(-0.08, 0.08), 1, rng.range(-0.08, 0.08)];
  branch(base, norm(lean), rng.range(sp.len[0], sp.len[1]), rng.range(sp.r[0], sp.r[1]), 0, -1, 0);
}

// a pine: one straight trunk with whorls of drooping branches, longer toward the foot, needles along each
function pine(base, rng, wood, leaves) {
  const h = rng.range(7, 10.5),
    r = rng.range(0.22, 0.3);
  const pts = [],
    rs = [];
  for (let i = 0; i <= 6; i++) {
    pts.push([base[0] + Math.sin(i * 0.9) * 0.05, base[1] + (h * i) / 6, base[2] + Math.cos(i * 0.7) * 0.05]);
    rs.push(lerp(r, 0.04, i / 6));
  }
  wood.push({ pts, r: rs, depth: 0, parent: -1, at: 0 });
  let phase = rng.range(0, 6.28);
  for (let y = 2; y < h - 0.4; y += rng.range(0.55, 0.8)) {
    const f = (y - 2) / (h - 2); // 0 at the lowest whorl, 1 at the top
    const len = lerp(2.6, 0.5, f) * rng.range(0.85, 1.1);
    const n = 5;
    for (let k = 0; k < n; k++) {
      const a = phase + (k / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const p0 = [base[0], base[1] + y, base[2]];
      const out = [Math.cos(a), 0.15, Math.sin(a)];
      const p1 = add(p0, mul(norm(out), len * 0.55)),
        p2 = add(add(p0, mul(norm(out), len)), [0, -len * 0.28, 0]);
      const at = Math.min(5, Math.round((y / h) * 6));
      wood.push({ pts: [p0, p1, p2], r: [0.06, 0.04, 0.02], depth: 2, parent: 0, at });
      leaves.push({ c: add(mul(p1, 0.4), mul(p2, 0.6)), r: len * 0.42 + 0.35, flat: 0.45, along: [p0, p2], on: wood.length - 1 });
    }
    phase += GOLDEN;
  }
  leaves.push({ c: [base[0], base[1] + h, base[2]], r: 0.7, flat: 1.2, on: 0 });
}

// a palm: a ringed trunk that leans and bends, a crown of long feathered fronds, and coconuts
function palm(base, rng, wood, leaves) {
  const lean = rng.range(0.15, 0.45),
    a = rng.range(0, Math.PI * 2),
    h = rng.range(6, 8.5);
  const pts = [],
    rs = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8,
      off = lean * h * t * t;
    pts.push([base[0] + Math.cos(a) * off, base[1] + h * t, base[2] + Math.sin(a) * off]);
    rs.push(lerp(0.3, 0.2, t));
  }
  wood.push({ pts, r: rs, depth: 0, rings: true, parent: -1, at: 0 });
  const top = pts.at(-1);
  const n = 7 + rng.int(0, 2),
    a0 = rng.range(0, 6.28);
  for (let k = 0; k < n; k++) {
    const fa = a0 + k * GOLDEN * 2.4,
      len = rng.range(3.2, 4.4),
      rise = rng.range(0.25, 0.6);
    const line = [];
    for (let i = 0; i <= 6; i++) {
      const d = (i / 6) * len;
      line.push([top[0] + Math.cos(fa) * d, top[1] + 0.2 + d * rise - d * d * 0.17, top[2] + Math.sin(fa) * d]);
    }
    leaves.push({ c: line[3], r: 1.4, frond: line, on: 0 });
  }
  const nuts = rng.int(2, 4);
  for (let k = 0; k < nuts; k++) {
    const na = rng.range(0, 6.28);
    leaves.push({ c: [top[0] + Math.cos(na) * 0.28, top[1] - 0.25, top[2] + Math.sin(na) * 0.28], r: 0.17, nut: true, on: 0 });
  }
}

// a bush: a few leaf clusters low on the ground (no wood to speak of)
export function growBush(base, rng) {
  const leaves = [];
  const n = rng.int(2, 4);
  for (let k = 0; k < n; k++) leaves.push({ c: [base[0] + rng.range(-0.5, 0.5), base[1] + rng.range(0.3, 0.6), base[2] + rng.range(-0.5, 0.5)], r: rng.range(0.6, 0.9), flat: 0.7, on: -1 });
  return { kind: 'bush', x: base[0], y: base[1], z: base[2], wood: [], leaves, segs: [], balls: [], height: 1, crown: base };
}
