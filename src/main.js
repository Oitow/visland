// Visland: an island grown from a seed, made only of code. This file ties it together: it grows the island,
// builds its meshes, runs the day, and turns the player's taps and keys into digging and building.
import * as THREE from 'three';
import { seedOf, seedWords } from '../vendor/almanac/seeds.js';
import { World, SIZE, CHUNK, WATER_Y, SEA } from './world.js';
import { STONE, DIRT, WOOD, LANTERN, DROP, MATERIALS, itemName } from './materials.js';
import { meshChunk } from './surfacenets.js';
import { treesGeometry, crystalMesh, lanternMesh, tuftGeometry } from './flora.js';
import { terrainMaterial, floraMaterial, tuftMaterial, glowMaterial, U } from './shaders.js';
import { Sky } from './sky.js';
import { Water } from './water.js';
import { Birds } from './birds.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Sound } from './sound.js';
import * as store from './save.js';

THREE.ColorManagement.enabled = false;

// words for seeds you can say out loud: "nebel-bucht-7"
const FIRST = ['bernstein', 'nebel', 'korallen', 'salz', 'moos', 'sturm', 'perlen', 'mond', 'sonnen', 'farn', 'glut', 'tang', 'kiesel', 'silber', 'wind', 'regen', 'feuer', 'eis', 'kristall', 'möwen', 'wal', 'muschel', 'lava', 'jade', 'zimt', 'honig', 'kupfer', 'schatten', 'sternen', 'dämmer', 'flut', 'gischt'];
const SECOND = ['bucht', 'riff', 'insel', 'klippe', 'strand', 'lagune', 'gipfel', 'hain', 'düne', 'fels', 'hafen', 'kap', 'atoll', 'quelle', 'tal', 'grotte', 'wald', 'ufer', 'horn', 'mulde', 'steig', 'eiland', 'sund', 'heide'];
const DAY_SECONDS = 480; // one whole day and night
const DIG_R = 1.25; // how big a ball one dig takes out
const BUILD_R = 1.1; // and one build heaps on
const START_INV = [
  [STONE, 24],
  [DIRT, 24],
  [LANTERN, 10],
];

const ui = new UI();
const sound = new Sound();
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, touch ? 1.25 : 1.75));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 700);
camera.rotation.order = 'YXZ';

const terrainMat = terrainMaterial();
const floraMat = floraMaterial();
const tuftMat = tuftMaterial();
const glowMat = glowMaterial();
const lanternGlow = new THREE.MeshBasicMaterial({ color: 0xffd27a });
const tuftGeos = { 2: tuftGeometry('#3f7f2c', '#9fd060'), 6: tuftGeometry('#8a7a36', '#e2cc78') };

// the ring that shows where a dig or a build will land
const ring = new THREE.Mesh(
  new THREE.RingGeometry(DIG_R - 0.12, DIG_R, 40),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
);
ring.visible = false;
ring.renderOrder = 12;
scene.add(ring);

// everything that belongs to one island
let game = null;

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function disposeIsland() {
  if (!game) return;
  for (const c of game.chunks.values())
    for (const m of [c.ground, c.trees, ...c.tufts]) {
      if (!m) continue;
      scene.remove(m);
      m.geometry.dispose();
    }
  for (const o of game.extras) scene.remove(o);
  for (const o of game.things.values()) scene.remove(o);
  game = null;
}

function growIsland(name) {
  disposeIsland();
  const seed = seedOf(name);
  const world = new World(seed);
  world.generate();
  const saved = store.load(seed);
  // the player's changes, laid again over the island as it grew
  for (const [kind, x, y, z, r, m] of saved?.ops || []) world.brush(x, y, z, r, kind === 'b', m);
  for (const id of saved?.trees || []) if (world.trees[id]) world.trees[id].removed = true;
  for (const id of saved?.found || []) if (world.crystals[id]) world.crystals[id].found = true;
  world.lanterns = saved?.lanterns || [];
  const g = {
    name,
    seed,
    world,
    ops: saved?.ops || [],
    chunks: new Map(),
    things: new Map(), // crystal and lantern meshes
    extras: [],
    inv: saved?.inv || START_INV.map((s) => [...s]),
    selected: 0,
    t: saved?.t ?? 0.3,
    time: 0,
    player: new Player(world),
    playing: false,
    saveTimer: 0,
  };
  if (saved?.pos) [g.player.x, g.player.y, g.player.z, g.player.yaw, g.player.pitch] = saved.pos;
  g.treesIn = new Map();
  for (const t of world.trees) {
    const k = Math.floor(t.x / CHUNK) + ',' + Math.floor(t.z / CHUNK);
    if (!g.treesIn.has(k)) g.treesIn.set(k, []);
    g.treesIn.get(k).push(t);
  }
  game = g;
  for (let cz = 0; cz < SIZE / CHUNK; cz++)
    for (let cx = 0; cx < SIZE / CHUNK; cx++) {
      remeshGround(g, cx, cz);
      remeshTrees(g, cx, cz);
    }
  for (const c of world.crystals) if (!c.found) addThing(g, c);
  for (const l of world.lanterns) addThing(g, l);
  g.water = new Water(scene, world);
  g.sky = new Sky(scene, seed);
  g.birds = new Birds(scene, seed);
  g.extras.push(g.water.mesh, g.sky.dome, g.sky.stars, ...g.sky.clouds, ...g.birds.meshes);
  // at night, a beam of light stands over every crystal not yet found
  g.beams = world.crystals.map((c) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 60, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    m.position.set(c.x, c.y + 30.5, c.z);
    m.userData.crystal = c;
    m.renderOrder = 11;
    scene.add(m);
    g.extras.push(m);
    return m;
  });
  ui.seedLabel.textContent = name;
  updateCrystals();
  refreshHotbar();
}

function chunkOf(g, cx, cz) {
  const k = cx + ',' + cz;
  if (!g.chunks.has(k)) g.chunks.set(k, { ground: null, trees: null, tufts: [] });
  return g.chunks.get(k);
}

function remeshGround(g, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= SIZE / CHUNK || cz >= SIZE / CHUNK) return;
  const c = chunkOf(g, cx, cz);
  const data = meshChunk(g.world, cx, cz);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(data.color, 3));
  geo.setAttribute('aLight', new THREE.BufferAttribute(data.light, 3));
  geo.setIndex(new THREE.BufferAttribute(data.index, 1));
  geo.computeBoundingSphere();
  if (c.ground) {
    c.ground.geometry.dispose();
    c.ground.geometry = geo;
  } else {
    c.ground = new THREE.Mesh(geo, terrainMat);
    scene.add(c.ground);
  }
  // grass grows again where the mesh says there is open meadow: three tufts round each spot
  for (const m of c.tufts) {
    scene.remove(m);
    m.dispose();
  }
  c.tufts = [];
  for (const kind of [2, 6]) {
    const spots = data.tufts.filter((s) => s[3] === kind);
    if (!spots.length) continue;
    const mesh = new THREE.InstancedMesh(tuftGeos[kind], tuftMat, spots.length * 3);
    const o = new THREE.Object3D();
    let i = 0;
    for (const [x, y, z, , v] of spots)
      for (let k = 0; k < 3; k++) {
        const a = (v * 40 + k * 2.1) % (Math.PI * 2);
        o.position.set(x + Math.cos(a) * 0.4, y - 0.08, z + Math.sin(a) * 0.4);
        o.rotation.set(0, a * 3, 0);
        o.scale.setScalar(0.8 + ((k * 0.37 + v * 3) % 0.5));
        o.updateMatrix();
        mesh.setMatrixAt(i++, o.matrix);
      }
    mesh.frustumCulled = false;
    scene.add(mesh);
    c.tufts.push(mesh);
  }
}

function remeshTrees(g, cx, cz) {
  const c = chunkOf(g, cx, cz);
  if (c.trees) {
    scene.remove(c.trees);
    c.trees.geometry.dispose();
    c.trees = null;
  }
  const geo = treesGeometry(g.treesIn.get(cx + ',' + cz) || []);
  if (geo) {
    c.trees = new THREE.Mesh(geo, floraMat);
    scene.add(c.trees);
  }
}

// a crystal ({x, y, z, id}) or a lantern ([x, y, z]) in the scene
function addThing(g, thing) {
  const m = Array.isArray(thing) ? lanternMesh(floraMat, lanternGlow) : crystalMesh(glowMat, thing.id);
  const [x, y, z] = Array.isArray(thing) ? thing : [thing.x, thing.y, thing.z];
  m.position.set(x, y - 0.1, z);
  scene.add(m);
  g.things.set(thing, m);
}

function removeThing(g, thing) {
  scene.remove(g.things.get(thing));
  g.things.delete(thing);
}

// the ground changed in a ball: mesh again every chunk it (or a light it holds) reaches, and the sea's depth there
function changed(x, y, z, r) {
  const g = game;
  for (let cx = Math.floor((x - r - 1) / CHUNK); cx <= Math.floor((x + r + 1) / CHUNK); cx++)
    for (let cz = Math.floor((z - r - 1) / CHUNK); cz <= Math.floor((z + r + 1) / CHUNK); cz++) remeshGround(g, cx, cz);
  const w = Math.ceil(Math.min(r, 3));
  for (let dz = -w; dz <= w; dz++) for (let dx = -w; dx <= w; dx++) g.water.changed(Math.round(x) + dx, Math.round(z) + dz);
  g.saveTimer = Math.min(g.saveTimer, 1);
}

function updateCrystals() {
  const c = game.world.crystals;
  ui.crystals.textContent = `◆ ${c.filter((k) => k.found).length}/${c.length}`;
}

function refreshHotbar() {
  ui.hotbarSet(game.inv, game.selected, (i) => select(i));
}

function select(i) {
  if (!game || i < 0 || i >= game.inv.length) return;
  game.selected = i;
  refreshHotbar();
  ui.nameShow(`${itemName(game.inv[i][0])} (${game.inv[i][1]})`);
}

function give(item, n = 1) {
  const slot = game.inv.find(([b]) => b === item);
  if (slot) slot[1] += n;
  else game.inv.push([item, n]);
  refreshHotbar();
}

const round2 = (v) => Math.round(v * 100) / 100;

function dig() {
  const g = game;
  if (!g?.playing) return;
  const hit = g.player.target();
  if (!hit) return;
  const w = g.world;
  if (hit.kind === 'crystal') {
    const c = hit.thing;
    c.found = true;
    removeThing(g, c);
    updateCrystals();
    sound.chime();
    const n = w.crystals.filter((k) => k.found).length,
      all = n >= w.crystals.length;
    ui.toastShow(all ? `Alle Kristalle von ${g.name} gefunden! ✨` : `Kristall gefunden! ${n}/${w.crystals.length}`, all ? 6 : 3);
  } else if (hit.kind === 'lantern') {
    w.lanterns = w.lanterns.filter((l) => l !== hit.thing);
    removeThing(g, hit.thing);
    give(LANTERN);
    sound.build();
  } else if (hit.kind === 'tree') {
    const t = hit.thing;
    t.removed = true;
    remeshTrees(g, Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK));
    give(WOOD, 3 + Math.round(t.segs.length / 3));
    sound.dig();
    ui.nameShow(`Holz (${g.inv.find(([b]) => b === WOOD)[1]})`);
  } else {
    const [x, y, z] = hit.point.map(round2);
    const took = w.brush(x, y, z, DIG_R, false);
    if (!took.size) return;
    g.ops.push(['d', x, y, z, DIG_R]);
    // what was dug out: the material most of it was made of
    const [mat, n] = [...took].sort((a, b) => b[1] - a[1])[0];
    give(DROP[mat] || mat, Math.max(1, Math.round(n / 4)));
    changed(x, y, z, DIG_R);
    sound.dig();
  }
}

function build() {
  const g = game;
  if (!g?.playing) return;
  const hit = g.player.target();
  const slot = g.inv[g.selected];
  if (!hit || hit.kind !== 'ground' || !slot || slot[1] <= 0) return;
  const w = g.world;
  if (slot[0] === LANTERN) {
    if (hit.normal[1] < 0.4) return ui.nameShow('Laternen brauchen ebenen Boden');
    const l = hit.point.map(round2);
    w.lanterns.push(l);
    addThing(g, l);
    g.saveTimer = Math.min(g.saveTimer, 1);
  } else {
    const c = hit.point.map((v, k) => round2(v + hit.normal[k] * BUILD_R * 0.55));
    if (g.player.touches(c, BUILD_R)) return;
    w.brush(c[0], c[1], c[2], BUILD_R, true, slot[0]);
    g.ops.push(['b', c[0], c[1], c[2], BUILD_R, slot[0]]);
    changed(c[0], c[1], c[2], BUILD_R);
  }
  slot[1]--;
  sound.build();
  refreshHotbar();
}

const input = new Input(renderer.domElement, ui, {
  dig,
  build,
  select,
  cycle: (d) => game && select((game.selected + d + game.inv.length) % game.inv.length),
});

function persist() {
  const g = game;
  if (!g) return;
  const w = g.world;
  store.save(g.seed, {
    name: g.name,
    ops: g.ops,
    trees: w.trees.filter((t) => t.removed).map((t) => t.id),
    found: w.crystals.filter((c) => c.found).map((c) => c.id),
    lanterns: w.lanterns,
    inv: g.inv,
    pos: [g.player.x, g.player.y, g.player.z, g.player.yaw, g.player.pitch],
    t: g.t,
  });
}
addEventListener('visibilitychange', () => document.hidden && game?.playing && persist());
addEventListener('pagehide', () => game?.playing && persist());

// --- the title screen ---------------------------------------------------------------------------------------------

function randomSeed() {
  return seedWords(FIRST, SECOND);
}

let pending = null;
function startGrowing(name) {
  clearTimeout(pending);
  ui.loading.classList.remove('hidden');
  // let the "growing" note show before the work starts
  pending = setTimeout(() => {
    pending = null;
    if (game?.name !== name) growIsland(name);
    ui.loading.classList.add('hidden');
  }, 30);
}

ui.seed.value = store.lastSeed() || randomSeed();
ui.dice.addEventListener('click', () => {
  ui.seed.value = randomSeed();
  startGrowing(ui.seed.value);
});
ui.seed.addEventListener('change', () => startGrowing(ui.seed.value.trim() || randomSeed()));
ui.play.addEventListener('click', () => {
  sound.start();
  const name = ui.seed.value.trim() || randomSeed();
  clearTimeout(pending);
  ui.loading.classList.add('hidden');
  if (!game || game.name !== name) growIsland(name);
  enterGame();
});
ui.resume.addEventListener('click', () => {
  sound.start();
  enterGame();
});
ui.menuBtn.addEventListener('click', () => {
  persist();
  game.playing = false;
  input.enabled = false;
  ui.showMenu(true, true);
  document.exitPointerLock?.();
});
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && game?.playing) ui.menuBtn.click();
});

let helpTimer = null;
function enterGame() {
  game.playing = true;
  input.enabled = true;
  ui.showMenu(false);
  ui.help.textContent = touch
    ? 'Links: laufen · Rechts wischen: schauen · ⛏ graben · ▣ bauen'
    : 'Klicken zum Steuern · WASD laufen · Maus schauen · Linksklick graben · Rechtsklick bauen · 1–9 / Mausrad: Material · M: Menü';
  // the controls after the welcome, so the two notes never cover each other
  clearTimeout(helpTimer);
  helpTimer = setTimeout(() => {
    ui.help.classList.add('on');
    helpTimer = setTimeout(() => ui.help.classList.remove('on'), 7000);
  }, 4500);
  ui.toastShow(`Willkommen auf ${game.name}. Finde die ${game.world.crystals.length} Kristalle. Nachts leuchten sie.`, 4);
}

// --- the loop -----------------------------------------------------------------------------------------------------

let last = performance.now();
let lastTarget = '';
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  ui.tick(dt);
  const g = game;
  if (!g) return;
  g.time += dt;
  g.t = (g.t + dt / DAY_SECONDS) % 1;
  const p = g.player;

  if (g.playing) {
    const [lx, ly] = input.takeLook();
    p.yaw -= lx;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - ly));
    p.update(dt, input.state(dt));
    camera.position.set(p.x, p.eyeY, p.z);
    camera.rotation.set(p.pitch, p.yaw, 0);
    const hit = p.target();
    ring.visible = hit?.kind === 'ground';
    if (ring.visible) {
      const [x, y, z] = hit.point,
        n = hit.normal;
      ring.position.set(x + n[0] * 0.06, y + n[1] * 0.06, z + n[2] * 0.06);
      ring.lookAt(x + n[0], y + n[1], z + n[2]);
    }
    const k = hit ? hit.kind + (hit.thing?.id ?? '') : '';
    if (k !== lastTarget && hit && hit.kind !== 'ground')
      ui.nameShow({ crystal: 'Kristall · abbauen zum Einsammeln', tree: 'Baum · fällen für Holz', lantern: 'Laterne · abbauen zum Mitnehmen' }[hit.kind]);
    lastTarget = k;
    if ((g.saveTimer -= dt) <= 0) {
      g.saveTimer = 5;
      persist();
    }
  } else {
    // the title: the camera circles the island
    ring.visible = false;
    const a = g.time * 0.05;
    camera.position.set(SIZE / 2 + Math.cos(a) * 125, 58, SIZE / 2 + Math.sin(a) * 125);
    camera.lookAt(SIZE / 2, 14, SIZE / 2);
  }

  const underwater = camera.position.y < WATER_Y;
  ui.underwater.classList.toggle('on', underwater);
  U.uCam.value.copy(camera.position);
  const day = g.sky.update(g.t, g.time, camera, underwater);
  g.birds.update(dt, g.time, p, day);
  const night = Math.max(0, Math.min(1, (day.night - 0.3) / 0.5));
  for (const b of g.beams) {
    b.visible = !b.userData.crystal.found && night > 0;
    b.material.opacity = 0.22 * night * (0.8 + 0.2 * Math.sin(g.time * 2 + b.userData.crystal.id));
  }
  for (const [thing, m] of g.things) if (!Array.isArray(thing)) m.rotation.y = g.time * 0.4 + thing.id;
  // the eight lights nearest the camera light the scene
  const lamps = g.world
    .lights()
    .map((l) => [l, (l[0] - camera.position.x) ** 2 + (l[2] - camera.position.z) ** 2])
    .sort((a, b) => a[1] - b[1]);
  U.uLamps.value.forEach((v, i) => (lamps[i] ? v.set(...lamps[i][0]) : v.set(0, -1000, 0, 1)));
  ui.setClock(g.t);
  if (g.playing) {
    // the sea is louder the nearer the water is
    const ground = g.world.heights[Math.floor(p.z) * SIZE + Math.floor(p.x)] ?? SEA;
    sound.sea(Math.max(0, Math.min(1, 1 - (ground - SEA) / 10)), g.time);
  }
  renderer.render(scene, camera);
}

startGrowing(ui.seed.value);
requestAnimationFrame(frame);

// for poking at the game from the browser's console
window.visland = {
  get game() {
    return game;
  },
  dig,
  build,
};
