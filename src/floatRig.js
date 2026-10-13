import { clamp, lerp } from "./util.js";

export const DEFAULT_FLOAT_DEPTH = 0.5;
export const MIN_UPPER_LINE = 0.25;
export const FLOAT_RETRIEVE_FRACTION = 0.4;
const LINE_STEP = 1 / 120;
const WATER_DRAG = 7;
const MAX_FLOAT_SPEED = 3;

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
      const sway = sag * (0.035 + 0.02 * Math.sin(time * 1.2 + t * 3));
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
    this.stepTip = point();
    this.velocity = point();
    this.anchored = false;
    this.actualDepth = 0;
    this.bottomSlack = 0;
    this.tension = this.slack = 0;
    this.effectiveLength = 0;
  }

  reset() {
    this.anchored = false;
    copy(this.velocity, point());
    this.actualDepth = 0;
    this.bottomSlack = 0;
    this.tension = this.slack = 0;
    this.effectiveLength = 0;
  }

  follow(dt, tip, bobber, rig, ctx, { settle = false } = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return true;
    if (![tip.x, tip.y, tip.z, bobber.x, bobber.y, bobber.z, rig.upperLine].every(Number.isFinite)
      || rig.upperLine <= 0) return false;
    const elapsed = Math.min(dt, 0.1), steps = Math.ceil(elapsed / LINE_STEP), step = elapsed / steps;
    const rest = rig.upperLine;
    let pullTravel = 0;
    const surfaceY = (p) => ctx.surfaceY(p.x, p.z);
    if (!this.anchored || settle) {
      copy(this.lastTip, tip);
      copy(this.velocity, point());
    }
    for (let frame = 1; frame <= steps; frame++) {
      const progress = frame / steps;
      this.stepTip.x = lerp(this.lastTip.x, tip.x, progress);
      this.stepTip.y = lerp(this.lastTip.y, tip.y, progress);
      this.stepTip.z = lerp(this.lastTip.z, tip.z, progress);
      copy(this.target, bobber);
      const span = distance(this.stepTip, bobber);
      if (!Number.isFinite(span)) return false;
      // Water damps existing float motion; slack transmits neither a push nor pole translation.
      const decay = Math.exp(-WATER_DRAG * step), response = (1 - decay) / WATER_DRAG;
      this.target.x += this.velocity.x * response;
      this.target.z += this.velocity.z * response;
      this.velocity.x *= decay;
      this.velocity.z *= decay;
      const freeX = this.target.x, freeZ = this.target.z;
      // A fixed line must take up any excess immediately, not after a spring stretches it.
      for (let i = 0; i < 32; i++) {
        this.target.y = surfaceY(this.target);
        const vertical = this.stepTip.y - this.target.y;
        if (!Number.isFinite(vertical) || Math.abs(vertical) > rest) return false;
        const radius = Math.sqrt(Math.max(0, rest * rest - vertical * vertical));
        const dx = this.target.x - this.stepTip.x, dz = this.target.z - this.stepTip.z, d = Math.hypot(dx, dz);
        if (d > radius) {
          const scale = radius / d;
          this.target.x = this.stepTip.x + dx * scale;
          this.target.z = this.stepTip.z + dz * scale;
        }
        const player = ctx.playerOrigin;
        const reach = player ? Math.hypot(this.target.x - player.x, this.target.z - player.z) : 0;
        // Casting uses the line budget; later corrections retain the physical pole-plus-line span.
        if (reach > rig.rodReach) {
          const scale = rig.rodReach / reach;
          this.target.x = player.x + (this.target.x - player.x) * scale;
          this.target.z = player.z + (this.target.z - player.z) * scale;
        } else if (d <= radius + 1e-8) break;
      }
      const pullX = this.target.x - freeX, pullZ = this.target.z - freeZ;
      if (!settle) {
        this.velocity.x += pullX / step;
        this.velocity.z += pullZ / step;
        pullTravel += Math.hypot(pullX, pullZ);
        const speed = Math.hypot(this.velocity.x, this.velocity.z);
        if (speed > MAX_FLOAT_SPEED) {
          this.velocity.x *= MAX_FLOAT_SPEED / speed;
          this.velocity.z *= MAX_FLOAT_SPEED / speed;
        }
      }
      copy(this.previous, bobber);
      const sweep = Math.max(1, Math.ceil(Math.hypot(this.target.x - bobber.x, this.target.z - bobber.z) / 0.05));
      for (let i = 1; i <= sweep; i += 1) {
        const t = i / sweep;
        this.sample.x = lerp(bobber.x, this.target.x, t);
        this.sample.z = lerp(bobber.z, this.target.z, t);
        this.sample.y = surfaceY(this.sample);
        if (!Number.isFinite(this.sample.y) || !ctx.isWaterAt(this.sample) || ctx.lineObstruction?.(this.previous, this.sample, 0)) {
          copy(this.velocity, point());
          break;
        }
        copy(this.previous, this.sample);
      }
      if (!ctx.isWaterAt(this.previous) || distance(this.stepTip, this.previous) > rest + 1e-6
        || ctx.lineObstruction?.(this.stepTip, this.previous, 0)) return false;
      copy(bobber, this.previous);
    }
    copy(this.lastTip, tip);
    this.anchored = true;
    const span = distance(tip, bobber);
    this.tension = clamp(pullTravel / elapsed / MAX_FLOAT_SPEED, 0, 1);
    this.slack = Math.max(0, rest - span);
    this.effectiveLength = rest;
    copy(this.hook, bobber);
    const bed = ctx.bedY?.(bobber.x, bobber.z);
    // Bottom contact leaves reserved lower-line slack instead of changing the cast budget.
    this.actualDepth = Number.isFinite(bed) ? Math.min(rig.floatDepth, Math.max(0, bobber.y - bed - 0.02)) : rig.floatDepth;
    this.bottomSlack = rig.floatDepth - this.actualDepth;
    this.hook.y -= this.actualDepth;
    return true;
  }
}
