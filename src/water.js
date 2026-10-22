// The sea: one wide surface at the water's height. How deep it is under each point comes from a small texture of the
// sea floor, kept up to date when the player digs or builds under the water.
import * as THREE from 'three';
import { SIZE, WATER_Y } from './world.js';
import { waterMaterial } from './shaders.js';

export class Water {
  constructor(scene, world) {
    this.world = world;
    this.data = new Uint8Array(SIZE * SIZE * 4);
    this.texture = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) this.column(x, z);
    this.texture.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(1600, 1600);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, waterMaterial(this.texture, SIZE));
    this.mesh.position.set(SIZE / 2, WATER_Y, SIZE / 2);
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }

  // the depth at a column, 0 (at the surface or above it) to 1 (12 blocks down or more)
  column(x, z) {
    const floor = this.world.floorY(x, z);
    const depth = Math.max(0, Math.min(1, (WATER_Y - floor) / 12));
    this.data[(z * SIZE + x) * 4] = Math.round(depth * 255);
    this.data[(z * SIZE + x) * 4 + 3] = 255;
  }

  changed(x, z) {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return;
    this.column(x, z);
    this.texture.needsUpdate = true;
  }
}
