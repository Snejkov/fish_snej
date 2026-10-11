import { clamp, clamp01, lerp } from "./util.js";
import { RODS } from "./rods.js?v=0.0.4-hf2";
import { rigForRod } from "./floatRig.js?v=0.0.4-hf6";

// Stage 4 cast analysis, sections 1, 4, 5, 9, and 10. No fish behavior is active.
const GRAVITY = 9.8;
const CAST_HEADROOM = 1.07;
const CAST_SPEED_MIN = 0.5;
const CAST_TOL = 0.06;
const CAST_MISS = 0.30;
const CHARGE_RATE = 0.4;
const SPLASH_BASE = 16;
const SPLASH_MIN = 4;
const SPLASH_SCALE = 0.55;
const STARTLE_R = [1.0, 3.2];
const STARTLE_SEC = [0.8, 5.0];
const WAKE_BOB_AMP = 0.012;
const WAKE_BOB_FREQ = 1.6;
const CAST_TIP_FALLBACK = { x: 0, y: 1.4, z: 0 };
const FLIGHT_STEP = 0.055;
const FLIGHT_DRAG = 0.0055;
const FLIGHT_TIME_SCALE = 0.65;
const PREDICTION_INTERVAL = 0.08;
const WATER_DEPTH_MIN = 0.25;
const RETRIEVE_SPEED = 9;
const RETRIEVE_DISTANCE = 0.8;

const elevFor = (pitch) => clamp(0.46 + pitch * 0.55, 0.16, 0.95);

function flightRange(speed, elev, y0) {
  const n = Math.hypot(1, elev);
  let vx = speed / n;
  let vy = (speed * elev) / n;
  let x = 0, y = y0;
  const dt = 0.055;
  for (let i = 0; i < 200 && y > 0; i += 1) {
    vy -= GRAVITY * dt;
    const k = 1 - 0.0055 * Math.hypot(vx, vy) * dt;
    vx *= k; vy *= k;
    x += vx * dt; y += vy * dt;
  }
  return x;
}

function castTopSpeed(rangeM) {
  const elev = elevFor(-0.03);
  const want = rangeM * CAST_HEADROOM;
  let lo = 5, hi = 60;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (flightRange(mid, elev, 3) < want) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const point = () => ({ x: 0, y: 0, z: 0 });
const copy = (out, source) => Object.assign(out, { x: source.x, y: source.y, z: source.z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function advanceFlight(position, velocity) {
  velocity.y -= GRAVITY * FLIGHT_STEP;
  const k = 1 - FLIGHT_DRAG * Math.hypot(velocity.x, velocity.y, velocity.z) * FLIGHT_STEP;
  velocity.x *= k; velocity.y *= k; velocity.z *= k;
  position.x += velocity.x * FLIGHT_STEP;
  position.y += velocity.y * FLIGHT_STEP;
  position.z += velocity.z * FLIGHT_STEP;
}

function waterRange(speed, elev, height) {
  const position = { x: 0, y: height, z: 0 };
  const n = Math.hypot(1, elev);
  const velocity = { x: speed / n, y: speed * elev / n, z: 0 };
  for (let i = 0; i < 200; i += 1) {
    const x = position.x, y = position.y;
    advanceFlight(position, velocity);
    if (position.y <= 0) return lerp(x, position.x, clamp01(y / (y - position.y)));
  }
  return position.x;
}

export class SnejCastSystem {
  constructor({ rodRange = RODS[0].range, floatDepth = 0, getCastOrigin } = {}) {
    this.rodRange = Math.max(CAST_SPEED_MIN, finite(rodRange, RODS[0].range));
    this.rig = rigForRod(this.rodRange / 2, floatDepth);
    this.castRange = this.rig.castRange;
    this.castTop = castTopSpeed(this.castRange);
    this.maxLine = this.rig.lineLength;
    this.getCastOrigin = getCastOrigin;
    this.state = {};
    this._origin = point();
    this._position = point();
    this._previous = point();
    this._velocity = point();
    this.reset();
  }

  reset() {
    Object.assign(this.state, {
      fs: "idle", charge: 0, chargeDir: 1,
      castLead: 0, // Reserved for Stage 4.5 swing synchronization.
      castPower: 0, castPerfect: false, castAcc: 0, castDist: 0,
      castOrigin: point(), bobber: point(), bobberVel: point(),
      castPlayerOrigin: point(), requestedDist: 0, aimValid: false, canRelease: false,
      lastRejection: null,
      targetPower: 0, minCastDist: 0, aimPoint: point(), aimDist: 0,
      aimCapped: false, castObstruction: null, retrieving: false,
      predictedLanding: point(), waitTime: 0
    });
    this._ctx = null;
    this._flightAccum = 0;
    this._predictionTime = PREDICTION_INTERVAL;
    return this.state;
  }

  onActionDown() {
    if (this.state.fs !== "idle") return false;
    const ctx = this._ctx;
    this.reset();
    this._ctx = ctx;
    this.state.fs = "charge";
    this.updateAim();
    return true;
  }

  onActionUp() {
    const state = this.state;
    if (state.fs !== "charge") return false;
    const err = Math.abs(state.charge - state.targetPower);
    state.castPerfect = err <= CAST_TOL + Number.EPSILON;
    state.castAcc = clamp01(1 - Math.max(0, err - CAST_TOL) / (CAST_MISS - CAST_TOL));
    state.castPower = state.charge;
    state.requestedDist = state.charge * this.castRange;
    // Validate the exact release, not the throttled preview or the ideal aim alone.
    const landing = this.predictLanding(state.castPower, state.predictedLanding);
    const reason = !state.aimValid ? "water"
      : state.requestedDist < state.minCastDist ? "range"
        : landing.obstruction || (!landing.water ? "water" : !this.isRigWaterAt(landing) ? "depth" : null);
    if (reason) {
      this.cancelCharge();
      state.lastRejection = reason;
      state.canRelease = false;
      return false;
    }
    state.castLead = 0;
    state.castObstruction = null;
    state.retrieving = false;
    state.fs = "flight";
    copy(state.castOrigin, this.getCastOriginLocal());
    copy(state.castPlayerOrigin, this._ctx?.pos || point());
    copy(state.bobber, state.castOrigin);
    copy(this._position, state.castOrigin);
    copy(this._previous, state.castOrigin);
    this.computeCastVelocityLocal(state.castPower, this._velocity);
    copy(state.bobberVel, this._velocity);
    this._flightAccum = 0;
    return true;
  }

  cancelCharge() {
    if (this.state.fs !== "charge") return;
    this.state.fs = "idle";
    this.state.charge = 0;
    this.state.chargeDir = 1;
    this.state.castObstruction = null;
    this.state.canRelease = false;
    this.state.requestedDist = 0;
  }

  setRodRange(range, floatDepth = this.rig.floatDepth) {
    if (this.state.fs === "charge" || this.state.fs === "flight") return false;
    if (!Number.isFinite(range) || range <= 0) return false;
    this.rodRange = range;
    this.rig = rigForRod(range / 2, floatDepth);
    this.castRange = this.rig.castRange;
    this.castTop = castTopSpeed(this.castRange);
    this.maxLine = this.rig.lineLength;
    this.reset();
    return true;
  }

  isWaterAt(p) {
    const ctx = this._ctx || {};
    const surface = ctx.waterSurfaceY?.(p.x, p.z) ?? 0;
    const ground = ctx.terrainHeightAt?.(p.x, p.z) ?? -1;
    const depth = ctx.terrainDepthAt?.(p.x, p.z) ?? surface - ground;
    return depth > WATER_DEPTH_MIN && ground < surface && (ctx.isWaterAt?.(p.x, p.z) ?? true);
  }

  isRigWaterAt(p) {
    if (!this.isWaterAt(p)) return false;
    const ctx = this._ctx || {};
    const surface = ctx.waterSurfaceY?.(p.x, p.z) ?? 0;
    const depth = ctx.terrainDepthAt?.(p.x, p.z) ?? surface - (ctx.terrainHeightAt?.(p.x, p.z) ?? -1);
    return depth >= this.rig.floatDepth + 0.02;
  }

  getCastOriginLocal() {
    const source = this.getCastOrigin?.();
    const pos = this._ctx?.pos || point();
    this._origin.x = finite(source?.x, finite(pos.x));
    this._origin.y = finite(source?.y, finite(pos.y) + CAST_TIP_FALLBACK.y);
    this._origin.z = finite(source?.z, finite(pos.z));
    return this._origin;
  }

  computeCastVelocityLocal(power, out = point()) {
    const yaw = finite(this._ctx?.yaw);
    const elev = elevFor(finite(this._ctx?.pitch));
    const origin = this.getCastOriginLocal();
    const pos = this._ctx?.pos || point();
    const surface = this._ctx?.waterSurfaceY?.(origin.x, origin.z) ?? 0;
    const ox = origin.x - finite(pos.x), oz = origin.z - finite(pos.z);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rangeFor = (speed) => {
      const travel = waterRange(speed, elev, Math.max(0, origin.y - surface));
      return Math.hypot(ox + fx * travel, oz + fz * travel);
    };
    const want = this.castRange * clamp01(finite(power));
    let lo = 0, hi = Math.max(this.castTop, 60);
    for (let i = 0; i < 22; i += 1) {
      const mid = (lo + hi) / 2;
      if (rangeFor(mid) <= want) lo = mid; else hi = mid;
    }
    const speed = lo;
    const n = Math.hypot(1, elev);
    out.x = Math.sin(yaw) * speed / n;
    out.y = elev * speed / n;
    out.z = Math.cos(yaw) * speed / n;
    return out;
  }

  updateAim() {
    const state = this.state;
    const ctx = this._ctx || {};
    const pos = ctx.pos || point();
    const origin = this.getCastOriginLocal();
    const yaw = finite(ctx.yaw), pitch = finite(ctx.pitch);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const surface = ctx.waterSurfaceY?.(pos.x, pos.z) ?? 0;
    const originOffset = Math.hypot(origin.x - finite(pos.x), origin.z - finite(pos.z));
    state.minCastDist = originOffset + waterRange(CAST_SPEED_MIN, elevFor(pitch), Math.max(0, origin.y - surface));
    const aimMax = this.castRange;
    const eyeY = finite(pos.y) + 1.62;
    const dirY = Math.sin(pitch);
    const h = Math.abs(Math.cos(pitch));
    const look = dirY < -0.02 ? h * Math.max(0, eyeY - surface) / -dirY : Infinity;
    state.aimCapped = look > aimMax || ctx.aimBlockedByDome?.({ x: fx * h, y: dirY, z: fz * h }, eyeY) === "cap";
    state.aimDist = clamp(state.aimCapped ? aimMax : look, state.minCastDist, aimMax);
    state.aimPoint.x = finite(pos.x) + fx * state.aimDist;
    state.aimPoint.y = surface;
    state.aimPoint.z = finite(pos.z) + fz * state.aimDist;
    state.targetPower = state.aimDist / this.castRange;
    state.aimValid = dirY < -0.02 && this.isWaterAt(state.aimPoint);
  }

  impact(previous, end, origin) {
    const ctx = this._ctx || {};
    const water = ctx.waterSurfaceY?.(end.x, end.z) ?? 0;
    if (previous.y > water && end.y <= water) {
      // Clip the final step to the water plane, removing range jumps at step boundaries.
      const t = clamp01((previous.y - water) / (previous.y - end.y));
      end.x = lerp(previous.x, end.x, t);
      end.z = lerp(previous.z, end.z, t);
      end.y = water;
    }
    if (ctx.dockBlocksSegment?.(previous, end)) return "dock";
    const obstruction = ctx.lineObstruction?.(previous, end, 0);
    if (obstruction) return obstruction === "land" ? "terrain" : obstruction;
    const ground = ctx.terrainHeightAt?.(end.x, end.z) ?? -1;
    const surface = Math.max(ground, water);
    if (end.y > surface) return null;
    end.y = surface;
    const depth = ctx.terrainDepthAt?.(end.x, end.z) ?? water - ground;
    if (depth <= WATER_DEPTH_MIN || !this.isWaterAt(end)) return "terrain";
    if (!this.isRigWaterAt(end)) return "depth";
    // The fixed rig bows sideways; obsolete vertical sag can falsely intersect the lake bed.
    const lineHit = ctx.lineObstruction?.(ctx.rodTip || origin, end, 0);
    return lineHit ? (lineHit === "land" ? "terrain" : lineHit) : "water";
  }

  predictLanding(power, out = point()) {
    const origin = { ...this.getCastOriginLocal() };
    const position = { ...origin };
    const previous = point();
    const velocity = this.computeCastVelocityLocal(power);
    let hit = null;
    for (let i = 0; i < 160; i += 1) {
      copy(previous, position);
      advanceFlight(position, velocity);
      hit = this.impact(previous, position, origin);
      if (hit) {
        if (hit !== "water") copy(position, previous);
        break;
      }
    }
    copy(out, position);
    const ground = this._ctx?.terrainHeightAt?.(position.x, position.z) ?? -1;
    out.y = Math.max(ground, this._ctx?.waterSurfaceY?.(position.x, position.z) ?? 0);
    out.obstruction = hit && hit !== "water" ? hit : null;
    out.water = hit === "water";
    return out;
  }

  tick(dt, ctx) {
    const state = this.state;
    if (ctx) this._ctx = ctx;
    dt = Math.max(0, finite(dt));
    if (state.fs === "idle" || state.fs === "charge") this.updateAim();
    if (state.fs === "charge") {
      const phase = ((state.chargeDir > 0 ? state.charge : 2 - state.charge) + CHARGE_RATE * dt) % 2;
      state.charge = phase <= 1 ? phase : 2 - phase;
      state.chargeDir = phase < 1 ? 1 : -1;
      state.requestedDist = state.charge * this.castRange;
      this._predictionTime += dt;
      if (this._predictionTime >= PREDICTION_INTERVAL) {
        this._predictionTime %= PREDICTION_INTERVAL;
        this.predictLanding(state.charge, state.predictedLanding);
        state.castObstruction = state.predictedLanding.obstruction;
      }
      state.canRelease = state.aimValid && state.requestedDist >= state.minCastDist
        && state.predictedLanding.water && this.isRigWaterAt(state.predictedLanding) && !state.castObstruction;
    } else if (state.fs === "flight" && state.retrieving && dt > 0) {
      const origin = this._ctx?.rodTip || this.getCastOriginLocal();
      const d = distance(state.bobber, origin);
      if (d < RETRIEVE_DISTANCE) {
        state.fs = "idle";
        state.retrieving = false;
        state.castObstruction = null;
      } else if (dt > 0) {
        const t = Math.min(1, RETRIEVE_SPEED * dt / d);
        state.bobber.x = lerp(state.bobber.x, origin.x, t);
        state.bobber.y = lerp(state.bobber.y, origin.y, t);
        state.bobber.z = lerp(state.bobber.z, origin.z, t);
      }
    } else if (state.fs === "flight" && dt > 0) {
      // Fixed steps keep prediction and landing frame-rate independent; interpolate visuals.
      this._flightAccum = Math.min(this._flightAccum + dt * FLIGHT_TIME_SCALE, FLIGHT_STEP * 200);
      while (this._flightAccum >= FLIGHT_STEP && state.fs === "flight" && !state.retrieving) {
        this._flightAccum -= FLIGHT_STEP;
        copy(this._previous, this._position);
        advanceFlight(this._position, this._velocity);
        const hit = this.impact(this._previous, this._position, state.castOrigin);
        if (hit) {
          if (hit === "water") {
            state.fs = "wait";
            state.waitTime = 0;
            state.castDist = Math.hypot(this._position.x - state.castPlayerOrigin.x, this._position.z - state.castPlayerOrigin.z);
          } else {
            copy(this._position, this._previous);
            state.castObstruction = hit;
            state.retrieving = true;
          }
          copy(state.bobber, this._position);
        }
      }
      copy(state.bobberVel, this._velocity);
      if (state.fs === "flight" && !state.retrieving) {
        const alpha = this._flightAccum / FLIGHT_STEP;
        state.bobber.x = lerp(this._previous.x, this._position.x, alpha);
        state.bobber.y = lerp(this._previous.y, this._position.y, alpha);
        state.bobber.z = lerp(this._previous.z, this._position.z, alpha);
      }
    } else if (state.fs === "wait") state.waitTime += dt;
    return state;
  }
}

export {
  GRAVITY, CAST_HEADROOM, CAST_SPEED_MIN, CAST_TOL, CAST_MISS,
  CHARGE_RATE, FLIGHT_TIME_SCALE, SPLASH_BASE, SPLASH_MIN, SPLASH_SCALE, STARTLE_R, STARTLE_SEC,
  WAKE_BOB_AMP, WAKE_BOB_FREQ, CAST_TIP_FALLBACK, elevFor, flightRange, castTopSpeed
};
