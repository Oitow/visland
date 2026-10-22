// Tools that have to connect: the axe and the pickaxe swing along an arc in front of the player, and whatever the
// blade meets on the way is what it hits. Each physics step the edge (and the path its tip took since the last step)
// is tested against nearby wood (trees and fallen pieces) and the ground. A miss is a miss; a fast blow straight
// across the grain cuts deepest, a glancing one less; an axe rings off stone, a pickaxe breaks it.
import * as THREE from 'three';
import { segmentsOf } from './wood.js';
import { STONE, GRAVEL } from './materials.js';

const STRIKE = [0.18, 0.42]; // when in the swing the blade can hit (seconds)
export const SWING = 0.62; // a whole swing, wind-up to recovery

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// the nearest points of two segments p1..q1 and p2..q2, and how far apart they are
function segSeg(p1, q1, p2, q2) {
  const d1 = sub(q1, p1),
    d2 = sub(q2, p2),
    r = sub(p1, p2);
  const a = dot(d1, d1) || 1e-9,
    e = dot(d2, d2) || 1e-9,
    f = dot(d2, r),
    c = dot(d1, r),
    b = dot(d1, d2);
  const den = a * e - b * b;
  let s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = Math.max(0, Math.min(1, -c / a));
  } else if (t > 1) {
    t = 1;
    s = Math.max(0, Math.min(1, (b - c) / a));
  }
  const c1 = add(p1, mul(d1, s)),
    c2 = add(p2, mul(d2, t));
  return { c1, c2, dist: Math.hypot(...sub(c1, c2)) };
}

export class Swing {
  constructor() {
    this.time = SWING;
    this.tool = null;
    this.hit = false;
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.v = new THREE.Vector3();
  }
  get busy() {
    return this.time < SWING;
  }
  start(tool) {
    if (this.busy) return false;
    Object.assign(this, { time: 0, tool, hit: false });
    return true;
  }

  // the blade in camera space at a moment of the swing: its tip, and the far end of its edge (toward the haft).
  // The axe swings level, from the right across to the left, at the height you look at (a felling cut); the
  // pickaxe comes down from over the shoulder.
  blade(s) {
    const u = Math.max(0, Math.min(1, (s - STRIKE[0]) / (STRIKE[1] - STRIKE[0])));
    if (this.tool === 'axe') {
      const th = 1.25 - u * 2.3,
        R = 1.25;
      const pivot = [0.2, -0.15, 0.1];
      const at = (k) => add(pivot, [k * Math.sin(th), 0.04 * k, -k * Math.cos(th)]);
      // the edge stands upright on the blade's head
      const tip = at(R);
      return { tip, inner: add(tip, [0, 0.18, 0]) };
    }
    const th = 1.3 - u * 2.6,
      R = 1.35; // from high over the shoulder, down in front, to the ground before your feet
    const pivot = [0.2 - 0.18 * u, -0.3, 0];
    const at = (k) => add(pivot, [0, k * Math.sin(th), -k * Math.cos(th)]);
    return { tip: at(R), inner: at(R - 0.08) };
  }

  // the tool in the hand at this moment, for its picture: lifted (x) and swung round (y), radians
  pose() {
    const l = this.lift();
    return this.tool === 'axe' ? [0.25 * Math.abs(l), l * 1.1] : [l, 0];
  }

  lift() {
    const s = this.time,
      sm = (x) => x * x * (3 - 2 * x);
    if (s >= SWING) return 0;
    if (this.hit) return this.stopAt * (1 - sm(Math.min(1, (s - this.stopTime) / (SWING - this.stopTime))));
    if (s < STRIKE[0]) return sm(s / STRIKE[0]) * 0.95;
    if (s < STRIKE[1]) return 0.95 - sm((s - STRIKE[0]) / (STRIKE[1] - STRIKE[0])) * 1.9;
    return -0.95;
  }

  /**
   * One physics step of a swing: where the blade went, and the first thing it met.
   * @returns {null | {kind: 'wood', owner, point, strength} | {kind: 'ground', point, mat, strength}}
   */
  step(dt, player, world, wood) {
    if (!this.busy) return null;
    const s0 = this.time;
    this.time += dt;
    if (this.hit || this.time < STRIKE[0] || s0 > STRIKE[1]) return null;
    // the blade, now and a step ago, in the world
    // (the pickaxe follows where you look only half way: it comes down in front of you, to the ground)
    this.e.set(this.tool === 'pick' ? player.pitch * 0.5 : player.pitch, player.yaw, 0);
    this.q.setFromEuler(this.e);
    const eye = [player.x, player.eyeY, player.z];
    const toWorld = (p) => {
      this.v.set(p[0], p[1], p[2]).applyQuaternion(this.q);
      return [eye[0] + this.v.x, eye[1] + this.v.y, eye[2] + this.v.z];
    };
    const was = this.blade(s0),
      now = this.blade(this.time);
    const a = toWorld(was.tip),
      tip = toWorld(now.tip),
      inner = toWorld(now.inner);
    const path = norm(sub(tip, a));
    const speed = Math.hypot(...sub(tip, a)) / dt;
    const power = Math.min(1.2, speed / 9);

    // wood: rooted trees nearby, and fallen pieces (tested in their own coordinates)
    let best = null;
    const test = (owner, segs, P, T, I, axisDir) => {
      for (const sg of segs) {
        for (const [p, q] of [
          [I, T],
          [P, T],
        ]) {
          const r = segSeg(p, q, sg.a, sg.b);
          if (r.dist < sg.r + 0.04 && (!best || r.dist - sg.r < best.d)) {
            const ax = norm(sub(sg.b, sg.a));
            const grain = 1 - Math.abs(dot(axisDir, ax)); // straight across the grain cuts best
            const out = norm(sub(r.c1, r.c2));
            best = { d: r.dist - sg.r, owner, local: add(r.c2, mul(out, sg.r)), strength: power * (0.35 + 0.65 * grain) };
          }
        }
      }
    };
    for (const t of world.trees) {
      if ((t.state !== 'standing' && t.state !== 'active') || Math.abs(t.x - player.x) > 6 || Math.abs(t.z - player.z) > 6) continue;
      const segs = [];
      for (const w of t.wood) if (!w.gone) segs.push(...segmentsOf(w));
      if (t.kind === 'bush') for (const l of t.leaves) segs.push({ a: l.c, b: l.c, r: l.r * 0.7 });
      test(t, segs, a, tip, inner, path);
    }
    for (const pc of wood.pieces) {
      const c = pc.body.translation();
      if (Math.abs(c.x - player.x) > 7 || Math.abs(c.z - player.z) > 7) continue;
      const segs = [];
      for (const w of pc.wood.wood) if (!w.gone) segs.push(...segmentsOf(w));
      const before = best;
      const P = wood.toLocal(pc, a),
        T = wood.toLocal(pc, tip),
        I = wood.toLocal(pc, inner);
      test(pc, segs, P, T, I, norm(sub(T, P)));
      if (best !== before) best.point = wood.toWorld(pc, best.local);
    }
    if (best) {
      best.point ||= best.local;
      this.stop();
      return { kind: 'wood', owner: best.owner, point: best.point, strength: best.strength };
    }
    // the ground: along the tip's path, where it first goes in
    for (let k = 1; k <= 5; k++) {
      const p = add(a, mul(sub(tip, a), k / 5));
      if (world.sample(...p) > 0) {
        let lo = (k - 1) / 5,
          hi = k / 5;
        for (let n = 0; n < 6; n++) {
          const m = (lo + hi) / 2;
          if (world.sample(...add(a, mul(sub(tip, a), m))) > 0) hi = m;
          else lo = m;
        }
        const point = add(a, mul(sub(tip, a), hi));
        this.stop();
        return { kind: 'ground', point, mat: world.matAt(...point), strength: power, hard: [STONE, GRAVEL].includes(world.matAt(...point)) };
      }
    }
    if (this.time >= STRIKE[1]) this.stop(); // through air: nothing met
    return null;
  }

  // the blade has met something (or gone through air): from here the tool swings back
  stop() {
    this.stopAt = this.lift();
    this.hit = true;
    this.stopTime = this.time;
  }
}
