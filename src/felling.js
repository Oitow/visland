// Felling a tree, the way it goes in the woods: each blow of the axe cuts the notch deeper on the side you stand,
// the tree shudders; when the cut is through, it creaks and tips away from you, falling faster as it goes (a
// pendulum turned upside down), crashes down and shakes its leaves loose. Then it is gone, and logs lie where it
// fell, to be picked up. The stump stays; two more blows clear it.
import * as THREE from 'three';
import { dampedSpring } from '../vendor/almanac/bodies.js';
import { singleTreeGeometry, logGeometry } from './flora.js';
import { geo } from './meshes.js';

const FRESH = [0.86, 0.74, 0.54];
const REACH = 2.6; // how near the trunk you must stand to chop it

export class Felling {
  /**
   * @param {{scene, world, particles, sound, wood, leaves, treeChanged: function, give: function, say: function}} o
   *   wood and leaves: the materials; treeChanged(tree): its chunk's mesh must be made again; give(n): wood to carry;
   *   say(text): a short note on screen
   */
  constructor(o) {
    Object.assign(this, o);
    this.chops = new Map(); // tree -> { hits, need, dir, group, shake: [angle, speed] }
    this.falls = [];
    this.logs = [];
  }

  // how many blows a tree takes: more for a thicker trunk
  need(tree) {
    if (tree.kind === 'bush') return 1;
    if (tree.state === 'stump') return 2;
    return Math.max(3, Math.round(2 + tree.wood[0].r[0] * 12));
  }

  /** One blow of the axe at a tree. @returns {boolean} whether it landed */
  chop(tree, player) {
    const p = player;
    if (tree.kind === 'bush') {
      this.leafBurst(tree, tree.leaves.map((l) => l.c), 4);
      tree.state = 'gone';
      this.treeChanged(tree);
      this.sound.rustle();
      return true;
    }
    const r = tree.wood[0].r[0];
    if (Math.hypot(tree.x - p.x, tree.z - p.z) > r + REACH) {
      this.say('Geh näher an den Stamm');
      return false;
    }
    let c = this.chops.get(tree);
    if (!c) {
      // it will fall away from where you stand
      const dx = tree.x - p.x,
        dz = tree.z - p.z,
        l = Math.hypot(dx, dz) || 1;
      c = { hits: 0, need: this.need(tree), dir: [dx / l, 0, dz / l], group: null, shake: [0, 0] };
      this.chops.set(tree, c);
      if (tree.state === 'standing') {
        tree.state = 'chopping';
        tree.cutY = tree.y + 0.55;
        this.treeChanged(tree);
      }
    }
    c.hits++;
    this.sound.chop();
    // chips fly from the notch toward the player
    const at = [tree.x - c.dir[0] * r, (tree.cutY ?? tree.y + 0.4) + 0.05, tree.z - c.dir[2] * r];
    for (let i = 0; i < 9; i++)
      this.particles.spawn(at, [-c.dir[0] * 2.5 + (Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 2.5, -c.dir[2] * 2.5 + (Math.random() - 0.5) * 2.5], FRESH.map((v) => v * (0.85 + Math.random() * 0.25)), { size: 0.06 + Math.random() * 0.05, life: 0.8 });
    if (tree.state === 'stump') {
      if (c.hits >= c.need) {
        tree.state = 'gone';
        this.chops.delete(tree);
        this.treeChanged(tree);
        this.give(1);
        this.dust([tree.x, tree.y + 0.3, tree.z]);
      }
      return true;
    }
    c.shake[1] += 0.05 + 0.02 * c.hits;
    if (c.hits >= c.need) this.fall(tree, c);
    else this.rebuild(tree, c);
    return true;
  }

  // the tree on its own, with its notch as deep as the blows so far, pivoting at its foot
  rebuild(tree, c) {
    this.drop(c.group);
    const arrays = singleTreeGeometry(tree, { notch: { dir: c.dir, y: tree.cutY, depth: c.hits / c.need } });
    c.group = this.groupOf(arrays, [tree.x, tree.y, tree.z]);
  }

  groupOf(arrays, pivot) {
    const group = new THREE.Group();
    group.position.set(...pivot);
    for (const [g, m] of [
      [geo(arrays.wood), this.wood],
      [geo(arrays.leaves), this.leaves],
    ])
      if (g) {
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(-pivot[0], -pivot[1], -pivot[2]);
        mesh.frustumCulled = false;
        group.add(mesh);
      }
    this.scene.add(group);
    return group;
  }

  drop(group) {
    if (!group) return;
    this.scene.remove(group);
    group.traverse((o) => o.geometry?.dispose());
  }

  // cut through: the stump stays, the rest tips over away from the player
  fall(tree, c) {
    this.drop(c.group);
    this.chops.delete(tree);
    tree.state = 'stump';
    this.treeChanged(tree);
    const pivot = [tree.x, tree.cutY, tree.z];
    const group = this.groupOf(singleTreeGeometry(tree, { part: 'upper' }), pivot);
    // the axis it turns round: square to the way it falls, level
    const axis = new THREE.Vector3(c.dir[2], 0, -c.dir[0]).normalize();
    this.falls.push({ tree, group, axis, dir: c.dir, pivot, angle: 0.02, speed: 0.1, landed: false, rest: 0, timer: 0 });
    this.sound.creak();
  }

  update(dt, player) {
    // trees being chopped shudder at each blow
    for (const [tree, c] of this.chops) {
      [c.shake[0], c.shake[1]] = dampedSpring(c.shake[0], c.shake[1], 0, 140, 7, dt);
      if (c.group) c.group.quaternion.setFromAxisAngle(new THREE.Vector3(c.dir[2], 0, -c.dir[0]), c.shake[0] * 0.15);
    }
    for (const f of this.falls) {
      const t = f.tree;
      if (!f.landed) {
        // an upturned pendulum: the further it leans, the faster it goes
        f.speed += ((14 / Math.max(4, t.height)) * Math.sin(f.angle) + 0.1) * dt;
        f.angle += f.speed * dt;
        // has its crown met the ground?
        const reach = t.height * 0.75;
        const tip = [f.pivot[0] + f.dir[0] * Math.sin(f.angle) * reach, f.pivot[1] + Math.cos(f.angle) * reach, f.pivot[2] + f.dir[2] * Math.sin(f.angle) * reach];
        const ground = this.world.surfaceY(tip[0], tip[2]);
        if (tip[1] <= ground + 0.8 || f.angle >= Math.PI / 2) {
          f.landed = true;
          f.rest = f.angle;
          f.speed = -f.speed * 0.25; // it bounces a little
          this.sound.crash();
          this.leafBurst(t, t.leaves.map((l) => this.turned(f, l.c)), 2);
          this.dust(tip);
        }
      } else {
        [f.angle, f.speed] = dampedSpring(f.angle, f.speed, f.rest, 60, 6, dt);
        f.timer += dt;
        if (f.timer > 1.3) this.breakUp(f);
      }
      f.group.quaternion.setFromAxisAngle(f.axis, f.angle);
    }
    this.falls = this.falls.filter((f) => !f.done);

    // logs: picked up when the player comes near
    for (const l of this.logs) {
      l.age += dt;
      if (l.age > 0.5 && Math.hypot(l.p[0] - player.x, l.p[1] - (player.y + 0.6), l.p[2] - player.z) < 1.8) {
        l.done = true;
        this.scene.remove(l.mesh);
        l.mesh.geometry.dispose();
        this.give(l.amount);
        this.sound.pickup();
      }
    }
    this.logs = this.logs.filter((l) => !l.done);
  }

  // where a point of a falling tree is now
  turned(f, p) {
    const v = new THREE.Vector3(p[0] - f.pivot[0], p[1] - f.pivot[1], p[2] - f.pivot[2]).applyAxisAngle(f.axis, f.angle);
    return [v.x + f.pivot[0], v.y + f.pivot[1], v.z + f.pivot[2]];
  }

  // the fallen tree is gone; logs lie along where its trunk was
  breakUp(f) {
    f.done = true;
    this.drop(f.group);
    const t = f.tree;
    const trunkLen = Math.min(t.height * 0.7, 7),
      n = Math.max(2, Math.min(4, Math.round(trunkLen / 1.7)));
    const r = t.wood[0].r[0] * 0.8,
      total = 3 + Math.round(t.height / 2),
      each = Math.max(1, Math.round(total / n));
    const log = geo(logGeometry(1.1, r, t.kind));
    for (let i = 0; i < n; i++) {
      const d = 0.9 + i * (trunkLen / n);
      const x = f.pivot[0] + f.dir[0] * d,
        z = f.pivot[2] + f.dir[2] * d;
      const y = Math.max(this.world.surfaceY(x, z), 12.6) + r;
      const mesh = new THREE.Mesh(i ? log.clone() : log, this.wood);
      mesh.position.set(x, y, z);
      mesh.rotation.y = -Math.atan2(f.dir[2], f.dir[0]) + (Math.random() - 0.5) * 0.5;
      this.scene.add(mesh);
      this.logs.push({ mesh, p: [x, y, z], amount: each, age: 0 });
      this.dust([x, y, z]);
    }
    this.leafBurst(t, t.leaves.map((l) => this.turned(f, l.c)), 1);
  }

  leafBurst(tree, points, per) {
    const tint = tree.kind === 'pine' ? [0.2, 0.42, 0.28] : [0.32, 0.6, 0.24];
    for (const p of points.slice(0, 40))
      for (let k = 0; k < per; k++)
        this.particles.spawn(p.map((v) => v + (Math.random() - 0.5)), [(Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3], tint.map((v) => v * (0.8 + Math.random() * 0.4)), { size: 0.14, life: 2.2 + Math.random(), drag: 3, gravity: 2.5 });
  }

  dust(p) {
    for (let k = 0; k < 10; k++)
      this.particles.spawn([p[0] + (Math.random() - 0.5), p[1] + 0.2, p[2] + (Math.random() - 0.5)], [(Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2], [0.55, 0.47, 0.38], { size: 0.22, life: 1.2, drag: 2.5, gravity: 0.5 });
  }

  // when the island is left: everything of this felling goes from the scene
  clear() {
    for (const c of this.chops.values()) this.drop(c.group);
    for (const f of this.falls) this.drop(f.group);
    for (const l of this.logs) this.scene.remove(l.mesh);
    this.chops.clear();
    this.falls = [];
    this.logs = [];
  }
}
