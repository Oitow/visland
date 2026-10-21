// Visland: a voxel island grown from a seed, made only of code. This file ties it together: it grows the island,
// builds its meshes, runs the day, and turns the player's taps and keys into digging and building.
import * as THREE from 'three';
import { seedOf, seedWords } from '../vendor/almanac/seeds.js';
import { World, SIZE, CHUNK, WATER_Y, SEA } from './world.js';
import { AIR, BLOCKS, CRYSTAL, GRASS, DRYGRASS, DIRT, PLANKS, BRICK, GLASS, LANTERN } from './blocks.js';
import { makeAtlas } from './textures.js';
import { meshChunk } from './mesher.js';
import { terrainMaterial, U } from './shaders.js';
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
const START_INV = [
  [PLANKS, 48],
  [BRICK, 48],
  [GLASS, 24],
  [LANTERN, 12],
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

const atlasCanvas = makeAtlas();
const atlas = new THREE.CanvasTexture(atlasCanvas);
atlas.magFilter = THREE.NearestFilter;
atlas.minFilter = THREE.NearestFilter;
atlas.generateMipmaps = false;
const terrainMat = terrainMaterial(atlas);

const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
);
outline.visible = false;
scene.add(outline);

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
  for (const m of game.chunks.values()) {
    scene.remove(m);
    m.geometry.dispose();
  }
  for (const o of game.extras) scene.remove(o);
  game = null;
}

function growIsland(name) {
  disposeIsland();
  const seed = seedOf(name);
  const world = new World(seed);
  world.generate();
  const saved = store.load(seed);
  const edits = new Map(saved?.edits || []);
  for (const [i, b] of edits) {
    const x = i % SIZE,
      z = Math.floor(i / SIZE) % SIZE,
      y = Math.floor(i / (SIZE * SIZE));
    world.set(x, y, z, b);
  }
  const g = {
    name,
    seed,
    world,
    edits,
    chunks: new Map(),
    extras: [],
    inv: saved?.inv || START_INV.map((s) => [...s]),
    selected: 0,
    found: new Set(saved?.found || []),
    t: saved?.t ?? 0.3,
    time: 0,
    player: new Player(world),
    playing: false,
    saveTimer: 0,
  };
  if (saved?.pos) [g.player.x, g.player.y, g.player.z, g.player.yaw, g.player.pitch] = saved.pos;
  for (let cz = 0; cz < SIZE / CHUNK; cz++) for (let cx = 0; cx < SIZE / CHUNK; cx++) remesh(g, cx, cz);
  g.water = new Water(scene, world);
  g.sky = new Sky(scene, seed);
  g.birds = new Birds(scene, seed);
  g.extras.push(g.water.mesh, g.sky.dome, g.sky.stars, ...g.sky.clouds, ...g.birds.meshes);
  // at night, a beam of light stands over every crystal not yet found
  g.beams = world.crystals.map(([x, y, z]) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 60, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
    );
    m.position.set(x + 0.5, y + 30.5, z + 0.5);
    m.userData.idx = world.idx(x, y, z);
    m.renderOrder = 11;
    scene.add(m);
    g.extras.push(m);
    return m;
  });
  game = g;
  ui.seedLabel.textContent = name;
  updateCrystals();
  refreshHotbar();
}

function remesh(g, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= SIZE / CHUNK || cz >= SIZE / CHUNK) return;
  const key = cx + ',' + cz;
  const old = g.chunks.get(key);
  const data = meshChunk(g.world, cx, cz);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
  geo.setAttribute('aLight', new THREE.BufferAttribute(data.light, 3));
  geo.setIndex(new THREE.BufferAttribute(data.index, 1));
  geo.computeBoundingSphere();
  if (old) {
    old.geometry.dispose();
    old.geometry = geo;
  } else {
    const m = new THREE.Mesh(geo, terrainMat);
    g.chunks.set(key, m);
    scene.add(m);
  }
}

// a block changed: mesh again the chunks it shows in (and, if it glows or glowed, all its light reaches)
function changed(x, y, z, before, after) {
  const g = game;
  const r = Math.max(BLOCKS[before].light || 0, BLOCKS[after].light || 0) || 1;
  for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++)
    for (let cz = Math.floor((z - r) / CHUNK); cz <= Math.floor((z + r) / CHUNK); cz++) remesh(g, cx, cz);
  g.water.changed(x, z);
  g.edits.set(g.world.idx(x, y, z), after);
  g.saveTimer = Math.min(g.saveTimer, 1);
}

function updateCrystals() {
  const g = game;
  ui.crystals.textContent = `◆ ${g.found.size}/${g.world.crystals.length}`;
}

function refreshHotbar() {
  ui.hotbarSet(game.inv, game.selected, atlasCanvas, (i) => select(i));
}

function select(i) {
  if (!game || i < 0 || i >= game.inv.length) return;
  game.selected = i;
  refreshHotbar();
  ui.nameShow(`${BLOCKS[game.inv[i][0]].name} (${game.inv[i][1]})`);
}

function give(block) {
  const slot = game.inv.find(([b]) => b === block);
  if (slot) slot[1]++;
  else game.inv.push([block, 1]);
  refreshHotbar();
}

function dig() {
  const g = game;
  if (!g?.playing) return;
  const hit = g.player.target();
  if (!hit || BLOCKS[hit.block].unbreakable) return;
  const { x, y, z, block } = hit;
  g.world.set(x, y, z, AIR);
  changed(x, y, z, block, AIR);
  if (block === CRYSTAL) {
    g.found.add(g.world.idx(x, y, z));
    updateCrystals();
    sound.chime();
    const all = g.found.size >= g.world.crystals.length;
    ui.toastShow(all ? `Alle Kristalle von ${g.name} gefunden! ✨` : `Kristall gefunden! ${g.found.size}/${g.world.crystals.length}`, all ? 6 : 3);
  } else {
    sound.dig();
    give(block === GRASS || block === DRYGRASS ? DIRT : block);
  }
}

function build() {
  const g = game;
  if (!g?.playing) return;
  const hit = g.player.target();
  const slot = g.inv[g.selected];
  if (!hit || !slot || slot[1] <= 0) return;
  const { px, py, pz } = hit;
  if (g.world.get(px, py, pz) !== AIR || g.player.overlaps(px, py, pz) || py >= 63) return;
  g.world.set(px, py, pz, slot[0]);
  changed(px, py, pz, AIR, slot[0]);
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
  store.save(g.seed, {
    name: g.name,
    edits: [...g.edits],
    inv: g.inv,
    found: [...g.found],
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
    ? 'Links: laufen · Rechts wischen: schauen · ⛏ abbauen · ▣ bauen'
    : 'Klicken zum Steuern · WASD laufen · Maus schauen · Linksklick abbauen · Rechtsklick bauen · 1–9 / Mausrad: Block · M: Menü';
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
    outline.visible = !!hit;
    if (hit) {
      outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      const k = `${hit.x},${hit.y},${hit.z}`;
      if (k !== lastTarget && hit.block === CRYSTAL) ui.nameShow('Kristall – abbauen zum Einsammeln');
      lastTarget = k;
    }
    if ((g.saveTimer -= dt) <= 0) {
      g.saveTimer = 5;
      persist();
    }
  } else {
    // the title: the camera circles the island
    outline.visible = false;
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
    b.visible = !g.found.has(b.userData.idx) && night > 0;
    b.material.opacity = 0.22 * night * (0.8 + 0.2 * Math.sin(g.time * 2 + b.userData.idx));
  }
  ui.setClock(g.t);
  if (g.playing) {
    // the sea is louder the nearer the water is
    const ground = g.world.ground[Math.floor(p.z) * SIZE + Math.floor(p.x)] ?? SEA;
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
