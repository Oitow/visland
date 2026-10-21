// The player: a box 0.6 wide and 1.8 tall that walks, jumps, swims and bumps into blocks; and the ray from the eye
// that finds which block is looked at.
import { isSolid, BLOCKS } from './blocks.js';
import { SIZE, HEIGHT, WATER_Y } from './world.js';

const W = 0.3, // half the width
  TALL = 1.8,
  EYE = 1.62;

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
  }

  get eyeY() {
    return this.y + EYE;
  }

  // whether the box at (x, y, z) overlaps a solid block
  hits(x, y, z) {
    const w = this.world;
    for (let by = Math.floor(y); by <= Math.floor(y + TALL - 0.001); by++)
      for (let bz = Math.floor(z - W); bz <= Math.floor(z + W); bz++)
        for (let bx = Math.floor(x - W); bx <= Math.floor(x + W); bx++) if (isSolid(w.get(bx, by, bz))) return true;
    return false;
  }

  /**
   * One step of moving.
   * @param {number} dt seconds
   * @param {{x: number, z: number, jump: boolean, sprint: boolean}} input x and z: the wish to move, -1..1, relative
   *   to where the player faces (z forward)
   */
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    this.inWater = this.y + 0.4 < WATER_Y && this.y > -2;
    const speed = this.inWater ? 3.2 : input.sprint ? 6.4 : 4.6;
    const sin = Math.sin(this.yaw),
      cos = Math.cos(this.yaw);
    // forward is -z when yaw is 0 (as the camera looks)
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

    // move one axis at a time, so a wall stops one direction and not the others; in small steps, so a fast fall
    // never passes through a block
    let blocked = false;
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(this.vx), Math.abs(this.vy), Math.abs(this.vz)) * dt) / 0.3));
    const h = dt / steps;
    this.onGround = false;
    for (let s = 0; s < steps; s++) {
      const nx = this.x + this.vx * h;
      if (this.hits(nx, this.y, this.z)) {
        blocked = true;
        this.vx = 0;
      } else this.x = nx;
      const nz = this.z + this.vz * h;
      if (this.hits(this.x, this.y, nz)) {
        blocked = true;
        this.vz = 0;
      } else this.z = nz;
      const ny = this.y + this.vy * h;
      if (this.hits(this.x, ny, this.z)) {
        if (this.vy < 0) {
          this.y = Math.floor(ny) + 1; // stand on the block's top
          this.onGround = true;
        }
        this.vy = 0;
      } else this.y = ny;
    }

    // walking into a step one block high climbs it (so touch players need not jump at every ledge)
    const wants = Math.abs(input.x) + Math.abs(input.z) > 0.1;
    if (blocked && wants && (this.onGround || this.inWater) && !this.hits(this.x + Math.sign(wx) * 0.4, this.y + 1.05, this.z + Math.sign(wz) * 0.4))
      this.vy = this.inWater ? 6.5 : 8.2;

    // the edge of the world is the open sea
    this.x = Math.max(0.5, Math.min(SIZE - 0.5, this.x));
    this.z = Math.max(0.5, Math.min(SIZE - 0.5, this.z));
    if (this.y < -10) Object.assign(this, { x: this.world.spawn[0], y: this.world.spawn[1] + 2, z: this.world.spawn[2], vy: 0 });
    this.y = Math.min(this.y, HEIGHT + 20);
  }

  // where the eye looks
  dir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  /**
   * The first block the eye's ray meets within reach (Amanatides and Woo's grid walk): the block, and the empty cell
   * just before it (where a new block would go).
   * @returns {{x: number, y: number, z: number, px: number, py: number, pz: number, block: number} | null}
   */
  target(reach = 6) {
    const [dx, dy, dz] = this.dir();
    let x = this.x,
      y = this.eyeY,
      z = this.z;
    let ix = Math.floor(x),
      iy = Math.floor(y),
      iz = Math.floor(z);
    const sx = Math.sign(dx),
      sy = Math.sign(dy),
      sz = Math.sign(dz);
    const tdx = Math.abs(1 / dx),
      tdy = Math.abs(1 / dy),
      tdz = Math.abs(1 / dz);
    let tx = (sx > 0 ? ix + 1 - x : x - ix) * tdx,
      ty = (sy > 0 ? iy + 1 - y : y - iy) * tdy,
      tz = (sz > 0 ? iz + 1 - z : z - iz) * tdz;
    let px = ix,
      py = iy,
      pz = iz,
      t = 0;
    while (t <= reach) {
      const b = this.world.get(ix, iy, iz);
      if (b && BLOCKS[b].solid) return { x: ix, y: iy, z: iz, px, py, pz, block: b };
      px = ix;
      py = iy;
      pz = iz;
      if (tx < ty && tx < tz) {
        ix += sx;
        t = tx;
        tx += tdx;
      } else if (ty < tz) {
        iy += sy;
        t = ty;
        ty += tdy;
      } else {
        iz += sz;
        t = tz;
        tz += tdz;
      }
    }
    return null;
  }

  // whether a block at (x, y, z) would be inside the player
  overlaps(x, y, z) {
    return x + 1 > this.x - W && x < this.x + W && z + 1 > this.z - W && z < this.z + W && y + 1 > this.y && y < this.y + TALL;
  }
}
