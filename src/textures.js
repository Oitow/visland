// Every texture in the game, painted pixel by pixel in code: 16 x 16 tiles in one atlas, 8 across and 4 down.
// The grain, cracks, leaves and walls are the almanac's noise and relief functions.
import { latticeRandom, valueNoise, ridgedNoise } from '../vendor/almanac/noise.js';
import { wallShade, leafShade } from '../vendor/almanac/relief.js';
import { bayerThreshold } from '../vendor/almanac/pixels.js';
import { hexToRgb } from '../vendor/almanac/colour.js';
import { TILE, BLOCKS } from './blocks.js';

export const TS = 16; // a tile's pixels across
export const COLS = 8;
export const ROWS = 4;

const rgb = (hex, k = 1, a = 255) => {
  const c = hexToRgb(hex);
  return [c[0] * k, c[1] * k, c[2] * k, a];
};
const n = (x, y, s) => latticeRandom(x, y, s); // one pixel's own random number
const speckle = (hex, x, y, s, amount = 0.16) => rgb(hex, 1 + (n(x, y, s) - 0.5) * amount * 2);

// the top rows of a side face that show the top's stuff hanging over (grass, snow), ragged per column
const fringe = (x, y, s, rows) => y < rows - 1 + Math.floor(n(x, 0, s) * 3);

const painters = {
  [TILE.grassTop]: (x, y) => {
    const g = valueNoise(x / 4, y / 4, 3);
    return speckle(g > 0.6 ? '#62b246' : '#56a63c', x, y, 1, 0.14);
  },
  [TILE.grassSide]: (x, y) => (fringe(x, y, 2, 3) ? speckle('#56a63c', x, y, 1, 0.12) : painters[TILE.dirt](x, y)),
  [TILE.dirt]: (x, y) => {
    const v = wallShade('earth', x, y + 1);
    return n(x, y, 4) < 0.08 ? rgb('#a8805a') : rgb('#8a5c3c', v * 1.15);
  },
  [TILE.sand]: (x, y) => (n(x, y, 5) < 0.12 ? rgb('#f4e6b4') : n(x, y, 6) < 0.1 ? rgb('#cdb77d') : speckle('#e6d29a', x, y, 7, 0.05)),
  [TILE.stone]: (x, y) => {
    const crack = ridgedNoise(x / 5, y / 5, 8, 2);
    return crack > 0.86 ? rgb('#5f636a') : speckle(crack > 0.7 ? '#868a91' : '#92969d', x, y, 9, 0.08);
  },
  [TILE.snow]: (x, y) => (n(x, y, 10) < 0.1 ? rgb('#dce8f4') : rgb('#f4f8fc')),
  [TILE.snowSide]: (x, y) => (fringe(x, y, 11, 4) ? rgb('#f4f8fc', wallShade('snow', x, y)) : painters[TILE.stone](x, y)),
  [TILE.woodSide]: (x, y) => {
    const stripe = valueNoise(x * 1.3, y / 6, 12);
    return rgb(stripe > 0.6 ? '#5e3d22' : '#73502e', 1 + (n(x, y, 13) - 0.5) * 0.1);
  },
  [TILE.woodTop]: (x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > 7) return rgb('#5e3d22');
    return rgb(Math.floor(d + valueNoise(x / 3, y / 3, 14)) % 3 === 0 ? '#9c7448' : '#b58c5c');
  },
  [TILE.leaves]: (x, y) => rgb(n(x, y, 15) < 0.08 ? '#24581f' : '#3e8f37', leafShade(x, y)),
  [TILE.pine]: (x, y) => rgb(n(x, y, 16) < 0.06 ? '#173b28' : (x + y * 2) % 5 === 0 ? '#2f6b4a' : '#255a3e', leafShade(x, y)),
  [TILE.palm]: (x, y) => {
    // fronds: diagonal ribs
    const rib = (x + y) % 4 === 0;
    return rgb(n(x, y, 17) < 0.07 ? '#3f7a2a' : rib ? '#8fd05a' : '#68b844', leafShade(x, y));
  },
  [TILE.dryTop]: (x, y) => speckle(valueNoise(x / 3, y / 3, 18) > 0.55 ? '#d2bb62' : '#c2a852', x, y, 19, 0.14),
  [TILE.drySide]: (x, y) => (fringe(x, y, 20, 3) ? speckle('#c2a852', x, y, 19, 0.12) : painters[TILE.dirt](x, y)),
  [TILE.gravel]: (x, y) => {
    const pebble = valueNoise(x / 2, y / 2, 21);
    return rgb(pebble > 0.65 ? '#a39d96' : pebble < 0.3 ? '#6a6560' : '#857f78');
  },
  [TILE.planks]: (x, y) => {
    const board = y >> 2,
      joint = (x + board * 5) % 16 === 0;
    if (y % 4 === 3 || joint) return rgb('#6e4f2c');
    return rgb('#b38a52', 1 + (valueNoise(x / 5, board * 3 + y / 8, 22) - 0.5) * 0.18);
  },
  [TILE.brick]: (x, y) => {
    const row = y >> 2,
      off = row & 1 ? 4 : 0,
      mortar = y % 4 === 3 || (x + off) % 8 === 7;
    if (mortar) return rgb('#d8cfc0');
    return rgb('#a8483a', 0.9 + n((x + off) >> 3, row, 23) * 0.2 - (y % 4) * 0.03);
  },
  [TILE.glass]: (x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) return rgb('#cfe8f2');
    const shine = (x - y === 3 || x - y === 4) && x > 4 && x < 12;
    return shine ? rgb('#ffffff') : [0, 0, 0, 0];
  },
  [TILE.lantern]: (x, y) => {
    const frame = x < 2 || x > 13 || y < 2 || y > 13 || x === 7 || x === 8;
    if (frame) return rgb('#3b2b1f');
    const glow = 1 - Math.hypot(x - 7.5, y - 7.5) / 10;
    return rgb('#ffcc66', 0.85 + glow * 0.3);
  },
  [TILE.crystal]: (x, y) => {
    // facets: bands at angles, lit unevenly, dithered at their edges
    const f = Math.floor((x * 0.7 + y * 1.3) / 4 + (bayerThreshold(x, y) > 0.8 ? 1 : 0)) % 3;
    return rgb(['#8ef0ff', '#c58cff', '#e8fbff'][f], 1 - (n(x, y, 24) < 0.1 ? 0.15 : 0));
  },
  [TILE.bedrock]: (x, y) => rgb(n(x >> 1, y >> 1, 25) > 0.5 ? '#3a3a3e' : '#56565c'),
};

// the atlas as a canvas, every tile painted
export function makeAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * TS;
  canvas.height = ROWS * TS;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (const [tile, paint] of Object.entries(painters)) {
    const ox = (tile % COLS) * TS,
      oy = Math.floor(tile / COLS) * TS;
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const [r, g, b, a] = paint(x, y);
        const i = ((oy + y) * canvas.width + ox + x) * 4;
        img.data[i] = Math.max(0, Math.min(255, r));
        img.data[i + 1] = Math.max(0, Math.min(255, g));
        img.data[i + 2] = Math.max(0, Math.min(255, b));
        img.data[i + 3] = a;
      }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// a block drawn as a little cube (for the hotbar), from the atlas
export function drawIcon(ctx, atlas, block, size) {
  const [top, side] = BLOCKS[block].tiles;
  const src = (t) => [(t % COLS) * TS, Math.floor(t / COLS) * TS];
  const s = size * 0.47,
    ox = size * 0.03,
    oy = size * 0.03;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  const face = (tile, a, b, c, d, e, f, dark) => {
    ctx.save();
    ctx.setTransform(a, b, c, d, e, f);
    const [sx, sy] = src(tile);
    ctx.drawImage(atlas, sx, sy, TS, TS, 0, 0, TS, TS);
    if (dark) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(0,0,0,${dark})`;
      ctx.fillRect(0, 0, TS, TS);
    }
    ctx.restore();
  };
  const k = s / TS;
  // top (a diamond), left and right sides
  face(top, k, k * 0.5, -k, k * 0.5, ox + s, oy, 0);
  face(side, k, k * 0.5, 0, k, ox, oy + s * 0.5, 0.15);
  face(side, k, -k * 0.5, 0, k, ox + s, oy + s, 0.32);
}
