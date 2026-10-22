// What the ground is made of. Every point of the world holds one of these; the surface takes its colour from them,
// blended softly where two meet. The grain on top is painted by the terrain shader.

export const SAND = 1;
export const GRASS = 2;
export const DIRT = 3;
export const STONE = 4;
export const SNOW = 5;
export const DRYGRASS = 6;
export const GRAVEL = 7;
export const WOOD = 8;
export const LANTERN = 100; // not a material: a thing to place (it is in the hotbar all the same)
export const AXE = 101; // a tool: never used up
export const PICK = 102; // the pickaxe, for stone (and any ground)

// name (shown in the game), colour, the colour it shows where it is steep (grass gives way to earth on a slope),
// and how coarse its grain is
export const MATERIALS = {
  [SAND]: { name: 'Sand', color: '#e3cf96', steep: '#d4bd80', grain: 0.12 },
  [GRASS]: { name: 'Gras', color: '#5ba53f', steep: '#86593a', grain: 0.16 },
  [DIRT]: { name: 'Erde', color: '#86593a', steep: '#86593a', grain: 0.2 },
  [STONE]: { name: 'Stein', color: '#8e9299', steep: '#868a91', grain: 0.22 },
  [SNOW]: { name: 'Schnee', color: '#eef4fa', steep: '#9da2aa', grain: 0.06 },
  [DRYGRASS]: { name: 'Steppengras', color: '#c3a955', steep: '#86593a', grain: 0.16 },
  [GRAVEL]: { name: 'Kies', color: '#847e77', steep: '#847e77', grain: 0.3 },
  [WOOD]: { name: 'Holz', color: '#8a6238', steep: '#7a5530', grain: 0.18 },
};

export const itemName = (id) => ({ [LANTERN]: 'Laterne', [AXE]: 'Axt', [PICK]: 'Spitzhacke' })[id] || MATERIALS[id].name;
export const isTool = (id) => id === AXE || id === PICK;

// what you get back from digging a material
export const DROP = { [GRASS]: DIRT, [DRYGRASS]: DIRT };
