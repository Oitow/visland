// The player: a capsule 0.6 wide and 1.75 tall (four balls stacked) that walks, slides, jumps and swims on the smooth
// ground; and the ray from the eye that finds what is looked at (ground, a tree, a crystal, a lantern).
//
// The physics runs in fixed steps of 1/60 s, whatever the frame rate. In each step the body moves, then is pushed out
// of anything it sank into: the ground's field gives, at any point, about how far the surface is and which way is out
// (its value over the length of its slope, and the slope's direction), so each ball is pushed out by exactly as much
// as it is in. Ground flatter than 50° is stood on (pushed straight up, so you do not slide); steeper ground is a
// wall or a slide.
import { SIZE, HEIGHT, WATER_Y } from './world.js';

export const STEP = 1 / 60; // one physics step
const R = 0.3, // the body's radius
  TALL = 1.75,
  EYE = 1.6,
  BALLS = [R, 0.68, 1.07, TALL - R], // the balls' centres, above the feet
  WALKABLE = Math.cos((50 * Math.PI) / 180), // the steepest ground that can be stood on
  GRAVITY = 26,
  JUMP = 8.2;

// how far a point is from the segment a..b, and the nearest point on it
function nearestOnSeg(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}
function segDist(p, a, b) {
  const q = nearestOnSeg(p, a, b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

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
    this.airTime = 0; // how long since the feet last touched ground (a jump is still allowed just after a ledge)
    this.near = []; // trees close by
    this.prev = [this.x, this.y, this.z]; // where the last step began, for drawing in between steps
  }

  get eyeY() {
    return this.y + EYE;
  }

  // the ground near a point: how far its surface is (below 0 inside it) and which way is out
  surface(x, y, z) {
    const w = this.world,
      e = 0.12;
    const d = w.sample(x, y, z);
    const gx = (w.sample(x - e, y, z) - w.sample(x + e, y, z)) / (2 * e),
      gy = (w.sample(x, y - e, z) - w.sample(x, y + e, z)) / (2 * e),
      gz = (w.sample(x, y, z - e) - w.sample(x, y, z + e)) / (2 * e);
    const g = Math.hypot(gx, gy, gz);
    if (g < 1e-4) return { dist: -d, n: [0, 1, 0] }; // deep inside (or far away): out is up
    return { dist: -d / g, n: [gx / g, gy / g, gz / g] };
  }

  // the deepest place the body at (x, y, z) sinks into the ground or a trunk: how deep, and which way is out
  contact(x, y, z) {
    let best = null;
    for (const h of BALLS) {
      const s = this.surface(x, y + h, z);
      const pen = R - s.dist;
      if (pen > 0 && (!best || pen > best.pen)) best = { pen, n: s.n, ground: true };
    }
    // trunks, thick branches and fallen pieces: pushed out of each, the way out from its middle line
    for (const tr of this.near)
      for (const s of tr.segs) {
        if (!s.trunk) continue;
        for (const h of BALLS) {
          const c = [x, y + h, z],
            q = nearestOnSeg(c, s.a, s.b);
          const d = [c[0] - q[0], c[1] - q[1], c[2] - q[2]],
            dl = Math.hypot(...d) || 1e-6;
          const pen = R + s.r - dl;
          if (pen > 0 && (!best || pen > best.pen)) best = { pen, n: [d[0] / dl, d[1] / dl, d[2] / dl] };
        }
      }
    return best;
  }

  // whether the body would be inside something, standing at (x, y, z)
  bodyHits(x, y, z) {
    this.near = this.nearTrees(x, z);
    const c = this.contact(x, y, z);
    return !!c && c.pen > 0.04;
  }

  nearTrees(x, z) {
    const trees = this.world.trees.filter((t) => (t.state === 'standing' || t.state === 'active') && Math.abs(t.x - x) < 6 && Math.abs(t.z - z) < 6);
    return this.extra ? trees.concat(this.extra(x, z)) : trees;
  }

  // push the body out of whatever it is in, a few times over (one push can lead into another)
  resolve() {
    let ground = false,
      wall = false;
    for (let k = 0; k < 4; k++) {
      const c = this.contact(this.x, this.y, this.z);
      if (!c) break;
      const [nx, ny, nz] = c.n;
      if (ny > WALKABLE) {
        // ground to stand on: lift straight up, so standing on a slope does not slide you down it
        this.y += Math.min(0.6, c.pen / ny);
        if (this.vy < 0) this.vy = 0;
        ground = true;
      } else {
        this.x += nx * c.pen;
        this.y += ny * c.pen;
        this.z += nz * c.pen;
        // lose the speed going into the surface, keep the rest (so you slide along walls and down steep slopes)
        const vn = this.vx * nx + this.vy * ny + this.vz * nz;
        if (vn < 0) {
          this.vx -= nx * vn;
          this.vy -= ny * vn;
          this.vz -= nz * vn;
        }
        if (ny > -0.3 && c.ground) wall = true; // a wall of earth (not a trunk) may be jumped
      }
    }
    return { ground, wall };
  }

  /**
   * One physics step.
   * @param {number} dt seconds (STEP)
   * @param {{x: number, z: number, jump: boolean, sprint: boolean}} input the wish to move, -1..1, relative to where
   *   the player faces (z forward)
   */
  update(dt, input) {
    this.prev = [this.x, this.y, this.z];
    this.near = this.nearTrees(this.x, this.z);
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
      this.vy = Math.max(-40, this.vy - GRAVITY * dt);
      if (input.jump && this.airTime < 0.1 && this.vy <= 0.5) {
        this.vy = JUMP;
        this.airTime = 1;
      }
    }

    // move, in small enough pieces that nothing is passed through, pushing out after each
    const wasGround = this.onGround;
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy, this.vz) * dt) / (R * 0.6)));
    let ground = false,
      wall = false;
    for (let s = 0; s < steps; s++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      this.z += (this.vz * dt) / steps;
      const r = this.resolve();
      ground ||= r.ground;
      wall ||= r.wall;
    }
    // walking down a slope or over a bump: stay on the ground instead of hopping off it
    if (!ground && wasGround && this.vy <= 0 && !this.inWater) {
      const y0 = this.y;
      this.y -= 0.3;
      if (this.resolve().ground) ground = true;
      else this.y = y0;
    }
    this.onGround = ground;
    this.airTime = ground ? 0 : this.airTime + dt;

    // walking into a ledge too high to walk up jumps it (so touch players need not jump at every one)
    const wants = Math.abs(input.x) + Math.abs(input.z) > 0.1;
    if (wall && wants && (ground || this.inWater) && this.vy <= 0.5) {
      const l = Math.hypot(wx, wz) || 1;
      if (!this.bodyHits(this.x + (wx / l) * 0.45, this.y + 1.15, this.z + (wz / l) * 0.45)) this.vy = this.inWater ? 6.5 : 7.6;
      this.near = this.nearTrees(this.x, this.z);
    }

    // the edge of the world is the open sea
    this.x = Math.max(0.5, Math.min(SIZE - 1.5, this.x));
    this.z = Math.max(0.5, Math.min(SIZE - 1.5, this.z));
    if (this.y < -5) Object.assign(this, { x: this.world.spawn[0], y: this.world.spawn[1] + 2, z: this.world.spawn[2], vy: 0 });
    this.y = Math.min(this.y, HEIGHT + 20);
  }

  // where to draw the body: between the last step and this one, by how far the clock is into the next step
  drawn(alpha) {
    return [this.prev[0] + (this.x - this.prev[0]) * alpha, this.prev[1] + (this.y - this.prev[1]) * alpha, this.prev[2] + (this.z - this.prev[2]) * alpha];
  }

  // jump straight to a place (no drawing in between)
  place(x, y, z) {
    Object.assign(this, { x, y, z, vx: 0, vy: 0, vz: 0 });
    this.prev = [x, y, z];
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
      if (!near(t.x, t.z, 7) || (t.state !== 'standing' && t.state !== 'active')) continue;
      things.push({ kind: 'tree', thing: t, balls: t.leaves.filter((l) => !l.nut && !l.gone).map((l) => [...l.c, l.r * 0.8]), segs: t.segs });
    }
    for (const p of this.extra ? this.extra(this.x, this.z) : []) things.push({ kind: 'piece', thing: p.piece, balls: [], segs: p.segs });
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
