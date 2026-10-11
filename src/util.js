export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function moveDelta(mx, mz, yaw, speed, dt) {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return {
    dx: (mz * sy - mx * cy) * speed * dt,
    dz: (mz * cy + mx * sy) * speed * dt
  };
}

export function resolveWalkableStart(position, lake, maxDepth = 1) {
  if (!lake || typeof lake.depthAt !== "function") return position;
  const x = Number.isFinite(position?.x) ? position.x : 0;
  const z = Number.isFinite(position?.z) ? position.z : 0;
  return lake.depthAt(x, z) > maxDepth && lake.start ? lake.start : position;
}

export function fract(value) {
  return value - Math.floor(value);
}

export function hash2(x, y, seed = 1) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123);
}

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise2D(seed = 1) {
  function value(ix, iy) {
    return hash2(ix, iy, seed);
  }

  return function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = value(ix, iy);
    const b = value(ix + 1, iy);
    const c = value(ix, iy + 1);
    const d = value(ix + 1, iy + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
  };
}

export function fbm2(noise, x, y, octaves = 5) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export function angleDelta(a, b) {
  let d = (a - b + Math.PI) % TAU;
  if (d < 0) d += TAU;
  return d - Math.PI;
}
