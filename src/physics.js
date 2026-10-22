// Rigid bodies, by Rapier (rapier.rs, a physics engine compiled to WebAssembly): pieces of trees that fall, roll,
// float and come to rest. The ground is given to it as the triangles of its meshes; bodies are built of capsules and
// balls. The player is not one of its bodies: player.js moves the player itself, against the same ground.

let R = null;

export async function loadPhysics() {
  const m = await import('rapier');
  R = m.default;
  await R.init();
  return new Physics();
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// collision groups: what each thing is (high 16 bits) and what it meets (low 16)
const GROUND = 1,
  PIECE = 2,
  TREE = 4;
const TREE_GROUPS = (TREE << 16) | PIECE;
export const NEW_PIECE = (PIECE << 16) | GROUND | PIECE;
export const PIECE_GROUPS = (PIECE << 16) | GROUND | PIECE | TREE;

// the turn that takes the y axis onto the unit vector v (Rapier's capsules stand along y)
function fromY(v) {
  const ax = [v[2], 0, -v[0]],
    s = Math.hypot(ax[0], ax[2]);
  if (s < 1e-6) return v[1] > 0 ? { x: 0, y: 0, z: 0, w: 1 } : { x: 1, y: 0, z: 0, w: 0 };
  const a = Math.acos(Math.max(-1, Math.min(1, v[1]))) / 2,
    k = Math.sin(a) / s;
  return { x: ax[0] * k, y: 0, z: ax[2] * k, w: Math.cos(a) };
}

export class Physics {
  constructor() {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.ground = new Map();
  }

  // a chunk's ground, as a fixed mesh of triangles (replacing what it was)
  setGround(key, position, index) {
    const old = this.ground.get(key);
    if (old) this.world.removeCollider(old, false);
    this.ground.delete(key);
    if (!index.length) return;
    const c = this.world.createCollider(R.ColliderDesc.trimesh(position, index).setFriction(0.9));
    this.ground.set(key, c);
  }

  /**
   * A body of capsules {a, b, r} and balls {c, r}, given round its own origin, placed at pos. Capsules are kept
   * within their segments (not rounded out past the ends), so pieces cut apart do not start inside each other.
   * @param {'dynamic'|'fixed'} kind
   * @param {number} groups what it is and what it meets (Rapier's collision groups: GROUND, PIECE, TREE)
   */
  body(pos, parts, kind = 'dynamic', groups = kind === 'fixed' ? TREE_GROUPS : NEW_PIECE) {
    const desc = (kind === 'fixed' ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic().setLinearDamping(0.15).setAngularDamping(0.5).setCcdEnabled(true)).setTranslation(pos[0], pos[1], pos[2]);
    const b = this.world.createRigidBody(desc);
    let n = 0;
    for (const p of parts) {
      let cd;
      if (p.b) {
        const d = sub(p.b, p.a),
          len = Math.hypot(...d);
        if (len < 0.02) continue;
        cd = R.ColliderDesc.capsule(Math.max(0.01, len / 2 - p.r), p.r)
          .setTranslation((p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2)
          .setRotation(fromY(d.map((v) => v / len)));
      } else cd = R.ColliderDesc.ball(p.r).setTranslation(p.c[0], p.c[1], p.c[2]);
      this.world.createCollider(cd.setDensity(p.density ?? 600).setFriction(0.8).setRestitution(0.05).setCollisionGroups(groups), b);
      n++;
    }
    if (!n) {
      this.world.removeRigidBody(b);
      return null;
    }
    return b;
  }

  // what a body meets, changed (a new piece meets trees only once it has left the one it came from)
  setGroups(body, groups) {
    for (let i = 0; i < body.numColliders(); i++) body.collider(i).setCollisionGroups(groups);
  }

  remove(body) {
    if (body) this.world.removeRigidBody(body);
  }

  step(dt) {
    this.world.timestep = dt;
    this.world.step();
  }

  clear() {
    this.world.free();
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.ground.clear();
  }
}
