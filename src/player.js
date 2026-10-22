// The player: an upright body 0.6 wide and 1.75 tall that walks up slopes, climbs small ledges, jumps and swims in
// the smooth ground; and the ray from the eye that finds what is looked at (ground, a tree, a crystal, a lantern).
import { SIZE, HEIGHT, WATER_Y } from './world.js';

const R = 0.3, // the body's radius
  TALL = 1.75,
  EYE = 1.6;

// how far a point is from the segment a..b
function segDist(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

const RING = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.cos((k * Math.PI) / 4) * R, Math.sin((k * Math.PI) / 4) * R]);

export class Player {
  constructor(world) {
    this.world = world;
    this.x = world.spawn[0];
    this.y = world.spawn[1];
    this.z = world.spawn[2];
    this.vx = this.vy = this.vz = 0;
    this.yaw = Math.atan2(SIZE / 2 - this.x, SIZE / 2 - this.z); // facing away from the middle, out to sea
    this.pitch = -0.1;
    this.onGround = false;
    this.inWater = false;
    this.near = []; // trees close by, gathered each moment
  }

  get eyeY() {
    return this.y + EYE;
  }

  // whether the body, standing at (x, y, z), is inside the ground or a tree trunk (its feet not counted)
  bodyHits(x, y, z) {
    const w = this.world;
    for (const h of [0.4, 0.95, 1.55])
      for (const [dx, dz] of RING) if (w.solid(x + dx, y + h, z + dz)) return true;
    // trunks (and stumps, up to where they were cut): at three heights of the body, how far from the trunk's middle
    for (const tr of this.near) {
      const top = tr.state === 'stump' ? tr.cutY : Infinity;
      for (const s of tr.segs) {
        if (!s.trunk) continue;
        for (const h of [y + 0.3, y + 1.0, y + 1.6]) {
          const lo = Math.min(s.a[1], s.b[1]),
            hi = Math.min(Math.max(s.a[1], s.b[1]), top);
          if (h < lo || h > hi) continue;
          const f = (h - s.a[1]) / (s.b[1] - s.a[1] || 1);
          if (Math.hypot(x - (s.a[0] + (s.b[0] - s.a[0]) * f), z - (s.a[2] + (s.b[2] - s.a[2]) * f)) < s.r + R) return true;
        }
      }
    }
    return false;
  }

  feetHit(x, y, z) {
    const w = this.world;
    if (w.solid(x, y, z)) return true;
    for (const [dx, dz] of RING) if (w.solid(x + dx * 0.6, y, z + dz * 0.6)) return true;
    return false;
  }

  /**
   * One step of moving.
   * @param {number} dt seconds
   * @param {{x: number, z: number, jump: boolean, sprint: boolean}} input the wish to move, -1..1, relative to where
   *   the player faces (z forward)
   */
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    this.near = this.world.trees.filter((t) => (t.state === 'standing' || t.state === 'chopping' || t.state === 'stump') && Math.abs(t.x - this.x) < 5 && Math.abs(t.z - this.z) < 5);
    this.inWater = this.y + 0.5 < WATER_Y;
    const speed = this.inWater ? 3.2 : input.sprint ? 6.4 : 4.6;
    const sin = Math.sin(this.yaw),
      cos = Math.cos(this.yaw);
    const wx = (input.x * cos - input.z * sin) * speed,
      wz = (-input.x * sin - input.z * cos) * speed;
    const grip = this.onGround ? 14 : this.inWater ? 5 : 3;
    this.vx += (wx - this.vx) * Math.min(1, grip * dt);
    this.vz += (wz - this.vz) * Math.min(1, grip * dt);

    if (this.inWater) {
      // in the water you sink slowly, and swim up while jump is held
      const want = input.jump ? 3.8 : -1.6;
      this.vy += (want - this.vy) * Math.min(1, 4 * dt);
    } else {
      this.vy -= 26 * dt;
      if (input.jump && this.onGround) this.vy = 8.2;
      this.vy = Math.max(-40, this.vy);
    }

    let blocked = false;
    const steps = Math.max(1, Math.ceil((Math.max(Math.hypot(this.vx, this.vz), Math.abs(this.vy)) * dt) / 0.12));
    const h = dt / steps;
    const wasGround = this.onGround;
    this.onGround = false;
    for (let s = 0; s < steps; s++) {
      // across: straight on, or up a slope or a small ledge, or sliding along a wall
      const mx = this.vx * h,
        mz = this.vz * h;
      if (mx || mz) {
        const climb = wasGround || this.inWater ? 0.12 + Math.hypot(mx, mz) * 1.7 : 0.05;
        const tryMove = (dx, dz) => {
          for (const up of [0, climb * 0.5, climb])
            if (!this.bodyHits(this.x + dx, this.y + up, this.z + dz)) {
              this.x += dx;
              this.z += dz;
              this.y += up;
              return true;
            }
          return false;
        };
        if (!tryMove(mx, mz)) {
          blocked = true;
          if (tryMove(mx, 0)) this.vz *= 0.5;
          else if (tryMove(0, mz)) this.vx *= 0.5;
        }
      }
      // up and down: land on the ground, lifted out of it if sunk in; bump the head
      const ny = this.y + this.vy * h;
      if (this.vy <= 0 && this.feetHit(this.x, ny, this.z)) {
        let lift = 0;
        while (lift < 1 && this.feetHit(this.x, ny + lift, this.z)) lift += 0.02;
        this.y = ny + lift;
        this.vy = 0;
        this.onGround = true;
      } else if (this.vy > 0 && this.world.solid(this.x, ny + TALL, this.z)) {
        this.vy = 0;
      } else this.y = ny;
    }
    // resting on the ground counts as standing on it
    if (!this.onGround && this.vy <= 0 && this.feetHit(this.x, this.y - 0.05, this.z)) this.onGround = true;

    // walking into a ledge too high to step up jumps it (so touch players need not jump at every one)
    const wants = Math.abs(input.x) + Math.abs(input.z) > 0.1;
    if (blocked && wants && (this.onGround || this.inWater)) {
      const l = Math.hypot(wx, wz) || 1;
      if (!this.bodyHits(this.x + (wx / l) * 0.5, this.y + 1.2, this.z + (wz / l) * 0.5)) this.vy = this.inWater ? 6.5 : 7.6;
    }

    // the edge of the world is the open sea
    this.x = Math.max(0.5, Math.min(SIZE - 1.5, this.x));
    this.z = Math.max(0.5, Math.min(SIZE - 1.5, this.z));
    if (this.y < -5) Object.assign(this, { x: this.world.spawn[0], y: this.world.spawn[1] + 2, z: this.world.spawn[2], vy: 0 });
    this.y = Math.min(this.y, HEIGHT + 20);
  }

  dir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  /**
   * What the eye looks at within reach: walks along the ray in small steps, testing things first, then the ground.
   * @returns {{kind: 'ground'|'tree'|'crystal'|'lantern', point: number[], normal?: number[], thing?: object} | null}
   */
  target(reach = 6) {
    const w = this.world,
      d = this.dir(),
      o = [this.x, this.eyeY, this.z];
    const near = (x, z, r) => Math.abs(x - this.x) < reach + r && Math.abs(z - this.z) < reach + r;
    const things = [];
    for (const c of w.crystals) if (!c.found && near(c.x, c.z, 1)) things.push({ kind: 'crystal', thing: c, balls: [[c.x, c.y + 0.6, c.z, 0.7]] });
    for (const l of w.lanterns) if (near(l[0], l[2], 1)) things.push({ kind: 'lantern', thing: l, balls: [[l[0], l[1] + 0.6, l[2], 0.5]] });
    for (const t of w.trees) {
      if (!near(t.x, t.z, 7)) continue;
      if (t.state === 'standing' || t.state === 'chopping')
        things.push({ kind: 'tree', thing: t, balls: t.leaves.filter((l) => !l.nut).map((l) => [...l.c, l.r * 0.8]), segs: t.segs });
      else if (t.state === 'stump') things.push({ kind: 'tree', thing: t, balls: [[t.x, t.y + 0.3, t.z, t.wood[0].r[0] + 0.25]] });
    }
    let prev = 0;
    for (let t = 0.05; t <= reach; t += 0.05) {
      const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      for (const th of things) {
        const hit = th.balls.some(([x, y, z, r]) => Math.hypot(p[0] - x, p[1] - y, p[2] - z) < r) || (th.segs || []).some((s) => segDist(p, s.a, s.b) < s.r + 0.12);
        if (hit) return { kind: th.kind, thing: th.thing, point: p };
      }
      if (w.sample(p[0], p[1], p[2]) > 0) {
        // narrow down where the ray enters the ground
        let a = prev,
          b = t;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2;
          if (w.sample(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m) > 0) b = m;
          else a = m;
        }
        const q = [o[0] + d[0] * b, o[1] + d[1] * b, o[2] + d[2] * b];
        const e = 0.4;
        const n = [
          w.sample(q[0] - e, q[1], q[2]) - w.sample(q[0] + e, q[1], q[2]),
          w.sample(q[0], q[1] - e, q[2]) - w.sample(q[0], q[1] + e, q[2]),
          w.sample(q[0], q[1], q[2] - e) - w.sample(q[0], q[1], q[2] + e),
        ];
        const l = Math.hypot(...n) || 1;
        return { kind: 'ground', point: q, normal: n.map((v) => v / l) };
      }
      prev = t;
    }
    return null;
  }

  // whether a ball at c with radius r would reach into the player
  touches(c, r) {
    return segDist(c, [this.x, this.y, this.z], [this.x, this.y + TALL, this.z]) < r + R;
  }
}
