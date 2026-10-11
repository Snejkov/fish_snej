import { TAU, angleDelta, clamp, clamp01, fbm2, makeNoise2D, mulberry32, smoothstep } from "./util.js";

export const WORLD_SIZE = 1000;
export const WATER_REGION = 440;
export const MAX_DEPTH = 26;
export const HOLE_DOCK_MIN = 24;
export const HOLE_DOCK_MAX = 68;
export const FLAT_MIN_DEPTH = 1.2;
export const FLAT_RADIUS = 30;
export const HOLE_RADIUS = 30;
export const DOCK_LAND = 3.5;
export const SNEJ_FIXED_SEED = 0x534e454a;
export const SNEJ_LAKE_NAME = "Snej Lake";

export class SnejLake {
  constructor(seed = 12345) {
    this.seed = seed >>> 0;
    this.rand = mulberry32(this.seed);
    this.noise = makeNoise2D(this.seed);
    this.rampSmooth = 0.34 + this.rand() * 0.04;
    this.rampExp = 0.72 + this.rand() * 0.52;
    this.stepDefs = [0.18, 0.4, 0.63, 0.85].map((k, i) => ({
      k,
      width: 0.026 + this.rand() * 0.03,
      amp: 0.8 + this.rand() * 1.35,
      jitter: i * 19.7 + this.rand() * 9
    }));
    this.dockLength = 44;
    this.dockAngle = this.pickDockAngle();
    this.dockDir = { x: -Math.cos(this.dockAngle), z: -Math.sin(this.dockAngle) };
    this.dockSide = { x: -this.dockDir.z, z: this.dockDir.x };
    this.dockWidth = 4.2;
    this.dockStart = {
      x: Math.cos(this.dockAngle) * (this.shoreRadius(this.dockAngle) + DOCK_LAND),
      z: Math.sin(this.dockAngle) * (this.shoreRadius(this.dockAngle) + DOCK_LAND)
    };
    this.dockEnd = {
      x: this.dockStart.x + this.dockDir.x * this.dockLength,
      z: this.dockStart.z + this.dockDir.z * this.dockLength
    };
    this.dockY = 1.8;
    this.mainHole = this.placeMainHole();
    this.mainFlat = this.placeMainFlat();
    this.extraHoles = this.placeExtraFeatures(1 + Math.floor(this.rand() * 2), true);
    this.extraFlats = this.placeExtraFeatures(2 + Math.floor(this.rand() * 2), false);
    this.structures = this.placeStructures();
    this.dockY = this.pickDockY();
    this.start = this.makeStart();
  }

  shoreRadius(angle) {
    const n = fbm2(this.noise, Math.cos(angle) * 1.7 + 3, Math.sin(angle) * 1.7 - 5, 5);
    const n2 = fbm2(this.noise, Math.cos(angle) * 4.1 - 2, Math.sin(angle) * 4.1 + 7, 4);
    return clamp(130 + 34 * n + 12 * n2, 88, 172);
  }

  radialInfo(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const shore = this.shoreRadius(a);
    const k = clamp01((shore - r) / shore);
    return { r, a, shore, k };
  }

  baseDepthAt(x, z) {
    const info = this.radialInfo(x, z);
    if (info.k <= 0) return -this.landHeightAt(x, z);
    const smooth = smoothstep(0, this.rampSmooth, info.k);
    let depth = MAX_DEPTH * 0.78 * smooth * Math.pow(info.k, this.rampExp);
    for (const step of this.stepDefs) {
      const jitter = fbm2(this.noise, x * 0.013 + step.jitter, z * 0.013 - step.jitter, 3) * 0.015;
      const d = Math.abs(info.k - step.k - jitter);
      depth += (1 - smoothstep(0, step.width, d)) * step.amp;
    }
    return Math.max(0, depth);
  }

  depthAt(x, z) {
    const info = this.radialInfo(x, z);
    if (info.k <= 0) return -this.landHeightAt(x, z);
    let depth = this.baseDepthAt(x, z);
    const shoreFade = smoothstep(0, 0.12, info.k);
    for (const h of [this.mainHole, ...(this.extraHoles || [])]) {
      depth += h.amp * (1 - smoothstep(0, h.r, Math.hypot(x - h.x, z - h.z))) * shoreFade;
    }
    for (const f of [this.mainFlat, ...(this.extraFlats || [])]) {
      const want = f.amp * (1 - smoothstep(0, f.r, Math.hypot(x - f.x, z - f.z)));
      depth -= Math.min(want, Math.max(0, depth - FLAT_MIN_DEPTH)) * shoreFade;
    }
    return clamp(depth, 0, 31);
  }

  heightAt(x, z) {
    const depth = this.depthAt(x, z);
    if (depth > 0) return -depth;
    return this.landHeightAt(x, z);
  }

  landHeightAt(x, z) {
    const info = this.radialInfo(x, z);
    const dist = Math.max(0, info.r - info.shore);
    const n = fbm2(this.noise, x * 0.009 + 17, z * 0.009 - 11, 5);
    return clamp(0.25 + dist * 0.045 + n * 2.4, 0.15, 28);
  }

  bedAt(x, z) {
    const d = this.depthAt(x, z);
    const dx = this.depthAt(x + 1.5, z) - this.depthAt(x - 1.5, z);
    const dz = this.depthAt(x, z + 1.5) - this.depthAt(x, z - 1.5);
    const slope = Math.hypot(dx, dz) / 3;
    const n = fbm2(this.noise, x * 0.04 + 20, z * 0.04 - 20, 5);
    const bedValue = clamp01(0.52 + n * 0.62 + clamp01(slope - 0.3) * 0.7 - clamp01((d - 4) / 18) * 0.66);
    const kind = bedValue < 0.34 ? "mud" : bedValue < 0.68 ? "sand" : "rock";
    return { kind, value: bedValue };
  }

  pickDockAngle() {
    let best = { angle: 0, score: -Infinity };
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * TAU + this.rand() * 0.08;
      const shore = this.shoreRadius(angle);
      const x = Math.cos(angle) * (shore - (this.dockLength - DOCK_LAND));
      const z = Math.sin(angle) * (shore - (this.dockLength - DOCK_LAND));
      const tip = this.baseDepthAt(x, z);
      const inBand = tip >= 7 && tip <= 17 ? 100 : 0;
      const score = inBand - Math.abs(tip - 11);
      if (score > best.score) best = { angle, score };
    }
    return best.angle;
  }

  placeMainHole() {
    let best = null;
    for (let i = 0; i < 24; i += 1) {
      const dist = HOLE_DOCK_MIN + (HOLE_DOCK_MAX - HOLE_DOCK_MIN) * (i / 23);
      const side = (i % 2 === 0 ? 1 : -1) * (0.2 + this.rand() * 0.5);
      const x = this.dockEnd.x + this.dockDir.x * dist + this.dockSide.x * side * dist;
      const z = this.dockEnd.z + this.dockDir.z * dist + this.dockSide.z * side * dist;
      const info = this.radialInfo(x, z);
      const base = this.baseDepthAt(x, z);
      const inset = info.shore - info.r;
      if (inset >= 20 && base >= 5 && base <= 24) {
        const score = -Math.abs(base - 13) + inset * 0.02;
        if (!best || score > best.score) best = { x, z, score, base };
      }
    }
    if (!best) {
      best = {
        x: this.dockEnd.x + this.dockDir.x * 42,
        z: this.dockEnd.z + this.dockDir.z * 42,
        base: 12,
        score: 0
      };
    }
    return { x: best.x, z: best.z, r: HOLE_RADIUS, amp: clamp(24 - best.base, 12, 21) };
  }

  placeMainFlat() {
    const dir = this.dockAngle + Math.PI + (this.rand() - 0.5) * 0.7;
    const shore = this.shoreRadius(dir);
    const r = shore - 28;
    let x = Math.cos(dir) * r;
    let z = Math.sin(dir) * r;
    if (Math.hypot(x - this.mainHole.x, z - this.mainHole.z) < 45) {
      x += Math.cos(dir + 1.2) * 42;
      z += Math.sin(dir + 1.2) * 42;
    }
    const base = this.baseDepthAt(x, z);
    return { x, z, r: FLAT_RADIUS, amp: clamp(base - 2.5, 0, 10) };
  }

  placeExtraFeatures(count, hole) {
    const items = [];
    let guard = 0;
    while (items.length < count && guard < 160) {
      guard += 1;
      const a = this.rand() * TAU;
      const shore = this.shoreRadius(a);
      const inset = hole ? 30 + this.rand() * 65 : 10 + this.rand() * 38;
      const r = shore - inset;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const far = [this.mainHole, this.mainFlat, ...items].every((p) => Math.hypot(x - p.x, z - p.z) > 44);
      if (!far || this.depthAt(x, z) < (hole ? 6 : 2)) continue;
      const base = this.baseDepthAt(x, z);
      items.push({ x, z, r: hole ? 22 + this.rand() * 14 : 20 + this.rand() * 18, amp: hole ? 4 + this.rand() * 8 : clamp(base - 2.5, 0, 5) });
    }
    return items;
  }

  placeStructures() {
    const items = [];
    for (let i = 0; i < 4; i += 1) {
      const dist = 8 + this.rand() * 32;
      const angle = this.dockAngle + (this.rand() - 0.5) * 1.7;
      const x = this.dockEnd.x + Math.cos(angle) * dist;
      const z = this.dockEnd.z + Math.sin(angle) * dist;
      items.push(this.makeStructure(x, z, i));
    }
    let guard = 0;
    const target = 16 + Math.floor(this.rand() * 8);
    while (items.length < target && guard < 300) {
      guard += 1;
      const a = this.rand() * TAU;
      const shore = this.shoreRadius(a);
      const r = 14 + this.rand() * (shore - 26);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.depthAt(x, z) < 1.8) continue;
      items.push(this.makeStructure(x, z, items.length));
    }
    return items;
  }

  makeStructure(x, z, i) {
    const snag = i % 3 === 1;
    const h = snag ? 1.8 + this.rand() * 3.4 : 0.7 + this.rand() * 1.9;
    const depth = this.depthAt(x, z);
    return {
      kind: snag ? "snag" : "rock",
      x,
      z,
      h: Math.min(h, Math.max(0.35, depth - 0.25)),
      r: snag ? 0.55 + this.rand() * 0.45 : 0.9 + this.rand() * 1.2,
      rot: this.rand() * TAU
    };
  }

  makeStart() {
    const x = this.dockStart.x - this.dockDir.x * 6;
    const z = this.dockStart.z - this.dockDir.z * 6;
    return { x, y: this.heightAt(x, z) + 0.04, z, yaw: Math.atan2(this.dockDir.x, this.dockDir.z) };
  }

  pickDockY() {
    let landMax = 0;
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;
      const x = this.dockStart.x + this.dockDir.x * this.dockLength * t;
      const z = this.dockStart.z + this.dockDir.z * this.dockLength * t;
      landMax = Math.max(landMax, this.heightAt(x, z));
    }
    return clamp(landMax + 0.5, 1.15, 2.6);
  }

  dockLocal(x, z, out = { along: 0, side: 0 }) {
    const vx = x - this.dockStart.x;
    const vz = z - this.dockStart.z;
    out.along = vx * this.dockDir.x + vz * this.dockDir.z;
    out.side = vx * this.dockSide.x + vz * this.dockSide.z;
    return out;
  }

  distToDock(x, z) {
    const p = this.dockLocal(x, z);
    const along = clamp(p.along, 0, this.dockLength);
    const side = Math.abs(p.side);
    const dx = p.along - along;
    return Math.hypot(dx, Math.max(0, side - this.dockWidth * 0.5));
  }

  dockBlocksSegment(x0, y0, z0, x1, y1, z1) {
    const steps = 16;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const z = z0 + (z1 - z0) * t;
      const p = this.dockLocal(x, z);
      if (p.along >= -0.5 && p.along <= this.dockLength + 0.5 && Math.abs(p.side) <= this.dockWidth * 0.55 && Math.abs(y - this.dockY) < 0.45) {
        return true;
      }
    }
    return false;
  }

  shoreSlopeSamples() {
    let maxSlope = 0;
    for (let i = 0; i < 96; i += 1) {
      const a = (i / 96) * TAU;
      const r = this.shoreRadius(a);
      const d1 = this.depthAt(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
      const d2 = this.depthAt(Math.cos(a) * (r - 10), Math.sin(a) * (r - 10));
      maxSlope = Math.max(maxSlope, Math.abs(d2 - d1) / 7);
    }
    return maxSlope;
  }

  dockClearance() {
    let clear = Infinity;
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;
      const x = this.dockStart.x + this.dockDir.x * this.dockLength * t;
      const z = this.dockStart.z + this.dockDir.z * this.dockLength * t;
      clear = Math.min(clear, this.dockY - this.heightAt(x, z));
    }
    return clear;
  }

  maxFromDockReach() {
    let max = 0;
    for (let i = 0; i < 64; i += 1) {
      const a = (i / 64) * TAU;
      const shore = this.shoreRadius(a);
      for (let j = 0; j < 8; j += 1) {
        const r = shore * (0.15 + j * 0.1);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (this.depthAt(x, z) > 1) max = Math.max(max, Math.hypot(x - this.dockEnd.x, z - this.dockEnd.z));
      }
    }
    return max;
  }
}

export function randomLakeSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
