import { clamp01, hash2, lerp, makeNoise2D } from "./util.js";

export function makeTileNoise(seed = 1, period = 64) {
  return function tileNoise(x, y) {
    const px = ((Math.floor(x) % period) + period) % period;
    const py = ((Math.floor(y) % period) + period) % period;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash2(px, py, seed);
    const b = hash2((px + 1) % period, py, seed);
    const c = hash2(px, (py + 1) % period, seed);
    const d = hash2((px + 1) % period, (py + 1) % period, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
  };
}

export function pebbleField(x, z, seed = 1) {
  const n = makeNoise2D(seed);
  const base = n(x * 0.18, z * 0.18) * 0.5 + n(x * 0.73 + 8, z * 0.73 - 4) * 0.25;
  return clamp01(0.5 + base);
}

export function gravelField(x, z, seed = 1) {
  const a = hash2(Math.floor(x * 1.7), Math.floor(z * 1.7), seed);
  const b = hash2(Math.floor(x * 3.4), Math.floor(z * 3.4), seed + 9);
  return clamp01(a * 0.7 + b * 0.3);
}
