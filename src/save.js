// What is kept between visits, per island: only what the player changed (the island itself grows again from its
// seed), what they carry, the crystals found, where they stood and the time of day. Kept in this browser only.

const key = (seed) => `visland:${seed}`;

export function load(seed) {
  try {
    const s = localStorage.getItem(key(seed));
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function save(seed, state) {
  try {
    localStorage.setItem(key(seed), JSON.stringify(state));
    localStorage.setItem('visland:last', String(state.name || seed));
  } catch {
    // storage may be full or blocked: the game goes on without saving
  }
}

export function lastSeed() {
  try {
    return localStorage.getItem('visland:last');
  } catch {
    return null;
  }
}
