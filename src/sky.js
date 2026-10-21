// The sky and the day: the almanac's dayCycle gives the sky's colours and how much light there is; from it come the
// sun's and moon's places, the light on the land, the fog, twinkling stars and drifting voxel clouds.
import * as THREE from 'three';
import { dayCycle, twinkle } from '../vendor/almanac/light.js';
import { noiseTile, latticeRandom } from '../vendor/almanac/noise.js';
import { mixColour } from '../vendor/almanac/colour.js';
import { smoothstep } from '../vendor/almanac/numbers.js';
import { SeededRandom } from '../vendor/almanac/random.js';
import { U, skyMaterial, starMaterial, cloudMaterial } from './shaders.js';

const SKY = {
  night: ['#060a1c', '#1a2448'],
  dawn: ['#34488c', '#f2a473'],
  day: ['#3a7ed8', '#a9d9f2'],
  dusk: ['#2c357a', '#f0875a'],
};

const CLOUD_CELLS = 48,
  CLOUD_SIZE = 6,
  CLOUD_Y = 72,
  SPAN = CLOUD_CELLS * CLOUD_SIZE;

const c01 = (c) => c.map((v) => v / 255);

export class Sky {
  constructor(scene, seed) {
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), skyMaterial());
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // stars: fixed on a sphere that turns with the night
    const rng = new SeededRandom(seed + 1),
      n = 600,
      pts = new Float32Array(n * 3);
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = rng.range(-1, 1),
        a = rng.range(0, Math.PI * 2),
        r = Math.sqrt(1 - u * u);
      pts.set([Math.cos(a) * r * 380, u * 380, Math.sin(a) * r * 380], i * 3);
      this.phase[i] = rng.range(0, Math.PI * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.bright = new THREE.BufferAttribute(new Float32Array(n), 1);
    g.setAttribute('aBright', this.bright);
    this.starMat = starMaterial();
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // clouds: the almanac's noiseTile tiles, so one field repeated round the player drifts for ever without a seam
    this.cloudMat = cloudMaterial();
    const geo = cloudGeometry(seed);
    this.clouds = [];
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const m = new THREE.Mesh(geo, this.cloudMat);
        m.userData.offset = [a, b];
        m.frustumCulled = false;
        m.renderOrder = 5;
        scene.add(m);
        this.clouds.push(m);
      }
    this.day = null;
  }

  // set everything for the time of day t (0 midnight, 0.25 dawn, 0.5 noon, 0.75 dusk)
  update(t, time, camera, underwater) {
    const day = dayCycle(SKY, t);
    this.day = day;
    const a = (t - 0.25) * Math.PI * 2;
    const sun = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.35).normalize();
    const moon = sun.clone().negate();
    U.uSun.value.copy(sun);
    U.uMoon.value.copy(moon);
    U.uTime.value = time;
    U.uLight.value = day.light;
    U.uSkyTop.value.setRGB(...c01(day.top));
    U.uSkyHorizon.value.setRGB(...c01(day.horizon));

    // the light on the land: the sun (warm when low), or the moon's faint blue at night
    const sunUp = smoothstep(-0.04, 0.3, sun.y),
      moonUp = smoothstep(-0.04, 0.3, moon.y);
    if (sun.y >= moon.y) {
      U.uSunDir.value.copy(sun);
      const warm = smoothstep(0.0, 0.45, sun.y);
      U.uSunColor.value.setRGB(0.75 * sunUp, (0.5 + 0.22 * warm) * sunUp, (0.32 + 0.4 * warm) * sunUp);
    } else {
      U.uSunDir.value.copy(moon);
      U.uSunColor.value.setRGB(0.16 * moonUp, 0.2 * moonUp, 0.32 * moonUp);
    }
    const amb = mixColour([0.2, 0.23, 0.38], [0.48, 0.52, 0.6], day.light);
    U.uAmbient.value.setRGB(...amb);
    U.uGlowColor.value.setRGB(1.0, 0.7, 0.38).multiplyScalar(0.3 + 0.9 * day.night);

    if (underwater) {
      U.uFogColor.value.setRGB(0.05, 0.28, 0.4).multiplyScalar(0.35 + 0.65 * day.light);
      U.uFogNear.value = 0;
      U.uFogFar.value = 26;
    } else {
      U.uFogColor.value.copy(U.uSkyHorizon.value);
      U.uFogNear.value = 60;
      U.uFogFar.value = 190;
    }

    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.stars.rotation.z = a;
    this.starMat.uniforms.uNight.value = smoothstep(0.35, 0.9, day.night);
    this.starMat.uniforms.uScale.value = Math.min(window.devicePixelRatio || 1, 2);
    for (let i = 0; i < this.phase.length; i++) this.bright.array[i] = twinkle(time, this.phase[i], 0.45);
    this.bright.needsUpdate = true;

    // clouds drift with the wind and take the sky's light
    const cl = mixColour([0.24, 0.27, 0.4], [1, 1, 1], day.light);
    const dusk = mixColour(cl, c01(day.horizon), 0.25);
    this.cloudMat.uniforms.uCloud.value.setRGB(...dusk);
    const shift = (time * 1.6) % SPAN;
    const bx = Math.round((camera.position.x - shift) / SPAN) * SPAN + shift,
      bz = Math.round(camera.position.z / SPAN) * SPAN;
    for (const m of this.clouds) {
      const [ox, oz] = m.userData.offset;
      m.position.set(bx + ox * SPAN - SPAN / 2, CLOUD_Y, bz + oz * SPAN - SPAN / 2);
    }
    return day;
  }
}

// one field of clouds: a box per cell where the tiling noise is high, with the faces between boxes left out
function cloudGeometry(seed) {
  const field = noiseTile(CLOUD_CELLS, 8, (x, y) => latticeRandom(x, y, seed + 40));
  const on = (i, j) => field[((j + CLOUD_CELLS) % CLOUD_CELLS) * CLOUD_CELLS + ((i + CLOUD_CELLS) % CLOUD_CELLS)] > 0.6;
  const pos = [],
    nor = [];
  const quad = (p, n) => {
    for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...p[k]);
    for (let k = 0; k < 6; k++) nor.push(...n);
  };
  const S = CLOUD_SIZE,
    H = 4;
  for (let j = 0; j < CLOUD_CELLS; j++)
    for (let i = 0; i < CLOUD_CELLS; i++) {
      if (!on(i, j)) continue;
      const x = i * S,
        z = j * S;
      quad([[x, H, z + S], [x + S, H, z + S], [x + S, H, z], [x, H, z]], [0, 1, 0]);
      quad([[x, 0, z], [x + S, 0, z], [x + S, 0, z + S], [x, 0, z + S]], [0, -1, 0]);
      if (!on(i + 1, j)) quad([[x + S, 0, z + S], [x + S, 0, z], [x + S, H, z], [x + S, H, z + S]], [1, 0, 0]);
      if (!on(i - 1, j)) quad([[x, 0, z], [x, 0, z + S], [x, H, z + S], [x, H, z]], [-1, 0, 0]);
      if (!on(i, j + 1)) quad([[x, 0, z + S], [x + S, 0, z + S], [x + S, H, z + S], [x, H, z + S]], [0, 0, 1]);
      if (!on(i, j - 1)) quad([[x + S, 0, z], [x, 0, z], [x, H, z], [x + S, H, z]], [0, 0, -1]);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
