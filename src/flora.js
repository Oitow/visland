// Meshes for what stands on the ground, all built in code: trees (from the shapes trees.js grows) as bark tubes and
// cards of leaves, the notch an axe cuts, stumps with growth rings, logs, crystals, lanterns, grass and the axe.
// Everything here is plain numbers (no three.js, no page), so it runs in the world's worker as well as on the page;
// meshes.js turns the arrays into three.js geometry, and paints the leaves' picture.
import { hexToRgb, mixColour } from '../vendor/almanac/colour.js';
import { latticeRandom } from '../vendor/almanac/noise.js';
import { SeededRandom } from '../vendor/almanac/random.js';
import { SPECIES } from './trees.js';

const rgb = (hex, k = 1) => hexToRgb(hex).map((v) => (v / 255) * k);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const across = (a) => norm(cross(a, Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));

// an icosahedron's twenty faces, on the unit sphere
const ICO = (() => {
  const f = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, f, 0], [1, f, 0], [-1, -f, 0], [1, -f, 0], [0, -1, f], [0, 1, f], [0, -1, -f], [0, 1, -f], [f, 0, -1], [f, 0, 1], [-f, 0, -1], [-f, 0, 1]].map(norm);
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return faces.map((fc) => fc.map((i) => v[i]));
})();

const FRESH = rgb('#dcbc8a'); // freshly cut wood
const RING = rgb('#b8915e');

// --- the leaves' picture --------------------------------------------------------------------------------------------

export const LEAF_TILES = { broad: 0, birch: 1, needles: 2, frond: 3 };

// --- building blocks ------------------------------------------------------------------------------------------------

// triangles with a normal, a colour, how much they sway, and (for leaves) where in the atlas they read
class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.sway = [];
    this.uv = [];
  }
  vert(p, n, c, s, uv = [0, 0]) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.sway.push(s);
    this.uv.push(uv[0], uv[1]);
  }
  flat(a, b, c, color, s = 0) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    this.vert(a, n, color, s);
    this.vert(b, n, color, s);
    this.vert(c, n, color, s);
  }
  // the triangles as typed arrays, ready to send between threads (meshes.js makes them geometry)
  geometry() {
    if (!this.pos.length) return null;
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nor),
      aColor: new Float32Array(this.col),
      aSway: new Float32Array(this.sway),
      uv: new Float32Array(this.uv),
    };
  }
}

/**
 * A bark tube along points, a radius at each. `look(i, k, around)` gives each corner's colour; `dent(p, around)`
 * pushes a corner in (the axe's notch) and returns how far.
 */
function tube(b, pts, rs, sides, look, swayOf, dent = null, ss = null) {
  let u = across(norm(sub(pts[1], pts[0])));
  const rings = [];
  for (let i = 0; i < pts.length; i++) {
    const t = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    u = norm(sub(u, mul(t, dot(t, u)))); // carried along the tube so it does not twist
    const w = cross(t, u);
    const ring = [];
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const n = add(mul(u, Math.cos(a)), mul(w, Math.sin(a)));
      let p = add(pts[i], mul(n, rs[i]));
      let cut = 0;
      if (dent) {
        cut = dent(pts[i], n, rs[i], ss ? ss[i] : 0);
        p = sub(p, mul(n, cut));
      }
      ring.push({ p, n, c: cut > 0.02 ? FRESH : look(i, k % sides, a), s: swayOf(p) });
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < sides; k++) {
      const a = rings[i][k],
        c = rings[i][k + 1],
        d = rings[i + 1][k + 1],
        e = rings[i + 1][k];
      for (const v of [a, d, c, a, e, d]) b.vert(v.p, v.n, v.c, v.s);
    }
}

// a flat round cap facing n, in growth rings (the top of a stump, the end of a log)
function rings(b, center, n, r, sides = 12) {
  const u = across(n),
    w = cross(n, u);
  const at = (k, rr) => {
    const a = (k / sides) * Math.PI * 2;
    return add(center, add(mul(u, Math.cos(a) * rr), mul(w, Math.sin(a) * rr)));
  };
  const bands = [1, 0.72, 0.45, 0.2];
  for (let j = 0; j < bands.length; j++) {
    const c = j % 2 ? RING : FRESH;
    for (let k = 0; k < sides; k++) {
      const r0 = r * bands[j],
        r1 = j + 1 < bands.length ? r * bands[j + 1] : 0;
      const p0 = at(k, r0),
        p1 = at(k + 1, r0),
        q0 = at(k, r1),
        q1 = at(k + 1, r1);
      for (const p of [p0, p1, q1, p0, q1, q0]) b.vert(p, n, c, 0);
    }
  }
}

function barkLook(tree, depth) {
  const sp = SPECIES[tree.kind];
  const A = rgb(sp.bark),
    B = rgb(sp.barkB);
  return (i, k) => {
    const r = latticeRandom(i * 7 + depth * 31, k, tree.id);
    if (tree.kind === 'birch') return r < 0.16 && depth === 0 ? B : mixColour(A, rgb('#cfc9bc'), r * 0.6);
    if (tree.kind === 'palm') return i % 2 ? B : A;
    return mixColour(A, B, (k % 2) * 0.5 + r * 0.4);
  };
}

// a tube's points between two distances along it (metres from its foot), with extra rings round every cut so a
// notch has room to show; returns the points, their radii, and each one's distance along the tube
function along(w, from, to, cuts) {
  const L = [0];
  for (let i = 1; i < w.pts.length; i++) L.push(L[i - 1] + Math.hypot(...sub(w.pts[i], w.pts[i - 1])));
  const at = (s) => {
    let i = 0;
    while (i < L.length - 2 && L[i + 1] < s) i++;
    const f = Math.max(0, Math.min(1, (s - L[i]) / (L[i + 1] - L[i] || 1)));
    return [add(w.pts[i], mul(sub(w.pts[i + 1], w.pts[i]), f)), w.r[i] + (w.r[i + 1] - w.r[i]) * f];
  };
  const stops = new Set([from, to, ...L.filter((s) => s > from && s < to)]);
  for (const c of cuts) for (const o of [-0.3, -0.18, -0.09, 0, 0.09, 0.18, 0.3]) if (c.s + o > from && c.s + o < to) stops.add(c.s + o);
  const ss = [...stops].sort((a, b) => a - b);
  const pts = [],
    rs = [];
  for (const s of ss) {
    const [p, r] = at(s);
    pts.push(p);
    rs.push(r);
  }
  return { pts, rs, ss, length: L.at(-1) };
}

// the cards of one cluster of leaves
function leafCards(b, tree, leaf, tint, swayOf, rng) {
  if (leaf.nut) {
    // a coconut: a small brown ball
    for (const tri of ICO) {
      const p = tri.map((v) => add(leaf.c, mul(v, leaf.r)));
      b.flat(p[0], p[1], p[2], rgb('#6b4a2a', 0.9 + 0.2 * rng.next()), swayOf(leaf.c));
    }
    return;
  }
  const tile = tree.kind === 'birch' ? LEAF_TILES.birch : tree.kind === 'pine' ? LEAF_TILES.needles : LEAF_TILES.broad;
  const U = (u, v) => [(tile + u) / 4, v];
  const card = (center, ax, ay, n, color, s) => {
    const corners = [
      add(center, add(mul(ax, -1), mul(ay, -1))),
      add(center, add(ax, mul(ay, -1))),
      add(center, add(ax, ay)),
      add(center, add(mul(ax, -1), ay)),
    ];
    const uvs = [U(0, 0), U(1, 0), U(1, 1), U(0, 1)];
    for (const k of [0, 1, 2, 0, 2, 3]) b.vert(corners[k], n, color, s, uvs[k]);
  };
  if (leaf.frond) {
    // a palm frond: a ribbon along its line, widest in the middle, the frond picture running along it
    const L = leaf.frond;
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i],
        c = L[i + 1];
      const side = norm(cross(sub(c, a), [0, 1, 0]));
      const wa = 0.75 * Math.sin(((i + 0.2) / (L.length - 1)) * Math.PI) + 0.08,
        wc = 0.75 * Math.sin(((i + 1) / (L.length - 1)) * Math.PI) + 0.08;
      const n = norm(cross(side, sub(c, a)));
      const v0 = i / (L.length - 1),
        v1 = (i + 1) / (L.length - 1);
      const T = LEAF_TILES.frond / 4;
      const P = [add(a, mul(side, -wa)), add(a, mul(side, wa)), add(c, mul(side, wc)), add(c, mul(side, -wc))];
      const UV = [
        [T, v0],
        [T + 0.25, v0],
        [T + 0.25, v1],
        [T, v1],
      ];
      const s0 = swayOf(a) + (i / L.length) * 0.6,
        s1 = swayOf(c) + ((i + 1) / L.length) * 0.6;
      const S = [s0, s0, s1, s1];
      for (const k of [0, 1, 2, 0, 2, 3]) b.vert(P[k], n[1] < 0 ? mul(n, -1) : n, tint, S[k], UV[k]);
    }
    return;
  }
  if (leaf.along) {
    // pine needles: cards lying along the branch, a little tilted
    const [p0, p2] = leaf.along;
    const dir = norm(sub(p2, p0)),
      side = norm(cross(dir, [0, 1, 0]));
    const len = Math.hypot(...sub(p2, p0));
    for (let k = 0; k < 4; k++) {
      const t = 0.25 + k * 0.22;
      const c = add(add(p0, mul(sub(p2, p0), t)), [0, rng.range(-0.05, 0.1), 0]);
      const tilt = rng.range(-0.35, 0.35);
      const ay = mul(norm(add(side, [0, tilt, 0])), leaf.r * 0.75);
      const ax = mul(dir, len * 0.22 + 0.25);
      const n = norm(add(cross(ax, ay), [0, 0.6, 0]));
      card(c, ax, ay, n[1] < 0 ? mul(n, -1) : n, mul(tint, rng.range(0.85, 1.1)), swayOf(c) + 0.15);
    }
    return;
  }
  // a broadleaf cluster: cards turned every way through a ball (flattened for a flat crown), shaded as if the
  // cluster were one round lump, darker inside and underneath
  const count = Math.max(5, Math.min(11, Math.round(leaf.r * 6)));
  for (let k = 0; k < count; k++) {
    const d = norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]);
    const reach = Math.cbrt(rng.next()) * leaf.r * 0.6;
    const c = add(leaf.c, [d[0] * reach, d[1] * reach * leaf.flat, d[2] * reach]);
    const facing = norm([rng.range(-1, 1), rng.range(-0.3, 1), rng.range(-1, 1)]);
    const ax = mul(across(facing), leaf.r * 0.62),
      ay = mul(cross(facing, norm(ax)), leaf.r * 0.62);
    const n = norm(add(mul(sub(c, leaf.c), 1 / leaf.r), add(mul(norm(sub(leaf.c, tree.crown)), 0.6), [0, 0.5, 0])));
    const inner = 0.72 + 0.28 * (reach / (leaf.r * 0.6)) + d[1] * 0.08;
    card(c, ax, ay, n, mul(tint, inner * rng.range(0.92, 1.08)), swayOf(c) + 0.25);
  }
}

// --- trees ----------------------------------------------------------------------------------------------------------

function treeTint(tree) {
  let c = rgb(SPECIES[tree.kind]?.leafTint || '#4f9a3c');
  // now and then a broadleaf already turning: yellower, or toward red
  const r = latticeRandom(tree.id, 3, 777);
  if ((tree.kind === 'oak' || tree.kind === 'birch') && r < 0.14) c = mixColour(c, r < 0.05 ? rgb('#c8642c') : rgb('#d6b23a'), 0.65);
  if (tree.kind === 'bush') c = rgb('#4a8c3a');
  return mixColour(c, rgb('#9ac24a'), latticeRandom(tree.id, 9, 5) * 0.2);
}

/**
 * The meshes of a tree or a piece of one, in its own coordinates. Each tube may be gone (cut away), may start or end
 * at a cut (from, to: metres along it, shown with growth rings), and may carry notches {s, depth, dir}.
 * @param {{kind, id, y, height, crown, wood: object[], leaves: object[]}} tree
 * @param {{sway?: boolean}} [o] sway: the tree stands rooted and moves in the wind (a fallen piece does not)
 */
function buildTree(tree, wb, lb, o = {}) {
  const rng = new SeededRandom(tree.id * 131 + 7);
  const sway = o.sway !== false;
  const swayOf = (p) => {
    if (!sway) return 0;
    const h = Math.max(0, (p[1] - tree.y) / Math.max(1, tree.height));
    return h * h * 0.9;
  };
  for (const w of tree.wood) {
    if (w.gone) continue;
    const look = barkLook(tree, w.depth);
    const sides = w.depth === 0 ? 10 : w.depth === 1 ? 6 : w.depth === 2 ? 4 : 3;
    const cuts = w.cuts || [];
    if (w.from === undefined && w.to === undefined && !cuts.length) {
      tube(wb, w.pts, w.r, sides, look, swayOf);
      continue;
    }
    const total = along(w, 0, Infinity, []).length;
    const { pts, rs, ss } = along(w, w.from || 0, Math.min(w.to ?? total, total), cuts);
    if (pts.length < 2) continue;
    // notches: wedges cut into the side each blow came from, as deep as the blows so far
    const dent = cuts.length
      ? (p, n, r, s) => {
          let cut = 0;
          for (const c of cuts) {
            const v = Math.max(0, 1 - Math.abs(s - c.s) / 0.22);
            const facing = Math.max(0, dot(n, c.dir));
            cut = Math.max(cut, r * 0.95 * Math.min(1, c.depth) * v * Math.sqrt(facing));
          }
          return cut;
        }
      : null;
    tube(wb, pts, rs, sides, look, swayOf, dent, ss);
    // where the tube was cut through, its end shows the wood's rings
    const dirAt = (i, j) => norm(sub(pts[j], pts[i]));
    if (w.from > 0) rings(wb, pts[0], dirAt(1, 0), rs[0]);
    if (w.to !== undefined && w.to < total) rings(wb, pts.at(-1), dirAt(pts.length - 2, pts.length - 1), rs.at(-1));
  }
  const tint = treeTint(tree);
  for (const l of tree.leaves) if (!l.gone) leafCards(lb, tree, l, tint, swayOf, rng);
}

/** The meshes of every standing, untouched tree in a list (one chunk's); trees being cut are drawn on their own. */
export function treesGeometry(trees) {
  const wb = new Builder(),
    lb = new Builder();
  for (const t of trees) if (t.state === 'standing') buildTree(t, wb, lb);
  return { wood: wb.geometry(), leaves: lb.geometry() };
}

/** One tree on its own (rooted, being cut) or a piece cut from one (fallen, not swaying). */
export function singleTreeGeometry(tree, o) {
  const wb = new Builder(),
    lb = new Builder();
  buildTree(tree, wb, lb, o);
  return { wood: wb.geometry(), leaves: lb.geometry() };
}

/** A log lying on the ground, along x, centred on the origin, with rings at both ends. */
export function logGeometry(len, r, kind) {
  const b = new Builder();
  const look = barkLook({ kind, id: Math.round(len * 100) }, 0);
  tube(b, [[-len / 2, 0, 0], [0, 0, 0], [len / 2, 0, 0]], [r, r * 0.97, r * 0.94], 8, look, () => 0);
  rings(b, [len / 2, 0, 0], [1, 0, 0], r * 0.94, 8);
  rings(b, [-len / 2, 0, 0], [-1, 0, 0], r, 8);
  return b.geometry();
}

/** The axe held in the hand: a wooden haft and an iron head, about 0.6 long, the haft along y. */
export function axeGeometry() {
  const b = new Builder();
  tube(b, [[0, -0.32, 0], [0, 0, 0], [0, 0.3, 0]], [0.022, 0.024, 0.026], 6, (i, k) => rgb(k % 2 ? '#8a5f37' : '#9b6c40'), () => 0);
  const iron = rgb('#9aa1a8'),
    edge = rgb('#e8ecef'),
    dark = rgb('#5d6268');
  // the head: thick round the haft, thinning to a curved, bright edge that flares above and below
  const W = 0.032; // half its thickness at the haft
  const back = [
    [-0.045, 0.22, -W],
    [-0.045, 0.3, -W],
    [-0.045, 0.3, W],
    [-0.045, 0.22, W],
  ];
  const arc = [
    [0.15, 0.14],
    [0.18, 0.2],
    [0.19, 0.26],
    [0.18, 0.32],
    [0.15, 0.37],
  ];
  const e = (k, side) => [arc[k][0], arc[k][1], side * 0.004];
  const neck = (side, top) => [0.05, top ? 0.31 : 0.21, side * W * 0.7];
  for (const side of [-1, 1]) {
    // the flat of the blade: a fan from the neck to the edge
    const z = side * W;
    const quadSide = (a, c, d, f) => (side > 0 ? (b.flat(a, c, d, iron), b.flat(a, d, f, iron)) : (b.flat(a, d, c, iron), b.flat(a, f, d, iron)));
    quadSide([-0.045, 0.22, z], [-0.045, 0.3, z], neck(side, true), neck(side, false));
    for (let k = 0; k < arc.length - 1; k++) {
      const a = neck(side, false),
        c = neck(side, true);
      const mid = k < 2 ? a : c;
      if (side > 0) b.flat(mid, e(k, side), e(k + 1, side), iron);
      else b.flat(mid, e(k + 1, side), e(k, side), iron);
    }
    if (side > 0) b.flat(neck(side, false), neck(side, true), e(2, side), iron);
    else b.flat(neck(side, true), neck(side, false), e(2, side), iron);
  }
  // the bright edge, the back of the head, its top and bottom
  for (let k = 0; k < arc.length - 1; k++) {
    b.flat(e(k, -1), e(k, 1), e(k + 1, 1), edge);
    b.flat(e(k, -1), e(k + 1, 1), e(k + 1, -1), edge);
  }
  b.flat(back[0], back[3], back[2], dark);
  b.flat(back[0], back[2], back[1], dark);
  b.flat(back[1], back[2], neck(1, true), dark);
  b.flat(back[1], neck(1, true), neck(-1, true), dark);
  b.flat(back[0], neck(-1, false), neck(1, false), dark);
  b.flat(back[0], neck(1, false), back[3], dark);
  b.flat(neck(1, true), e(4, 1), e(4, -1), iron);
  b.flat(neck(1, true), e(4, -1), neck(-1, true), iron);
  b.flat(neck(1, false), neck(-1, false), e(0, -1), iron);
  b.flat(neck(1, false), e(0, -1), e(0, 1), iron);
  return b.geometry();
}

/** The pickaxe held in the hand: a haft along y and a curved iron head across its top, pointed both ways. */
export function pickGeometry() {
  const b = new Builder();
  tube(b, [[0, -0.32, 0], [0, 0, 0], [0, 0.3, 0]], [0.022, 0.024, 0.026], 6, (i, k) => rgb(k % 2 ? '#8a5f37' : '#9b6c40'), () => 0);
  const iron = (i) => rgb(i === 2 ? '#e2e6ea' : '#9aa1a8');
  for (const side of [-1, 1])
    tube(b, [[0, 0.3, 0], [side * 0.13, 0.31, 0], [side * 0.27, 0.25, 0]], [0.034, 0.024, 0.005], 5, (i) => iron(i), () => 0);
  return b.geometry();
}

// a crystal: a cluster of long six-sided points, lit from inside
export function crystalGeometry(id) {
  const rng = new SeededRandom(id * 977 + 3);
  const b = new Builder();
  const colors = [rgb('#8ef0ff'), rgb('#c58cff'), rgb('#e8fbff')];
  for (let k = 0; k < 4; k++) {
    const h = k === 0 ? 1.3 : rng.range(0.5, 0.9),
      r = k === 0 ? 0.28 : rng.range(0.13, 0.2);
    const tilt = k === 0 ? 0 : 0.5,
      a = rng.range(0, Math.PI * 2);
    const base = k === 0 ? [0, 0, 0] : [Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25];
    const ax = [Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)];
    const top = add(base, mul(ax, h)),
      mid = add(base, mul(ax, h * 0.55));
    for (let i = 0; i < 6; i++) {
      const t0 = (i / 6) * Math.PI * 2,
        t1 = ((i + 1) / 6) * Math.PI * 2;
      const ring = (t) => add(mid, [Math.cos(t) * r, 0, Math.sin(t) * r]);
      const c = colors[(i + k) % 3];
      b.flat(ring(t0), top, ring(t1), c);
      b.flat(ring(t1), base, ring(t0), mul(c, 0.8));
    }
  }
  return b.geometry();
}

// a lantern's frame: a short post and a cap (the glowing box inside is added by meshes.js)
export function lanternGeometry() {
  const b = new Builder();
  const wood = rgb('#4a3322');
  tube(b, [[0, -0.2, 0], [0, 0.55, 0]], [0.07, 0.06], 6, () => wood, () => 0);
  const box = (x0, y0, z0, x1, y1, z1, c) => {
    const P = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
    const faces = [
      [P(1, 0, 1), P(1, 0, 0), P(1, 1, 0), P(1, 1, 1)],
      [P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)],
      [P(0, 1, 1), P(1, 1, 1), P(1, 1, 0), P(0, 1, 0)],
      [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)],
      [P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)],
      [P(1, 0, 0), P(0, 0, 0), P(0, 1, 0), P(1, 1, 0)],
    ];
    for (const [a, bb, cc, d] of faces) {
      b.flat(a, bb, cc, c);
      b.flat(a, cc, d, c);
    }
  };
  box(-0.2, 0.55, -0.2, 0.2, 0.6, 0.2, wood);
  box(-0.22, 0.95, -0.22, 0.22, 1.02, 0.22, wood);
  return b.geometry();
}

// grass: a few thin blades, many copies placed by the ground's mesh
export function tuftGeometry(baseHex, tipHex) {
  const b = new Builder();
  const base = rgb(baseHex),
    tip = rgb(tipHex);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI + 0.3,
      lean = 0.18 * (k % 2 ? 1 : -1);
    const c = [Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06];
    const p0 = [-c[0], 0, -c[2]],
      p1 = [c[0], 0, c[2]],
      top = [Math.cos(a + 1.57) * lean, 0.45 + (k % 3) * 0.08, Math.sin(a + 1.57) * lean];
    b.vert(p0, [0, 1, 0], base, 0);
    b.vert(p1, [0, 1, 0], base, 0);
    b.vert(top, [0, 1, 0], tip, 1);
  }
  return b.geometry();
}
