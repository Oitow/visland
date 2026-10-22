// From arrays of numbers to three.js: geometry for what flora.js and surfacenets.js build (here or in the worker),
// the meshes of crystals and lanterns, and the leaves' picture, painted on a canvas.
import * as THREE from 'three';
import { SeededRandom } from '../vendor/almanac/random.js';
import { crystalGeometry, lanternGeometry } from './flora.js';

/** Geometry from typed arrays by attribute name (and an index, if there is one); null stays null. */
export function geo(arrays) {
  if (!arrays) return null;
  const g = new THREE.BufferGeometry();
  const size = { position: 3, normal: 3, aColor: 3, aLight: 3, aSway: 1, uv: 2 };
  for (const [name, n] of Object.entries(size)) if (arrays[name]) g.setAttribute(name, new THREE.BufferAttribute(arrays[name], n));
  if (arrays.index) g.setIndex(new THREE.BufferAttribute(arrays.index, 1));
  g.computeBoundingSphere();
  return g;
}

export function crystalMesh(material, id) {
  return new THREE.Mesh(geo(crystalGeometry(id)), material);
}

export function lanternMesh(material, glowMaterial) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo(lanternGeometry()), material));
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.3), glowMaterial);
  core.position.y = 0.77;
  g.add(core);
  return g;
}

/** The leaf atlas: four 128-pixel tiles, white leaves (the tree's colour is laid over them) on transparent ground. */
export function leafAtlas() {
  const T = 128,
    c = document.createElement('canvas');
  c.width = T * 4;
  c.height = T;
  const g = c.getContext('2d');
  const rng = new SeededRandom(4242);
  const shade = (k) => `rgb(${Math.round(255 * k)},${Math.round(255 * k)},${Math.round(255 * k)})`;
  const leaf = (x, y, len, wid, a, k) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = shade(k);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(wid, len * 0.45, 0, len);
    g.quadraticCurveTo(-wid, len * 0.45, 0, 0);
    g.fill();
    g.strokeStyle = shade(k * 0.72);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 1);
    g.lineTo(0, len * 0.9);
    g.stroke();
    g.restore();
  };
  // broad leaves: a heap, denser and lighter toward the middle
  for (let i = 0; i < 70; i++) {
    const a = rng.range(0, 6.28),
      d = Math.sqrt(rng.next()) * 48;
    leaf(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rng.range(15, 22), rng.range(5, 8), rng.range(0, 6.28), rng.range(0.62, 1) * (1 - d / 160));
  }
  // birch: small round leaves, scattered thinner
  for (let i = 0; i < 70; i++) {
    const a = rng.range(0, 6.28),
      d = Math.sqrt(rng.next()) * 52;
    leaf(T + 64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rng.range(9, 13), rng.range(4, 6), rng.range(0, 6.28), rng.range(0.7, 1));
  }
  // needles: twigs with needles in pairs along them
  g.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const x0 = 2 * T + rng.range(14, 114),
      y0 = rng.range(14, 114),
      a = rng.range(0, 6.28),
      len = rng.range(24, 44);
    g.strokeStyle = shade(0.55);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
    g.stroke();
    g.lineWidth = 1.6;
    for (let s = 2; s < len; s += 3)
      for (const side of [-1, 1]) {
        const px = x0 + Math.cos(a) * s,
          py = y0 + Math.sin(a) * s,
          na = a + side * 0.9;
        g.strokeStyle = shade(rng.range(0.7, 1));
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(na) * 9, py + Math.sin(na) * 9);
        g.stroke();
      }
  }
  // a palm frond: a rib down the middle, leaflets slanting out on both sides (v runs along the frond)
  g.strokeStyle = shade(0.7);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(3 * T + 64, 0);
  g.lineTo(3 * T + 64, T);
  g.stroke();
  g.lineWidth = 3;
  for (let y = 2; y < T; y += 5)
    for (const side of [-1, 1]) {
      g.strokeStyle = shade(rng.range(0.72, 1));
      g.beginPath();
      g.moveTo(3 * T + 64, y);
      g.lineTo(3 * T + 64 + side * rng.range(52, 62), y + 16);
      g.stroke();
    }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

