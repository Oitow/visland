// Value noise in three dimensions, for caves: the almanac's 2D valueNoise taken one dimension further, on the same
// hash (hash32), so a seed still grows the same caves every time.
import { hash32 } from '../vendor/almanac/random.js';

const lattice = (x, y, z, seed) => hash32((x * 374761393) ^ hash32((y * 668265263) ^ hash32((z * 1274126177) ^ seed))) / 4294967296;
const fade = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

/**
 * A number in 0..1 that varies smoothly through space: a random number at each whole point, the eight round a point
 * blended (eased, so the grid does not show).
 */
export function valueNoise3(x, y, z, seed = 0) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const u = fade(x - xi),
    v = fade(y - yi),
    w = fade(z - zi);
  const c = (dx, dy, dz) => lattice(xi + dx, yi + dy, zi + dz, seed);
  return mix(
    mix(mix(c(0, 0, 0), c(1, 0, 0), u), mix(c(0, 1, 0), c(1, 1, 0), u), v),
    mix(mix(c(0, 0, 1), c(1, 0, 1), u), mix(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
