// Hotbar pictures, painted in code: a lump of each material with its grain, and a little lantern.
import { latticeRandom } from '../vendor/almanac/noise.js';
import { hexToRgb } from '../vendor/almanac/colour.js';
import { MATERIALS, LANTERN } from './materials.js';

export function drawItemIcon(ctx, item, size) {
  const px = size / 16;
  ctx.clearRect(0, 0, size, size);
  const put = (x, y, c) => {
    ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    ctx.fillRect(Math.round(x * px), Math.round(y * px), Math.ceil(px), Math.ceil(px));
  };
  if (item === LANTERN) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const frame = (y === 3 || y === 12) && x > 3 && x < 12;
        const side = (x === 4 || x === 11) && y > 3 && y < 12;
        const post = y > 12 && x > 6 && x < 9;
        const glow = x > 4 && x < 11 && y > 3 && y < 12;
        if (frame || side || post) put(x, y, [74, 51, 34]);
        else if (glow) put(x, y, [255, 214 - Math.hypot(x - 7.5, y - 7.5) * 10, 122]);
      }
    return;
  }
  // a rounded lump, lit from the upper left, speckled by the material's grain
  const m = MATERIALS[item],
    base = hexToRgb(m.color);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = (x - 7.5) / 6.5,
        dy = (y - 8.5) / 5.5;
      if (dx * dx + dy * dy > 1) continue;
      const light = 1.1 - (dx + dy) * 0.18 - (dx * dx + dy * dy) * 0.15;
      const grain = 1 + (latticeRandom(x, y, item) - 0.5) * m.grain * 1.6;
      put(x, y, base.map((v) => Math.min(255, v * light * grain)));
    }
}
