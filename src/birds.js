// Seabirds: a flock steered by the almanac's flockStep (boids) over the island, flapping as they go and scattering
// when the player comes near.
import * as THREE from 'three';
import { flockStep } from '../vendor/almanac/motion.js';
import { SeededRandom } from '../vendor/almanac/random.js';
import { SIZE } from './world.js';

export class Birds {
  constructor(scene, seed) {
    const rng = new SeededRandom(seed + 77);
    this.agents = [];
    this.meshes = [];
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const body = new THREE.BoxGeometry(0.35, 0.3, 0.9),
      wing = new THREE.BoxGeometry(1.1, 0.08, 0.45);
    wing.translate(0.55, 0, 0);
    for (let i = 0; i < 14; i++) {
      this.agents.push({
        x: SIZE / 2 + rng.range(-20, 20),
        y: SIZE / 2 + rng.range(-20, 20),
        vx: rng.range(-3, 3),
        vy: rng.range(-3, 3),
        speed: rng.range(0.85, 1.15),
        seed: rng.range(0, 6.28),
        h: rng.range(30, 40),
      });
      const g = new THREE.Group();
      g.add(new THREE.Mesh(body, this.mat));
      const l = new THREE.Mesh(wing, this.mat),
        r = new THREE.Mesh(wing, this.mat);
      r.rotation.y = Math.PI;
      g.add(l, r);
      g.userData = { l, r, flap: rng.range(0, 6) };
      scene.add(g);
      this.meshes.push(g);
    }
  }

  update(dt, time, player, day) {
    this.agents = flockStep(this.agents, dt, {
      cohesion: 0.12,
      alignment: 0.6,
      separation: { within: 3, push: 6 },
      speed: [4, 8],
      band: { from: 25, to: SIZE - 25, pull: 0.4 },
      keepCentre: { origin: 0, from: 40, to: SIZE - 40, pull: 0.3 },
      wander: { t: time, rate: [0.3, 0.23], amount: [1.5, 1.5] },
      flee: Math.hypot(player.x - this.flockX(), player.z - this.flockZ()) < 14 ? { x: player.x, y: player.z, push: 12 } : undefined,
    });
    const c = 0.15 + 0.75 * day.light;
    this.mat.color.setRGB(c, c, c * 1.02);
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i],
        g = this.meshes[i];
      g.position.set(a.x, a.h + Math.sin(time * 0.7 + a.seed) * 3, a.y);
      g.rotation.y = Math.atan2(a.vx, a.vy);
      const f = Math.sin(time * 9 * a.speed + g.userData.flap) * 0.6;
      g.userData.l.rotation.z = f;
      g.userData.r.rotation.z = f; // (the right wing is turned round, so the same angle lifts it too)
    }
  }

  flockX() {
    return this.agents.reduce((s, a) => s + a.x, 0) / this.agents.length;
  }
  flockZ() {
    return this.agents.reduce((s, a) => s + a.y, 0) / this.agents.length;
  }
}
