import { clamp, lerp } from "./util.js";

export const DEFAULT_FLOAT_DEPTH = 0.5;
export const MIN_UPPER_LINE = 0.25;
export const FLOAT_RETRIEVE_FRACTION = 0.4;
const MAX_ADJUSTMENT_SLACK = 0.12;

export function rigForRod(length, depth = DEFAULT_FLOAT_DEPTH) {
  const rodLength = Number.isFinite(length) && length > 0 ? length : 4;
  const lineLength = rodLength * 2;
  const maxDepth = Math.max(0, lineLength - MIN_UPPER_LINE);
  const floatDepth = clamp(Number.isFinite(depth) ? depth : DEFAULT_FLOAT_DEPTH, 0, maxDepth);
  return { lineLength, floatDepth, maxDepth, upperLine: lineLength - floatDepth,
    castRange: lineLength - floatDepth, rodReach: rodLength + lineLength - floatDepth };
}

const point = () => ({ x: 0, y: 0, z: 0 });
const copy = (out, source) => Object.assign(out, { x: source.x, y: source.y, z: source.z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function limitLineEnd(tip, end, length, out) {
  const d = distance(tip, end);
  const t = d > length ? length / d : 1;
  out.x = lerp(tip.x, end.x, t);
  out.y = lerp(tip.y, end.y, t);
  out.z = lerp(tip.z, end.z, t);
  return out;
}

// Gravity sag and gentle sway are visual only. Solve the actual polyline's fixed length.
export function writeFixedLine(tip, end, length, positions, time = 0) {
  const count = positions.length / 3;
  const straight = distance(tip, end);
  if (!Number.isInteger(count) || count < 2 || !Number.isFinite(straight)
    || !Number.isFinite(length) || length < 0 || straight > length + 1e-6) return false;
  time = Number.isFinite(time) ? time : 0;
  const dx = end.x - tip.x, dz = end.z - tip.z, horizontal = Math.hypot(dx, dz);
  const nx = horizontal > 1e-8 ? -dz / horizontal : 1;
  const nz = horizontal > 1e-8 ? dx / horizontal : 0;
  const fill = (bow, write) => {
    let sum = 0, px = tip.x, py = tip.y, pz = tip.z;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1), sag = 4 * t * (1 - t) * bow;
      const sway = sag * (0.14 + 0.08 * Math.sin(time * 1.2 + t * 3));
      const x = lerp(tip.x, end.x, t) + nx * sway;
      const y = lerp(tip.y, end.y, t) - sag;
      const z = lerp(tip.z, end.z, t) + nz * sway;
      if (i > 0) sum += Math.hypot(x - px, y - py, z - pz);
      if (write) { positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z; }
      px = x; py = y; pz = z;
    }
    return sum;
  };
  let lo = 0, hi = length;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    if (fill(mid, false) < length) lo = mid; else hi = mid;
  }
  fill((lo + hi) / 2, true);
  return true;
}

export class SnejFloatRig {
  constructor() {
    this.lastTip = point();
    this.target = point();
    this.sample = point();
    this.previous = point();
    this.hook = point();
    this.adjustmentTravel = { x: 0, z: 0 };
    this.anchored = false;
    this.actualDepth = 0;
    this.bottomSlack = 0;
  }

  reset() {
    this.anchored = false;
    this.adjustmentTravel.x = 0;
    this.adjustmentTravel.z = 0;
    this.actualDepth = 0;
    this.bottomSlack = 0;
  }

  adjustmentDelta(axis, delta) {
    const travel = this.adjustmentTravel[axis];
    if (travel * delta < 0) {
      const takeUp = Math.min(Math.abs(travel), Math.abs(delta)) * Math.sign(delta);
      this.adjustmentTravel[axis] = travel + takeUp;
      delta -= takeUp;
    }
    this.adjustmentTravel[axis] = clamp(this.adjustmentTravel[axis] + delta, -MAX_ADJUSTMENT_SLACK, MAX_ADJUSTMENT_SLACK);
    return delta;
  }

  follow(dt, tip, bobber, rig, ctx, adjustmentTip = tip) {
    if (dt <= 0) return true;
    const surfaceY = (p) => ctx.surfaceY(p.x, p.z);
    copy(this.target, bobber);
    if (this.anchored) {
      // Reversing first takes up bounded free play; only new travel nudges the float.
      this.target.x += this.adjustmentDelta("x", adjustmentTip.x - this.lastTip.x);
      this.target.z += this.adjustmentDelta("z", adjustmentTip.z - this.lastTip.z);
    }
    // The float stays on the surface, inside the sphere allowed by the upper line.
    for (let i = 0; i < 32; i += 1) {
      this.target.y = surfaceY(this.target);
      const vertical = tip.y - this.target.y;
      if (Math.abs(vertical) > rig.upperLine) return false;
      const radius = Math.sqrt(Math.max(0, rig.upperLine * rig.upperLine - vertical * vertical));
      const dx = this.target.x - tip.x, dz = this.target.z - tip.z, d = Math.hypot(dx, dz);
      if (d > radius) {
        const scale = radius / d;
        this.target.x = tip.x + dx * scale;
        this.target.z = tip.z + dz * scale;
      }
      const player = ctx.playerOrigin;
      const reach = player ? Math.hypot(this.target.x - player.x, this.target.z - player.z) : 0;
      // Casting uses the line budget; later pole corrections use the physical pole-plus-line span.
      if (reach > rig.rodReach) {
        const scale = rig.rodReach / reach;
        this.target.x = player.x + (this.target.x - player.x) * scale;
        this.target.z = player.z + (this.target.z - player.z) * scale;
      } else if (d <= radius + 1e-8) break;
    }
    copy(this.previous, bobber);
    const steps = Math.max(1, Math.ceil(Math.hypot(this.target.x - bobber.x, this.target.z - bobber.z) / 0.15));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      this.sample.x = lerp(bobber.x, this.target.x, t);
      this.sample.z = lerp(bobber.z, this.target.z, t);
      this.sample.y = surfaceY(this.sample);
      if (!ctx.isWaterAt(this.sample) || ctx.lineObstruction?.(this.previous, this.sample, 0)) break;
      copy(this.previous, this.sample);
    }
    if (!ctx.isWaterAt(this.previous) || distance(tip, this.previous) > rig.upperLine + 1e-6
      || ctx.lineObstruction?.(tip, this.previous, 0)) return false;
    copy(bobber, this.previous);
    copy(this.lastTip, adjustmentTip);
    this.anchored = true;
    copy(this.hook, bobber);
    const bed = ctx.bedY?.(bobber.x, bobber.z);
    // Bottom contact leaves reserved lower-line slack instead of changing the cast budget.
    this.actualDepth = Number.isFinite(bed) ? Math.min(rig.floatDepth, Math.max(0, bobber.y - bed - 0.02)) : rig.floatDepth;
    this.bottomSlack = rig.floatDepth - this.actualDepth;
    this.hook.y -= this.actualDepth;
    return true;
  }
}
