// Small bits that fly and fall: wood chips from the axe, leaves shaken loose when a tree lands, dust. One instanced
// mesh of little flat squares, each with its own speed, spin and time to live.
import * as THREE from 'three';

const MAX = 400;

export class Particles {
  constructor(scene) {
    this.mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 6;
    this.list = [];
    this.o = new THREE.Object3D();
    this.c = new THREE.Color();
    scene.add(this.mesh);
  }

  /**
   * @param {number[]} p where
   * @param {number[]} v its speed
   * @param {number[]} color [r, g, b] 0..1
   * @param {{size?: number, life?: number, drag?: number, gravity?: number}} [o] leaves: high drag, low gravity
   */
  spawn(p, v, color, o = {}) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({ p: [...p], v: [...v], color, size: o.size ?? 0.08, life: o.life ?? 1, age: 0, drag: o.drag ?? 0.5, gravity: o.gravity ?? 14, spin: [Math.random() * 6, Math.random() * 6, Math.random() * 6], flutter: Math.random() * 6 });
  }

  update(dt, light) {
    this.list = this.list.filter((q) => (q.age += dt) < q.life);
    const o = this.o;
    this.list.forEach((q, i) => {
      q.v[1] -= q.gravity * dt;
      const k = Math.exp(-q.drag * dt);
      q.v[0] *= k;
      q.v[1] *= k;
      q.v[2] *= k;
      // falling leaves drift from side to side
      const drift = q.drag > 2 ? Math.sin(q.age * 5 + q.flutter) * 0.6 : 0;
      q.p[0] += (q.v[0] + drift) * dt;
      q.p[1] += q.v[1] * dt;
      q.p[2] += q.v[2] * dt;
      o.position.set(...q.p);
      o.rotation.set(q.spin[0] + q.age * 6, q.spin[1] + q.age * 4, q.spin[2]);
      o.scale.setScalar(q.size * Math.min(1, (q.life - q.age) * 4));
      o.updateMatrix();
      this.mesh.setMatrixAt(i, o.matrix);
      this.mesh.setColorAt(i, this.c.setRGB(...q.color));
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const l = 0.3 + 0.7 * light;
    this.mat.color.setRGB(l, l, l);
  }
}
