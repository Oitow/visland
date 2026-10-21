// The title, drawn as blocks: each letter a 5 x 7 grid, each cell a little block with grass on its top rows.
const GLYPHS = {
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  I: ['111', '010', '010', '010', '010', '010', '111'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
};

const canvas = document.getElementById('logo');
const ctx = canvas.getContext('2d');
const word = 'VISLAND';
const cols = [...word].reduce((n, ch) => n + GLYPHS[ch][0].length + 1, -1);
const cell = Math.floor((canvas.width - 4) / cols),
  depth = Math.max(2, Math.round(cell * 0.35));
canvas.height = cell * 7 + depth + 2;
let ox = 0;
for (const ch of word) {
  const g = GLYPHS[ch];
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < g[y].length; x++) {
      if (g[y][x] !== '1') continue;
      const px = (ox + x) * cell + depth,
        py = y * cell;
      const grass = y === 0 || g[y - 1][x] !== '1';
      // the block's side and top, offset to look extruded, then its face
      ctx.fillStyle = '#6e5a35';
      ctx.fillRect(px - depth, py + depth, cell, cell);
      ctx.fillStyle = grass ? '#3f7d2c' : '#b8a36b';
      ctx.fillRect(px - depth + 1, py + 1, cell, depth);
      ctx.fillStyle = grass ? '#62b246' : '#e6d29a';
      ctx.fillRect(px - depth / 2, py + depth / 2, cell - 1, cell - 1);
      if (!grass && (x + y + ox) % 3 === 0) {
        ctx.fillStyle = '#f4e6b4';
        ctx.fillRect(px - depth / 2 + 1, py + depth / 2 + 1, 1, 1);
      }
    }
  ox += g[0].length + 1;
}
