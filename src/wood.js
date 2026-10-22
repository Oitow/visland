// Cutting wood, the way it goes in the woods: a blow cuts a notch where it lands, on any branch or trunk, deeper the
// harder the blow and the thinner the wood. When a notch goes through, everything beyond it (the rest of the branch,
// the branches growing from it, their leaves) comes away as a piece of its own, a rigid body that falls, rolls and
// comes to rest (physics.js). Pieces can be cut again. Leaves wither from a fallen piece after a while; a piece small
// enough to carry is picked up by walking to it, a bigger one must be cut smaller first.
import * as THREE from 'three';
import { singleTreeGeometry } from './flora.js';
import { geo } from './meshes.js';
import { WATER_Y } from './world.js';
import { PIECE_GROUPS } from './physics.js';

const FRESH = [0.86, 0.74, 0.54];
const CARRY = 2.4; // the most wood (metres of it, all pieces added) that can be picked up at once

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// a tube's lengths along it, point by point
function lengths(w) {
  const L = [0];
  for (let i = 1; i < w.pts.length; i++) L.push(L[i - 1] + Math.hypot(...sub(w.pts[i], w.pts[i - 1])));
  return L;
}

// the pieces of a tube between where it starts and ends (it may have been cut at either), as segments
export function segmentsOf(w) {
  const L = lengths(w),
    from = w.from || 0,
    to = Math.min(w.to ?? Infinity, L.at(-1));
  const out = [];
  const at = (s) => {
    let i = 0;
    while (i < L.length - 2 && L[i + 1] < s) i++;
    const f = Math.max(0, Math.min(1, (s - L[i]) / (L[i + 1] - L[i] || 1)));
    return [add(w.pts[i], mul(sub(w.pts[i + 1], w.pts[i]), f)), w.r[i] + (w.r[i + 1] - w.r[i]) * f];
  };
  const stops = [from, ...L.filter((s) => s > from && s < to), to];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ra] = at(stops[i]),
      [b, rb] = at(stops[i + 1]);
    out.push({ a, b, r: (ra + rb) / 2, s0: stops[i], s1: stops[i + 1] });
  }
  return out;
}

// the nearest point to p on the segment a..b, and how far along it
function nearest(p, a, b) {
  const ab = sub(b, a),
    l2 = dot(ab, ab) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return [add(a, mul(ab, t)), t];
}

// what the body bumps into and the eye's ray hits: trunks and thick branches, and a ball per cluster of leaves
export function refreshShape(t) {
  t.segs = [];
  for (const w of t.wood)
    if (!w.gone && (w.depth === 0 || (w.depth === 1 && !w.root && w.r[0] > 0.12)))
      for (const s of segmentsOf(w)) t.segs.push({ a: s.a, b: s.b, r: s.r, trunk: w.depth === 0 });
}

export class Woodcutter {
  /**
   * @param {{scene, world, physics, particles, sound, wood, leaves, treeChanged: function, give: function, say: function}} o
   *   wood and leaves: the materials; treeChanged(tree): the worker must stop drawing it (it is drawn here now);
   *   give(n): wood to carry; say(text): a short note on screen
   */
  constructor(o) {
    Object.assign(this, o);
    this.active = new Map(); // rooted trees being cut: tree -> mesh group
    this.pieces = [];
    this.fixed = new Map(); // tree -> its trunk, as a fixed body other pieces bump into
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.sayTimer = 0;
    for (const t of this.world.trees) if (t.state !== 'gone') this.fix(t);
  }

  // a rooted tree's trunk and big branches, fixed in place, for falling pieces to land against
  fix(t) {
    this.physics?.remove(this.fixed.get(t));
    this.fixed.delete(t);
    if (!this.physics || t.kind === 'bush') return;
    const b = this.physics.body([0, 0, 0], t.segs.filter((s) => s.r >= 0.1), 'fixed');
    if (b) this.fixed.set(t, b);
  }

  /** Lay again the cuts a saved tree had (what came off it then is gone now). */
  replay(t) {
    for (const [ti, s, inc, dir] of t.log || []) this.cutAt(t, ti, s, inc, dir, false);
    refreshShape(t);
    this.draw(t);
    this.fix(t);
  }

  /**
   * A blow: where it lands, how hard (0..1.2), with what. On a rooted tree or on a fallen piece.
   * @returns {boolean} whether it cut anything
   */
  hit(owner, point, strength, tool) {
    const piece = owner.body ? owner : null;
    const t = piece ? piece.wood : owner;
    if (t.kind === 'bush') {
      this.leafBurst(t.leaves.map((l) => l.c), 4);
      t.state = 'gone';
      this.treeChanged(t);
      this.sound.rustle();
      return true;
    }
    const p = piece ? this.toLocal(piece, point) : point;
    // the tube the blow lands on, and where along it
    let best = null;
    t.wood.forEach((w, ti) => {
      if (w.gone) return;
      for (const s of segmentsOf(w)) {
        const [q, f] = nearest(p, s.a, s.b);
        const d = Math.hypot(...sub(p, q)) - s.r;
        if (d < 0.3 && (!best || d < best.d)) best = { d, ti, q, r: s.r, s: s.s0 + f * (s.s1 - s.s0), axis: norm(sub(s.b, s.a)) };
      }
    });
    if (!best) return false;
    // the notch faces where the blow came from
    const out = sub(p, best.q);
    const dir = norm(sub(out, mul(best.axis, dot(out, best.axis))));
    const inc = (strength * (tool === 'axe' ? 0.09 : 0.03)) / Math.max(0.04, best.r);
    if (!piece) {
      if (t.state === 'standing') {
        t.state = 'active';
        this.treeChanged(t);
      }
      (t.log ||= []).push([best.ti, +best.s.toFixed(3), +inc.toFixed(3), dir.map((v) => +v.toFixed(3))]);
    }
    this.chips(point, piece ? this.toWorldDir(piece, dir) : dir);
    this.sound.chop();
    const off = this.cutAt(t, best.ti, best.s, inc, dir, true);
    refreshShape(t);
    if (piece) this.rebody(piece);
    else this.fix(t);
    this.draw(piece || t);
    if (off) this.loose(off, piece, dir);
    return true;
  }

  // deepen (or start) a notch; when it goes through, what comes away (in the owner's coordinates), else null
  cutAt(t, ti, s, inc, dir, keep) {
    const w = t.wood[ti];
    w.cuts ||= [];
    let c = w.cuts.find((k) => Math.abs(k.s - s) < 0.15);
    if (!c) w.cuts.push((c = { s, depth: 0, dir }));
    c.depth += inc;
    if (c.depth < 1) return null;
    // through: everything beyond the cut goes
    const L = lengths(w);
    const goes = new Set();
    t.wood.forEach((v, j) => {
      if (j === ti || v.gone) return;
      if ((v.parent === ti && L[v.at] > c.s) || goes.has(v.parent)) goes.add(j);
    });
    const leafS = (l) => {
      let bs = 0,
        bd = Infinity;
      for (const sg of segmentsOf(w)) {
        const [q, f] = nearest(l.c, sg.a, sg.b);
        const d = Math.hypot(...sub(l.c, q));
        if (d < bd) [bd, bs] = [d, sg.s0 + f * (sg.s1 - sg.s0)];
      }
      return bs;
    };
    const leavesGo = t.leaves.filter((l) => !l.gone && (goes.has(l.on) || (l.on === ti && leafS(l) > c.s)));
    let off = null;
    if (keep) {
      // the piece that comes away, re-numbered: the cut tube first, then what grew from it
      const map = new Map([[ti, 0]]);
      const tubes = [{ ...w, pts: w.pts.map((q) => [...q]), r: [...w.r], from: c.s, cuts: w.cuts.filter((k) => k.s > c.s + 0.05), parent: -1, at: 0 }];
      for (const j of [...goes].sort((a, b) => a - b)) {
        map.set(j, tubes.length);
        const v = t.wood[j];
        tubes.push({ ...v, pts: v.pts.map((q) => [...q]), r: [...v.r], cuts: (v.cuts || []).map((k) => ({ ...k })), parent: map.get(v.parent) ?? 0 });
      }
      const leaves = leavesGo.map((l) => ({ ...l, on: map.get(l.on) ?? 0 }));
      off = { kind: t.kind, id: t.id, wood: tubes, leaves, cut: c };
    }
    // the owner keeps what is on this side of the cut
    w.to = c.s;
    w.cuts = w.cuts.filter((k) => k.s < c.s - 0.05);
    for (const j of goes) t.wood[j].gone = true;
    for (const l of leavesGo) l.gone = true;
    if ((w.from || 0) >= w.to - 0.05) w.gone = true;
    return off;
  }

  // a piece comes away: a body of its own, at its centre of mass
  loose(off, from, dir) {
    const world = from ? this.mapPoints(off, (p) => this.toWorld(from, p)) : off;
    if (!this.physics) {
      // no physics engine here: what comes away falls apart into wood at once
      this.leafBurst(world.leaves.filter((l) => !l.nut).map((l) => l.c), 2);
      this.give(Math.max(1, Math.round(world.wood.reduce((n, w) => n + segmentsOf(w).reduce((k, s) => k + Math.hypot(...sub(s.b, s.a)) * s.r * 12, 0), 0))));
      return;
    }
    let m = 0,
      c = [0, 0, 0];
    for (const w of world.wood)
      for (const s of segmentsOf(w)) {
        const k = s.r * s.r * Math.hypot(...sub(s.b, s.a));
        c = add(c, mul(add(s.a, s.b), k / 2));
        m += k;
      }
    if (!m) return;
    c = mul(c, 1 / m);
    const local = this.mapPoints(world, (p) => sub(p, c));
    const wood = { kind: off.kind, id: off.id * 1000 + this.pieces.length + 1, y: -1e9, height: 1, crown: [0, 0, 0], wood: local.wood, leaves: local.leaves };
    const piece = { wood, body: null, group: null, age: 0, still: 0, fallSpeed: 0 };
    piece.length = local.wood.reduce((n, w) => n + segmentsOf(w).reduce((k, s) => k + Math.hypot(...sub(s.b, s.a)), 0), 0);
    this.rebody(piece, c);
    if (!piece.body) return;
    if (from) {
      const v = from.body.linvel();
      piece.body.setLinvel(v, true);
    } else {
      // cut through at the foot: it tips away from the notch (away from whoever cut it)
      let top = c;
      for (const w of world.wood) for (const p of w.pts) if (p[1] > top[1]) top = p;
      const mass = piece.body.mass();
      piece.body.applyImpulseAtPoint({ x: -dir[0] * mass * 0.7, y: 0, z: -dir[2] * mass * 0.7 }, { x: top[0], y: top[1], z: top[2] }, true);
      this.sound.creak();
    }
    this.pieces.push(piece);
    this.draw(piece);
  }

  // every point of a tree-shaped thing, mapped
  mapPoints(t, f) {
    return {
      ...t,
      wood: t.wood.map((w) => ({ ...w, pts: w.pts.map(f), cuts: (w.cuts || []).map((k) => ({ ...k })) })),
      leaves: t.leaves.map((l) => ({ ...l, c: f(l.c), along: l.along && l.along.map(f), frond: l.frond && l.frond.map(f) })),
    };
  }

  // the body of a piece, made again from what is left of it (keeping where it is and how it moves)
  rebody(piece, at) {
    const old = piece.body;
    const t = piece.wood;
    const parts = [];
    for (const w of t.wood) if (!w.gone) for (const s of segmentsOf(w)) if (s.r >= 0.03) parts.push({ a: s.a, b: s.b, r: s.r, density: 600 });
    for (const l of t.leaves) if (!l.gone) parts.push(l.nut ? { c: l.c, r: l.r, density: 500 } : { c: l.c, r: l.r * 0.5, density: 30 });
    const pos = old ? old.translation() : { x: at[0], y: at[1], z: at[2] };
    const b = this.physics.body([pos.x, pos.y, pos.z], parts);
    if (b && piece.free) this.physics.setGroups(b, PIECE_GROUPS);
    if (b && old) {
      b.setRotation(old.rotation(), true);
      b.setLinvel(old.linvel(), true);
      b.setAngvel(old.angvel(), true);
    }
    this.physics.remove(old);
    piece.body = b;
    if (!b) this.drop(piece);
  }

  toLocal(piece, p) {
    const t = piece.body.translation(),
      r = piece.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w).invert();
    this.v.set(p[0] - t.x, p[1] - t.y, p[2] - t.z).applyQuaternion(this.q);
    return [this.v.x, this.v.y, this.v.z];
  }
  toWorld(piece, p) {
    const t = piece.body.translation(),
      r = piece.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    this.v.set(p[0], p[1], p[2]).applyQuaternion(this.q);
    return [this.v.x + t.x, this.v.y + t.y, this.v.z + t.z];
  }
  toWorldDir(piece, d) {
    const r = piece.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    this.v.set(d[0], d[1], d[2]).applyQuaternion(this.q);
    return [this.v.x, this.v.y, this.v.z];
  }

  // the mesh of a rooted tree being cut (world coordinates) or of a piece (its own, moved with its body)
  draw(o) {
    const piece = o.body !== undefined ? o : null;
    const old = piece ? o.group : this.active.get(o);
    if (old) {
      this.scene.remove(old);
      old.traverse((m) => m.geometry?.dispose());
    }
    const t = piece ? o.wood : o;
    if (!piece && t.state === 'gone') return this.active.delete(o);
    const arrays = singleTreeGeometry(t, { sway: !piece });
    const group = new THREE.Group();
    for (const [a, mat] of [
      [arrays.wood, this.wood],
      [arrays.leaves, this.leaves],
    ])
      if (a) {
        const m = new THREE.Mesh(geo(a), mat);
        m.frustumCulled = false;
        group.add(m);
      }
    this.scene.add(group);
    if (piece) o.group = group;
    else this.active.set(o, group);
  }

  drop(piece) {
    piece.done = true;
    this.physics.remove(piece.body);
    piece.body = null;
    if (piece.group) {
      this.scene.remove(piece.group);
      piece.group.traverse((m) => m.geometry?.dispose());
    }
  }

  /** One physics step: the pieces fall, float, land, wither; small ones are picked up. */
  step(dt, player) {
    this.sayTimer -= dt;
    for (const p of this.pieces) {
      if (p.done) continue;
      const b = p.body;
      const t = b.translation(),
        v = b.linvel();
      // the water holds wood up
      if (t.y < WATER_Y) {
        const under = Math.min(1, (WATER_Y - t.y) / 0.4);
        b.applyImpulse({ x: -v.x * 0.02 * b.mass(), y: b.mass() * 9.81 * 1.5 * under * dt - v.y * 0.03 * b.mass(), z: -v.z * 0.02 * b.mass() }, true);
      }
      // landing hard: a thump, and dust
      if (p.fallSpeed < -4 && v.y > -1) {
        this.sound.crash(Math.min(1, b.mass() / 400));
        this.dust([t.x, t.y, t.z]);
        if (p.wood.leaves.some((l) => !l.gone)) this.leafBurst(p.wood.leaves.filter((l) => !l.gone).map((l) => this.toWorld(p, l.c)), 1);
      }
      p.fallSpeed = v.y;
      p.age += dt;
      // clear of the tree it came from: from now on it bumps into trees too
      if (!p.free && p.age > 1.5) {
        this.physics.setGroups(b, PIECE_GROUPS);
        p.free = true;
      }
      p.still = Math.hypot(v.x, v.y, v.z) < 0.15 ? p.still + dt : 0;
      // the leaves of a fallen piece wither after a while
      if ((p.still > 5 || p.age > 25) && p.wood.leaves.some((l) => !l.gone)) {
        this.leafBurst(p.wood.leaves.filter((l) => !l.gone).map((l) => this.toWorld(p, l.c)), 2);
        for (const l of p.wood.leaves) l.gone = true;
        this.rebody(p);
        if (!p.done) this.draw(p);
        continue;
      }
      if (t.y < -5) this.drop(p);
      // picked up by walking to it, if it is small enough to carry
      const near = Math.hypot(t.x - player.x, t.y - (player.y + 0.8), t.z - player.z) < 1.8;
      if (near && p.age > 0.8) {
        const bare = !p.wood.leaves.some((l) => !l.gone);
        if (bare && p.length <= CARRY) {
          this.give(Math.max(1, Math.round(p.wood.wood.reduce((n, w) => n + segmentsOf(w).reduce((k, s) => k + Math.hypot(...sub(s.b, s.a)) * s.r * 12, 0), 0))));
          this.sound.pickup();
          this.drop(p);
        } else if (this.sayTimer <= 0) {
          this.say(bare ? 'Zu groß zum Tragen · mit der Axt zerteilen' : 'Erst zerteilen, oder warten bis das Laub welkt');
          this.sayTimer = 4;
        }
      }
    }
    this.pieces = this.pieces.filter((p) => !p.done);
  }

  // each frame: the meshes follow their bodies
  draw3() {
    for (const p of this.pieces) {
      const t = p.body.translation(),
        r = p.body.rotation();
      p.group.position.set(t.x, t.y, t.z);
      p.group.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Pieces near a place, as what the player bumps into (their thick parts, in world coordinates). */
  near(x, z) {
    const out = [];
    for (const p of this.pieces) {
      const t = p.body.translation();
      if (Math.abs(t.x - x) > 6 || Math.abs(t.z - z) > 6) continue;
      const segs = [];
      for (const w of p.wood.wood) if (!w.gone) for (const s of segmentsOf(w)) if (s.r >= 0.1) segs.push({ a: this.toWorld(p, s.a), b: this.toWorld(p, s.b), r: s.r, trunk: true, any: true });
      if (segs.length) out.push({ state: 'piece', piece: p, x: t.x, z: t.z, segs });
    }
    return out;
  }

  chips(at, dir) {
    for (let i = 0; i < 9; i++)
      this.particles.spawn(at, [dir[0] * 2.5 + (Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 2.5, dir[2] * 2.5 + (Math.random() - 0.5) * 2.5], FRESH.map((v) => v * (0.85 + Math.random() * 0.25)), { size: 0.06 + Math.random() * 0.05, life: 0.8 });
  }

  leafBurst(points, per) {
    for (const p of points.slice(0, 40))
      for (let k = 0; k < per; k++)
        this.particles.spawn(p.map((v) => v + (Math.random() - 0.5)), [(Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3], [0.32, 0.6, 0.24].map((v) => v * (0.8 + Math.random() * 0.4)), { size: 0.14, life: 2.2 + Math.random(), drag: 3, gravity: 2.5 });
  }

  dust(p) {
    for (let k = 0; k < 10; k++)
      this.particles.spawn([p[0] + (Math.random() - 0.5), p[1] + 0.2, p[2] + (Math.random() - 0.5)], [(Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2], [0.55, 0.47, 0.38], { size: 0.22, life: 1.2, drag: 2.5, gravity: 0.5 });
  }

  clear() {
    for (const g of this.active.values()) this.scene.remove(g);
    for (const p of this.pieces) this.drop(p);
    for (const b of this.fixed.values()) this.physics?.remove(b);
    this.active.clear();
    this.fixed.clear();
    this.pieces = [];
  }
}
