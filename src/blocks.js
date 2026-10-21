// Block types: what each is called, how it looks (which atlas tiles), and how it behaves.
// The textures themselves are painted in code by textures.js.

export const AIR = 0;
export const SAND = 1;
export const GRASS = 2;
export const DIRT = 3;
export const STONE = 4;
export const SNOW = 5;
export const WOOD = 6;
export const LEAVES = 7;
export const PINE = 8;
export const PALM = 9;
export const DRYGRASS = 10;
export const GRAVEL = 11;
export const PLANKS = 12;
export const BRICK = 13;
export const GLASS = 14;
export const LANTERN = 15;
export const CRYSTAL = 16;
export const BEDROCK = 17;

// tiles in the atlas (8 across, 4 down), painted by textures.js in this order
export const TILE = {
  grassTop: 0,
  grassSide: 1,
  dirt: 2,
  sand: 3,
  stone: 4,
  snow: 5,
  snowSide: 6,
  woodSide: 7,
  woodTop: 8,
  leaves: 9,
  pine: 10,
  palm: 11,
  dryTop: 12,
  drySide: 13,
  gravel: 14,
  planks: 15,
  brick: 16,
  glass: 17,
  lantern: 18,
  crystal: 19,
  bedrock: 20,
};

// name (German, shown in the game), tiles [top, side, bottom], and flags:
// solid: you bump into it; see: you can see through it (faces behind it are drawn); emit: it glows by itself;
// light: how far it lights its surroundings at night (in blocks)
const T = TILE;
export const BLOCKS = [
  { name: 'Luft', solid: false, see: true },
  { name: 'Sand', tiles: [T.sand, T.sand, T.sand], solid: true },
  { name: 'Gras', tiles: [T.grassTop, T.grassSide, T.dirt], solid: true, drop: GRASS },
  { name: 'Erde', tiles: [T.dirt, T.dirt, T.dirt], solid: true },
  { name: 'Stein', tiles: [T.stone, T.stone, T.stone], solid: true },
  { name: 'Schnee', tiles: [T.snow, T.snowSide, T.stone], solid: true },
  { name: 'Holz', tiles: [T.woodTop, T.woodSide, T.woodTop], solid: true },
  { name: 'Laub', tiles: [T.leaves, T.leaves, T.leaves], solid: true, see: true },
  { name: 'Nadeln', tiles: [T.pine, T.pine, T.pine], solid: true, see: true },
  { name: 'Palmblatt', tiles: [T.palm, T.palm, T.palm], solid: true, see: true },
  { name: 'Steppengras', tiles: [T.dryTop, T.drySide, T.dirt], solid: true },
  { name: 'Kies', tiles: [T.gravel, T.gravel, T.gravel], solid: true },
  { name: 'Bretter', tiles: [T.planks, T.planks, T.planks], solid: true },
  { name: 'Ziegel', tiles: [T.brick, T.brick, T.brick], solid: true },
  { name: 'Glas', tiles: [T.glass, T.glass, T.glass], solid: true, see: true },
  { name: 'Laterne', tiles: [T.lantern, T.lantern, T.lantern], solid: true, emit: 1, light: 8 },
  { name: 'Kristall', tiles: [T.crystal, T.crystal, T.crystal], solid: true, see: true, emit: 1, light: 4 },
  { name: 'Grundgestein', tiles: [T.bedrock, T.bedrock, T.bedrock], solid: true, unbreakable: true },
];

export const isSolid = (b) => BLOCKS[b].solid;
// whether a block hides the face of its neighbour (opaque and solid)
export const isOpaque = (b) => b !== AIR && !BLOCKS[b].see;

// what can be placed from the hotbar, in order
export const HOTBAR = [PLANKS, BRICK, GLASS, LANTERN, STONE, DIRT, SAND, WOOD, LEAVES];
