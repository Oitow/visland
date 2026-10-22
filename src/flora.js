// Meshes for the things that stand on the ground: trees (from the shapes world.js grew with the almanac), crystals,
// lanterns, and tufts of grass. All are built from code: cylinders, jittered balls, cones and ribbons.
import * as THREE from 'three';
import { hexToRgb } from '../vendor/almanac/colour.js';
import { latticeRandom } from '../vendor/almanac/noise.js';
import { SeededRandom } from '../vendor/almanac/random.js';

// the ball every clump of leaves starts from (three triangles' corners each, not shared)
const BALL = new THREE.IcosahedronGeometry(1, 1);

const rgb = (hex, k = 1) => hexToRgb(hex).map((v) => (v / 255) * k);

// collects triangles with a normal, a colour and how much each vertex sways in the wind
class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.sway = [];
  }
  vert(p, n, c, s) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.sway.push(s);
  }
  // a flat-shaded triangle
  tri(a, b, c, color, s = [0, 0, 0]) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    n[0] /= l;
    n[1] /= l;
    n[2] /= l;
    this.vert(a, n, color, s[0]);
    this.vert(b, n, color, s[1]);
    this.vert(c, n, color, s[2]);
  }

  // a tapering six-sided log from a to b
  log(a, b, r, color, sway = 0) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d) || 1;
    const ax = d.map((v) => v / len);
    // two directions across the log
    const up = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = cross(ax, up);
    u = u.map((v) => v / Math.hypot(...u));
    const w = cross(ax, u);
    const S = 6,
      r2 = r * 0.82;
    for (let i = 0; i < S; i++) {
      const t0 = (i / S) * Math.PI * 2,
        t1 = ((i + 1) / S) * Math.PI * 2;
      const o = (t, rr) => [Math.cos(t) * u[0] * rr + Math.sin(t) * w[0] * rr, Math.cos(t) * u[1] * rr + Math.sin(t) * w[1] * rr, Math.cos(t) * u[2] * rr + Math.sin(t) * w[2] * rr];
      const p00 = add(a, o(t0, r)),
        p10 = add(a, o(t1, r)),
        p01 = add(b, o(t0, r2)),
        p11 = add(b, o(t1, r2));
      const shade = 0.88 + 0.12 * Math.cos(t0 * 3);
      const c = color.map((v) => v * shade);
      this.tri(p00, p10, p11, c, [0, 0, sway]);
      this.tri(p00, p11, p01, c, [0, sway, sway]);
    }
  }

  // a ball of leaves: an icosphere with its points pushed in and out, squashed by `flat`
  clump(c, r, flat, color, seed) {
    const p = BALL.attributes.position;
    const pts = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      // the same jitter for the same point, so the ball stays closed
      const j = 0.82 + 0.36 * latticeRandom(Math.round(x * 50) + Math.round(z * 31), Math.round(y * 50), seed);
      pts.push([c[0] + x * r * j, c[1] + y * r * flat * j, c[2] + z * r * j]);
    }
    for (let i = 0; i < pts.length; i += 3) {
      const k = 0.82 + 0.3 * latticeRandom(i, seed, 5);
      const cc = color.map((v) => v * k);
      this.tri(pts[i], pts[i + 1], pts[i + 2], cc, [1, 1, 1]);
    }
  }

  cone(c, r, h, color, seed) {
    const S = 7,
      tip = [c[0], c[1] + h, c[2]];
    for (let i = 0; i < S; i++) {
      const t0 = (i / S) * Math.PI * 2 + seed,
        t1 = ((i + 1) / S) * Math.PI * 2 + seed;
      const a = [c[0] + Math.cos(t0) * r, c[1] - 0.25, c[2] + Math.sin(t0) * r],
        b = [c[0] + Math.cos(t1) * r, c[1] - 0.25, c[2] + Math.sin(t1) * r];
      const k = 0.85 + 0.25 * latticeRandom(i, Math.round(seed * 100), 9);
      this.tri(a, tip, b, color.map((v) => v * k), [1, 0.6, 1]);
      this.tri(a, b, [c[0], c[1] + 0.1, c[2]], color.map((v) => v * 0.6), [1, 1, 0.5]);
    }
  }

  // a palm frond: a ribbon along a line, drawn from both sides
  frond(line, color) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i],
        b = line[i + 1];
      const d = [b[0] - a[0], 0, b[2] - a[2]];
      const l = Math.hypot(...d) || 1;
      const side = [-d[2] / l, 0, d[0] / l];
      const wa = 0.55 * Math.sin(((i + 0.3) / line.length) * Math.PI) + 0.05,
        wb = 0.55 * Math.sin(((i + 1.3) / line.length) * Math.PI) + 0.05;
      const a1 = add(a, side.map((v) => v * wa)),
        a2 = add(a, side.map((v) => -v * wa)),
        b1 = add(b, side.map((v) => v * wb)),
        b2 = add(b, side.map((v) => -v * wb));
      const s0 = i / line.length,
        s1 = (i + 1) / line.length;
      const c = color.map((v) => v * (i % 2 ? 0.92 : 1.05));
      this.tri(a1, b1, b2, c, [s0, s1, s1]);
      this.tri(a1, b2, a2, c, [s0, s1, s0]);
      this.tri(b2, b1, a1, c, [s1, s1, s0]);
      this.tri(a2, b2, a1, c, [s0, s1, s0]);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const BARK = { leaf: '#5e4029', umbrella: '#6b5236', palm: '#9a7a52', pine: '#4f3622' };
const LEAF = { leaf: '#3f8f37', umbrella: '#6e9a3c', palm: '#62b04a', pine: '#2a5e40' };

// the mesh of every tree in a list (one chunk's)
export function treesGeometry(trees) {
  const b = new Builder();
  for (const t of trees) {
    if (t.removed) continue;
    const leaf = rgb(LEAF[t.kind], 1 + t.hue * 0.08);
    t.segs.forEach((s, i) => b.log(s.a, s.b, s.r, rgb(BARK[t.kind], t.kind === 'palm' && i % 2 ? 0.86 : 1), t.kind === 'palm' ? (i / t.segs.length) * 0.3 : 0));
    for (const c of t.clumps) b.clump(c.c, c.r, c.flat, leaf, t.id * 13 + Math.round(c.c[1] * 7));
    for (const c of t.cones || []) b.cone(c.c, c.r, c.h, leaf, t.id * 0.37);
    for (const f of t.fronds || []) b.frond(f, leaf);
  }
  return b.pos.length === 0 ? null : b.geometry();
}

// a crystal: a cluster of long eight-sided points, lit from inside
export function crystalMesh(material, id) {
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
    const top = add(base, ax.map((v) => v * h)),
      mid = add(base, ax.map((v) => v * h * 0.55));
    for (let i = 0; i < 6; i++) {
      const t0 = (i / 6) * Math.PI * 2,
        t1 = ((i + 1) / 6) * Math.PI * 2;
      const ring = (t) => add(mid, [Math.cos(t) * r, 0, Math.sin(t) * r]);
      const c = colors[(i + k) % 3];
      b.tri(ring(t0), top, ring(t1), c);
      b.tri(ring(t1), base, ring(t0), c.map((v) => v * 0.8));
    }
  }
  return new THREE.Mesh(b.geometry(), material);
}

// a lantern: a short post with a glowing box on top (the glow is a separate, unlit material)
export function lanternMesh(material, glowMaterial) {
  const b = new Builder();
  const wood = rgb('#4a3322');
  b.log([0, -0.2, 0], [0, 0.55, 0], 0.07, wood);
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
      b.tri(a, bb, cc, c);
      b.tri(a, cc, d, c);
    }
  };
  box(-0.2, 0.55, -0.2, 0.2, 0.6, 0.2, wood);
  box(-0.22, 0.95, -0.22, 0.22, 1.02, 0.22, wood);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(b.geometry(), material));
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.3), glowMaterial);
  core.position.y = 0.77;
  g.add(core);
  return g;
}

// grass: a few thin blades, many copies placed by the ground's mesh
export function tuftGeometry() {
  const b = new Builder();
  const base = rgb('#3f7f2c'),
    tip = rgb('#9fd060');
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI + 0.3,
      lean = 0.18 * (k % 2 ? 1 : -1);
    const c = [Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06];
    const p0 = [-c[0], 0, -c[2]],
      p1 = [c[0], 0, c[2]],
      top = [Math.cos(a + 1.57) * lean, 0.45 + (k % 3) * 0.08, Math.sin(a + 1.57) * lean];
    for (const [x, y, z] of [
      [p0, p1, top],
      [p1, p0, top],
    ]) {
      b.vert(x, [0, 1, 0], base, 0);
      b.vert(y, [0, 1, 0], base, 0);
      b.vert(z, [0, 1, 0], tip, 1);
    }
  }
  return b.geometry();
}
