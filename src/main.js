// Visland: an island grown from a seed, made only of code. This file ties it together: it grows the island,
// builds its meshes, runs the day, and turns the player's taps and keys into digging and building.
import * as THREE from 'three';
import { seedOf, seedWords } from '../vendor/almanac/seeds.js';
import { World, SIZE, CHUNK, WATER_Y, SEA } from './world.js';
import { STONE, DIRT, WOOD, LANTERN, AXE, PICK, DROP, itemName, isTool } from './materials.js';
import { Swing, SWING } from './tools.js';
import { tuftGeometry, axeGeometry, pickGeometry } from './flora.js';
import { geo, crystalMesh, lanternMesh, leafAtlas } from './meshes.js';
import { terrainMaterial, woodMaterial, leafMaterial, tuftMaterial, glowMaterial, U } from './shaders.js';
import { Woodcutter } from './wood.js';
import { loadPhysics } from './physics.js';
import { SPECIES } from './trees.js';
import { Particles } from './particles.js';
import { Sky } from './sky.js';
import { Water } from './water.js';
import { Birds } from './birds.js';
import { Player, STEP } from './player.js';
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
  [AXE, 1],
  [PICK, 1],
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
const woodMat = woodMaterial();
const leafMat = leafMaterial(leafAtlas());
const tuftMat = tuftMaterial();
const glowMat = glowMaterial();
const lanternGlow = new THREE.MeshBasicMaterial({ color: 0xffd27a });
const tuftGeos = { 2: geo(tuftGeometry('#3f7f2c', '#9fd060')), 6: geo(tuftGeometry('#8a7a36', '#e2cc78')) };

// the ring that shows where a dig or a build will land
const ring = new THREE.Mesh(
  new THREE.RingGeometry(DIG_R - 0.12, DIG_R, 40),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
);
ring.visible = false;
ring.renderOrder = 12;
scene.add(ring);

// the tool in the hand: hung on the camera, at the lower right, swinging when it is used
scene.add(camera);
const toolMat = woodMaterial();
toolMat.depthTest = false; // always in front, never into a wall
toolMat.side = THREE.DoubleSide;
const held = new THREE.Group();
const toolMeshes = {};
for (const [id, arrays, turn] of [
  [AXE, axeGeometry(), Math.PI / 2 + 0.55], // the blade forward and a little to the left, as it is held
  [PICK, pickGeometry(), 0.35],
]) {
  const m = new THREE.Mesh(geo(arrays), toolMat);
  m.rotation.set(0, turn, 0);
  m.renderOrder = 100;
  held.add(m);
  toolMeshes[id] = m;
}
held.position.set(0.34, -0.36, -0.55);
camera.add(held);


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
    for (const m of [c.ground, ...c.trees, ...c.tufts]) {
      if (!m) continue;
      scene.remove(m);
      m.geometry.dispose();
    }
  for (const o of game.extras) scene.remove(o);
  for (const o of game.things.values()) scene.remove(o);
  game.wood.clear();
  physics?.clear();
  game = null;
}

// --- the worker: the island grows and is meshed there (worldjob.js); this page keeps a copy to walk and dig on ---

let gen = 0; // which island the worker's answers are for
let growing = null; // { name, gen, saved, resolve, promise }
const toWorker = (() => {
  // what has been asked since the last island was grown, so the page can do it all itself if the worker fails
  let sent = [];
  let local = null;
  const onPage = () => {
    if (local) return;
    console.warn('Visland: no worker here; the island is grown on the page');
    local = import('./worldjob.js').then(({ createJob }) => createJob((msg) => setTimeout(() => fromWorker(msg))));
    for (const m of sent) local.then((handle) => handle(m));
  };
  let worker = null;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => fromWorker(e.data);
    worker.onerror = onPage;
  } catch {
    onPage();
  }
  return (m) => {
    if (m.type === 'grow') sent = [];
    sent.push(m);
    if (local) local.then((handle) => handle(m));
    else worker.postMessage(m);
  };
})();

/** Ask for an island; the promise is kept when its world has arrived (its meshes follow, nearest first). */
function growIsland(name) {
  if (growing?.name === name) return growing.promise;
  disposeIsland();
  const seed = seedOf(name);
  const saved = store.load(seed);
  gen++;
  growing = { name, seed, saved, gen };
  growing.promise = new Promise((resolve) => (growing.resolve = resolve));
  const g0 = gen;
  // the physics engine first (the ground's meshes go to it as they arrive)
  physicsReady.then(() => {
    if (g0 === gen) toWorker({ type: 'grow', gen, seed, ops: saved?.ops || [], trees: (saved?.trees || []).map(([id, state]) => [id, state]), focus: saved?.pos || null });
  });
  return growing.promise;
}

// Rapier, loaded once: rigid bodies for pieces of trees (without it, cut pieces just vanish)
let physics = null;
const physicsReady = loadPhysics()
  .then((p) => (physics = p))
  .catch((e) => console.warn('Visland: no physics engine', e));

function fromWorker(m) {
  if (m.gen !== gen) return; // an answer for an island already left
  if (m.type === 'world') onWorld(m);
  else if (!game) return;
  else if (m.type === 'ground') applyGround(game, m.cx, m.cz, m.mesh);
  else if (m.type === 'trees') applyTrees(game, m.cx, m.cz, m);
}

function onWorld(m) {
  const { name, seed, saved } = growing;
  const world = new World(seed);
  world.unpack(m.pack);
  Object.assign(world, { trees: m.trees, crystals: m.crystals, spawn: m.spawn });
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
  if (saved?.pos) {
    g.player.place(saved.pos[0], saved.pos[1], saved.pos[2]);
    [g.player.yaw, g.player.pitch] = [saved.pos[3], saved.pos[4]];
  }
  if (!g.inv.some(([b]) => b === PICK)) g.inv.unshift([PICK, 1]);
  if (!g.inv.some(([b]) => b === AXE)) g.inv.unshift([AXE, 1]);
  g.swing = new Swing();
  g.particles = new Particles(scene);
  // trees cut with the axe: saved cuts are laid again once the woodcutter is there
  const logs = new Map((saved?.trees || []).filter((e) => e[1] === 'active').map(([id, , log]) => [id, log]));
  for (const [id, log] of logs) if (world.trees[id]) world.trees[id].log = log;
  g.wood = new Woodcutter({
    scene,
    world,
    physics,
    particles: g.particles,
    sound,
    wood: woodMat,
    leaves: leafMat,
    treeChanged: (t) => toWorker({ type: 'tree', gen, id: t.id, state: t.state }),
    give: (n) => {
      give(WOOD, n);
      ui.nameShow(`+${n} Holz (${g.inv.find(([b]) => b === WOOD)[1]})`);
    },
    say: (s) => ui.nameShow(s),
  });
  for (const id of logs.keys()) if (world.trees[id]) g.wood.replay(world.trees[id]);
  g.player.extra = (x, z) => g.wood.near(x, z);
  game = g;
  for (const c of world.crystals) if (!c.found) addThing(g, c);
  for (const l of world.lanterns) addThing(g, l);
  g.water = new Water(scene, world);
  g.sky = new Sky(scene, seed);
  g.birds = new Birds(scene, seed);
  g.extras.push(g.water.mesh, g.sky.dome, g.sky.stars, ...g.sky.clouds, ...g.birds.meshes, g.particles.mesh);
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
  const done = growing.resolve;
  growing = null;
  done(g);
}

function chunkOf(g, cx, cz) {
  const k = cx + ',' + cz;
  if (!g.chunks.has(k)) g.chunks.set(k, { ground: null, trees: [], tufts: [] });
  return g.chunks.get(k);
}

// a chunk's ground as the worker meshed it
function applyGround(g, cx, cz, data) {
  const c = chunkOf(g, cx, cz);
  physics?.setGround(cx + ',' + cz, data.position, data.index);
  const geometry = geo({ position: data.position, normal: data.normal, aColor: data.color, aLight: data.light, index: data.index });
  if (c.ground) {
    c.ground.geometry.dispose();
    c.ground.geometry = geometry;
  } else {
    c.ground = new THREE.Mesh(geometry, terrainMat);
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

// a chunk's trees as the worker meshed them
function applyTrees(g, cx, cz, data) {
  const c = chunkOf(g, cx, cz);
  for (const m of c.trees) {
    scene.remove(m);
    m.geometry.dispose();
  }
  c.trees = [];
  for (const [arrays, mat] of [
    [data.wood, woodMat],
    [data.leaves, leafMat],
  ])
    if (arrays) {
      const m = new THREE.Mesh(geo(arrays), mat);
      scene.add(m);
      c.trees.push(m);
    }
}

// a crystal ({x, y, z, id}) or a lantern ([x, y, z]) in the scene
function addThing(g, thing) {
  const m = Array.isArray(thing) ? lanternMesh(woodMat, lanternGlow) : crystalMesh(glowMat, thing.id);
  const [x, y, z] = Array.isArray(thing) ? thing : [thing.x, thing.y, thing.z];
  m.position.set(x, y - 0.1, z);
  scene.add(m);
  g.things.set(thing, m);
}

function removeThing(g, thing) {
  scene.remove(g.things.get(thing));
  g.things.delete(thing);
}

// the ground changed in a ball: the worker makes the same change to its copy and meshes again every chunk it reaches
function changed(x, y, z, r, add, mat) {
  const g = game;
  const chunks = [];
  for (let cx = Math.floor((x - r - 1) / CHUNK); cx <= Math.floor((x + r + 1) / CHUNK); cx++)
    for (let cz = Math.floor((z - r - 1) / CHUNK); cz <= Math.floor((z + r + 1) / CHUNK); cz++) chunks.push([cx, cz]);
  toWorker({ type: 'brush', gen, x, y, z, r, add, mat, chunks });
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
const smooth = (x) => x * x * (3 - 2 * x);

// what a tree is, said when it is looked at
function treeNote(t) {
  if (t.kind === 'bush') return 'Busch · mit der Axt entfernen';
  return `${SPECIES[t.kind].name} · ${t.state === 'active' ? 'weiter hacken, wo du willst' : 'mit der Axt hacken, an Stamm oder Ast'}`;
}

// ⛏ / left click: pick up what is in reach by hand; with a tool, swing it (what it meets is worked out as it
// swings, in toolHit); with bare hands, scrape soft ground
function dig() {
  const g = game;
  if (!g?.playing) return;
  const w = g.world;
  let item = g.inv[g.selected]?.[0];
  const hit = g.player.target(isTool(item) ? 2.5 : 6);
  if (hit?.kind === 'crystal') {
    const c = hit.thing;
    c.found = true;
    removeThing(g, c);
    updateCrystals();
    sound.chime();
    const n = w.crystals.filter((k) => k.found).length,
      all = n >= w.crystals.length;
    ui.toastShow(all ? `Alle Kristalle von ${g.name} gefunden! ✨` : `Kristall gefunden! ${n}/${w.crystals.length}`, all ? 6 : 3);
    return;
  }
  if (hit?.kind === 'lantern') {
    w.lanterns = w.lanterns.filter((l) => l !== hit.thing);
    removeThing(g, hit.thing);
    give(LANTERN);
    sound.build();
    return;
  }
  if (!isTool(item)) {
    if (hit?.kind === 'tree' || hit?.kind === 'piece') {
      // wood wants the axe: take it in hand
      select(g.inv.findIndex(([b]) => b === AXE));
      item = AXE;
    } else if (hit?.kind === 'ground') {
      if ([STONE].includes(w.matAt(...hit.point))) return ui.nameShow('Zu hart · nimm die Spitzhacke');
      digAt(hit.point, 0.45);
      return 0.35;
    } else return;
  }
  g.swing.start(item === AXE ? 'axe' : 'pick');
  return SWING;
}

// what a swing met, one physics step at a time
function toolHit(g, res) {
  const tool = g.swing.tool;
  if (res.kind === 'wood') {
    g.wood.hit(res.owner, res.point, res.strength * (tool === 'axe' ? 1 : 0.4), tool);
  } else if (tool === 'axe' && res.hard) {
    // an axe rings off stone
    sound.clang();
    for (let i = 0; i < 8; i++) g.particles.spawn(res.point, [(Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4], [1, 0.85, 0.5], { size: 0.04, life: 0.4 });
  } else {
    const r = (tool === 'pick' ? (res.hard ? 0.5 : 0.62) : 0.35) * (0.6 + 0.4 * Math.min(1, res.strength));
    digAt(res.point, r);
  }
}

function digAt(point, r) {
  const g = game,
    w = g.world;
  const [x, y, z] = point.map(round2);
  const took = w.brush(x, y, z, r, false);
  if (!took.size) return;
  g.ops.push(['d', x, y, z, r]);
  // what was dug out: the material most of it was made of (a point is an eighth of a cubic metre now)
  const [mat, n] = [...took].sort((a, b) => b[1] - a[1])[0];
  g.dug = (g.dug || 0) + n;
  if (g.dug >= 8) {
    give(DROP[mat] || mat, Math.floor(g.dug / 8));
    g.dug %= 8;
  }
  changed(x, y, z, r, false);
  sound.dig();
}

function build() {
  const g = game;
  if (!g?.playing) return;
  const hit = g.player.target();
  const slot = g.inv[g.selected];
  if (!hit || hit.kind !== 'ground' || !slot || slot[1] <= 0 || isTool(slot[0])) return;
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
    changed(c[0], c[1], c[2], BUILD_R, true, slot[0]);
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
    trees: w.trees.filter((t) => t.state !== 'standing').map((t) => (t.state === 'active' ? [t.id, 'active', t.log] : [t.id, 'gone'])),
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

// grow an island in the background, the "growing" note showing until its world has arrived
function startGrowing(name) {
  if (game?.name === name) return Promise.resolve(game);
  ui.loading.classList.remove('hidden');
  const p = growIsland(name);
  p.then(() => {
    if (!growing) ui.loading.classList.add('hidden');
  });
  return p;
}

ui.seed.value = store.lastSeed() || randomSeed();
ui.dice.addEventListener('click', () => {
  ui.seed.value = randomSeed();
  startGrowing(ui.seed.value);
});
ui.seed.addEventListener('change', () => startGrowing(ui.seed.value.trim() || randomSeed()));
ui.play.addEventListener('click', async () => {
  sound.start();
  const name = ui.seed.value.trim() || randomSeed();
  await startGrowing(name);
  if (game?.name === name) enterGame();
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
    ? 'Links: laufen · Rechts wischen: schauen · ⛏ zuschlagen (Axt: Holz, Spitzhacke: Boden und Stein) · ▣ bauen'
    : 'Klicken zum Steuern · WASD laufen · Maus schauen · Linksklick zuschlagen · Rechtsklick bauen · 1–9 / Mausrad: Werkzeug · M: Menü';
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
let physicsClock = 0;
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
    // the physics in fixed steps (STEP), however long the frame was; the camera drawn between the last two
    const wish = input.state(dt);
    physicsClock = Math.min(physicsClock + dt, STEP * 6);
    while (physicsClock >= STEP) {
      p.update(STEP, wish);
      const res = g.swing.step(STEP, p, g.world, g.wood);
      if (res) toolHit(g, res);
      physics?.step(STEP);
      g.wood.step(STEP, p);
      physicsClock -= STEP;
    }
    const [cx, cy, cz] = p.drawn(physicsClock / STEP);
    camera.position.set(cx, cy + (p.eyeY - p.y), cz);
    camera.rotation.set(p.pitch, p.yaw, 0);
    const hit = p.target();
    ring.visible = hit?.kind === 'ground' && g.inv[g.selected]?.[0] !== AXE;
    ring.scale.setScalar(g.inv[g.selected]?.[0] === PICK ? 0.5 : 0.36);
    if (ring.visible) {
      const [x, y, z] = hit.point,
        n = hit.normal;
      ring.position.set(x + n[0] * 0.06, y + n[1] * 0.06, z + n[2] * 0.06);
      ring.lookAt(x + n[0], y + n[1], z + n[2]);
    }
    const k = hit ? hit.kind + (hit.thing?.id ?? '') : '';
    if (k !== lastTarget && hit && hit.kind !== 'ground')
      ui.nameShow(
        hit.kind === 'tree'
          ? treeNote(hit.thing)
          : { crystal: 'Kristall · abbauen zum Einsammeln', lantern: 'Laterne · abbauen zum Mitnehmen' }[hit.kind],
      );
    lastTarget = k;
    // the tool in hand, swinging back, down hard, and up again (or stopped where it struck)
    const item = g.inv[g.selected]?.[0];
    held.visible = isTool(item);
    for (const [id, m] of Object.entries(toolMeshes)) m.visible = +id === item;
    const [lift, round] = g.swing.pose();
    const walk = Math.hypot(p.vx, p.vz) > 0.5 && p.onGround ? Math.sin(g.time * 9) : 0;
    held.rotation.set(-0.35 + lift, 0.2 + round, -0.15 - round * 0.6);
    held.position.set(0.34 - round * 0.12, -0.36 + walk * 0.012 + Math.max(0, lift) * 0.05, -0.55);
    // tell the worker where the player is now and then, so the ground near them is meshed finely
    if (Math.hypot(p.x - (g.focus?.[0] ?? -99), p.z - (g.focus?.[1] ?? -99)) > 4) {
      g.focus = [p.x, p.z];
      toWorker({ type: 'focus', gen, x: p.x, z: p.z });
    }
    if ((g.saveTimer -= dt) <= 0) {
      g.saveTimer = 5;
      persist();
    }
  } else {
    // the title: the camera circles the island
    ring.visible = false;
    held.visible = false;
    const a = g.time * 0.05;
    camera.position.set(SIZE / 2 + Math.cos(a) * 125, 58, SIZE / 2 + Math.sin(a) * 125);
    camera.lookAt(SIZE / 2, 14, SIZE / 2);
  }

  const underwater = camera.position.y < WATER_Y;
  ui.underwater.classList.toggle('on', underwater);
  U.uCam.value.copy(camera.position);
  const day = g.sky.update(g.t, g.time, camera, underwater);
  g.birds.update(dt, g.time, p, day);
  g.wood.draw3();
  g.particles.update(dt, day.light);
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
    const ground = g.world.heightAt(p.x, p.z);
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
  renderer,
};
