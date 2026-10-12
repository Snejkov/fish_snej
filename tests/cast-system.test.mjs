import assert from "node:assert/strict";
import * as cast from "../src/castSystem.js";
import { RODS } from "../src/rods.js";

const { SnejCastSystem, flightRange, castTopSpeed, elevFor } = cast;
const context = {
  yaw: 0, pitch: -0.03, pos: { x: 0, y: 1.38, z: 0 },
  waterSurfaceY: () => 0, terrainHeightAt: () => -4, terrainDepthAt: () => 4,
  dockBlocksSegment: () => false, lineObstruction: () => null
};
const make = () => new SnejCastSystem({ rodRange: 60, getCastOrigin: () => ({ x: 0, y: 3, z: 0.55 }) });
for (const [name, expected] of Object.entries({
  GRAVITY: 9.8, CAST_HEADROOM: 1.07, CAST_SPEED_MIN: 0.5, CAST_TOL: 0.06,
  CAST_MISS: 0.30, CHARGE_RATE: 0.48, FLIGHT_TIME_SCALE: 0.65,
  SPLASH_BASE: 16, SPLASH_MIN: 4, SPLASH_SCALE: 0.55, WAKE_BOB_AMP: 0.012, WAKE_BOB_FREQ: 1.6
})) assert.equal(cast[name], expected, name);
assert.deepEqual(cast.STARTLE_R, [1, 3.2]);
assert.deepEqual(cast.STARTLE_SEC, [0.8, 5]);
assert.deepEqual(cast.CAST_TIP_FALLBACK, { x: 0, y: 1.4, z: 0 });
const canonical = `function flightRange(speed, elev, y0) {
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
}`;
assert.equal(flightRange.toString().replace(/\s/g, ""), canonical.replace(/\s/g, ""));
assert.ok(castTopSpeed(30) > castTopSpeed(15));
assert.ok(castTopSpeed(30) < 60 && castTopSpeed(15) > 5);
assert.equal(elevFor(-10), 0.16);
assert.equal(elevFor(10), 0.95);

const charge = make();
assert.equal(charge.onActionUp(), false);
assert.equal(charge.onActionDown(), true);
assert.equal(charge.onActionDown(), false);
let elapsed = 0;
while (charge.state.chargeDir === 1) { charge.tick(1 / 60, context); elapsed += 1 / 60; }
assert.ok(Math.abs(elapsed - 2.5 / 1.2) < 0.02, "Full distance charge must accumulate 20 percent faster.");
charge.cancelCharge();
charge.onActionDown();
charge.tick(2 / cast.CHARGE_RATE, context);
assert.ok(charge.state.charge < 1e-12, "A complete charge cycle must preserve overshoot time.");
charge.tick(0.7, context);
const pausedCharge = charge.state.charge;
charge.tick(0, context);
assert.equal(charge.state.charge, pausedCharge);
charge.cancelCharge();
assert.equal(charge.state.fs, "idle");

for (const [power, acc, perfect] of [[0.5, 1, true], [0.56, 1, true], [0.6, 5 / 6, false], [0.8, 0, false]]) {
  const c = make();
  const accuracyContext = { ...context, aimRay: { origin: { x: 0, y: 3, z: 0 }, direction: { x: 0, y: -3, z: 30 } } };
  c.onActionDown();
  c.tick(0, accuracyContext);
  c.state.charge = power;
  c.onActionUp();
  assert.ok(Math.abs(c.state.castAcc - acc) < 1e-12);
  assert.equal(c.state.castPerfect, perfect);
  assert.equal(c.state.castPower, power, "Accuracy feedback must not alter the selected distance.");
  assert.equal(c.state.castLead, 0);
  assert.equal(c.state.fs, "flight");
  assert.deepEqual(c.state.bobber, c.state.castOrigin, "Release must immediately expose the bobber at its origin.");
}

const endpoints = [];
for (const fps of [30, 60, 144]) {
  const c = make();
  c.tick(0, context);
  c.onActionDown();
  c.state.charge = 0.5;
  const expected = c.predictLanding(0.5);
  c.onActionUp();
  const before = JSON.stringify(c.state);
  c.tick(0, context);
  assert.equal(JSON.stringify(c.state), before, "Pausing flight must freeze physical and rendered state.");
  for (let i = 0; i < fps * 10 && c.state.fs === "flight"; i += 1) c.tick(1 / fps, context);
  assert.equal(c.state.fs, "wait");
  assert.ok(Math.hypot(c.state.bobber.x - expected.x, c.state.bobber.z - expected.z) < 1e-9,
    "Prediction must use the same fixed steps as the actual landing.");
  endpoints.push({ ...c.state.bobber });
  assert.equal(c.onActionDown(), false, "The pure cast API starts only from idle.");
  const bobber = { ...c.state.bobber };
  c.tick(60, context);
  assert.equal(c.state.fs, "wait", "Waiting must not schedule fish or bites.");
  assert.deepEqual(c.state.bobber, bobber, "Bobbing is visual, not physical.");
}
assert.deepEqual(endpoints[0], endpoints[1]);
assert.deepEqual(endpoints[1], endpoints[2]);

for (const pitch of [-Math.PI / 2, -0.5, 0, Math.PI / 2]) {
  const c = make();
  c.tick(0, { ...context, pitch });
  assert.ok(Number.isFinite(c.state.aimDist) && Number.isFinite(c.state.targetPower));
  assert.equal(c.state.aimCapped, pitch >= 0);
  assert.ok(c.state.aimDist >= c.state.minCastDist && c.state.aimDist <= 60);
}

for (let index = 0; index < 50; index += 1) {
  const c = make();
  const ctx = { ...context, yaw: index * 0.37, pitch: (index % 5 - 2) * 0.75 };
  if (index % 3 === 0) ctx.dockBlocksSegment = () => true;
  if (index % 3 === 1) { ctx.terrainHeightAt = () => 1; ctx.terrainDepthAt = () => 0; }
  c.tick(0, ctx);
  c.onActionDown();
  c.state.charge = (index % 11) / 10;
  c.onActionUp();
  for (let frame = 0; frame < 600 && c.state.fs === "flight"; frame += 1) {
    c.tick(1 / 60, ctx);
    assert.ok([...Object.values(c.state.bobber), ...Object.values(c.state.bobberVel)].every(Number.isFinite));
  }
  assert.notEqual(c.state.fs, "flight", "Every test cast must land or finish automatic recovery.");
}

const obstruction = make();
const blocked = { ...context, dockBlocksSegment: () => true };
obstruction.onActionDown();
obstruction.tick(0.4 / cast.CHARGE_RATE, blocked);
assert.equal(obstruction.state.castObstruction, "dock");
assert.equal(obstruction.onActionUp(), false, "Obstructed casts must be refused before launch.");
assert.equal(obstruction.state.lastRejection, "dock");
assert.equal(obstruction.state.retrieving, false);
assert.equal(obstruction.state.fs, "idle");

for (const { range } of RODS) {
  for (const pitch of [-1.2, -0.5, -0.03]) {
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      const c = make();
      c.setRodRange(range);
      const ctx = { ...context, pitch };
      c.tick(0, ctx);
      c.onActionDown();
      c.state.charge = fraction;
      c.tick(0, ctx);
      assert.equal(c.state.requestedDist, range * fraction);
      assert.equal(c.onActionUp(), true);
      let seconds = 0;
      while (c.state.fs === "flight" && seconds < 10) { c.tick(1 / 60, ctx); seconds += 1 / 60; }
      assert.equal(c.state.fs, "wait");
      assert.ok(Math.abs(c.state.castDist - range * fraction) < 0.0001,
        `${range} m range at ${fraction * 100}% must correspond to landing distance.`);
      assert.ok(c.state.castDist <= range, "Full charge cannot exceed the rod limit.");
      if (fraction === 1 && pitch === -0.03) assert.ok(seconds > 1.5, "Flight must be visibly slower.");
    }
  }
}

for (const yaw of [0, Math.PI / 2, Math.PI]) {
  for (const offset of [{ x: 0.55, z: 0 }, { x: 0, z: -0.55 }]) {
    for (const fraction of [0, 0.05, 0.5, 1]) {
      const c = new SnejCastSystem({ rodRange: 60, getCastOrigin: () => ({ ...offset, y: 3 }) });
      const ctx = { ...context, yaw };
      c.tick(0, ctx);
      c.onActionDown();
      c.state.charge = fraction;
      assert.equal(c.onActionUp(), fraction > 0, "A zero-distance release cannot launch even with a rotated origin.");
      if (fraction > 0) {
        for (let i = 0; i < 600 && c.state.fs === "flight"; i += 1) c.tick(1 / 60, ctx);
        assert.ok(Math.abs(c.state.castDist - 60 * fraction) < 0.0001);
      }
    }
  }
}

for (const override of [
  { pitch: 0.4 },
  { isWaterAt: () => false },
  { lineObstruction: () => "rock" },
  { terrainHeightAt: () => 1, terrainDepthAt: () => 0 },
  // The aim is water, but an undercast ends on land.
  { isWaterAt: (x, z) => z > 40 },
  // The landing is water, but the aim points at land.
  { isWaterAt: (x, z) => z < 20 }
]) {
  const c = make();
  c.tick(0, { ...context, ...override });
  c.onActionDown();
  c.state.charge = 0.5;
  assert.equal(c.onActionUp(), false, "Both aim and actual landing must be unobstructed water.");
  assert.equal(c.state.fs, "idle");
  assert.deepEqual(c.state.bobberVel, { x: 0, y: 0, z: 0 });
}

const stale = make();
stale.tick(0, context);
stale.onActionDown();
stale.state.charge = 0.5;
stale.tick(0, context);
assert.equal(stale.state.predictedLanding.water, true);
stale.tick(0, { ...context, dockBlocksSegment: () => true });
assert.equal(stale.onActionUp(), false, "Release must recalculate even when a cached preview is valid.");

const changing = make();
changing.tick(0, context);
changing.onActionDown();
assert.equal(changing.setRodRange(8), false, "Cannot change equipment during a cast.");
changing.state.charge = 0.5;
changing.onActionUp();
assert.equal(changing.setRodRange(10), false);
for (let i = 0; i < 600 && changing.state.fs === "flight"; i += 1) changing.tick(1 / 60, context);
assert.equal(changing.setRodRange(8), true);
assert.equal(changing.state.fs, "idle");
assert.equal(changing.maxLine, 8);
changing.tick(0, context);
assert.equal(changing.state.aimDist, 8);
assert.equal(changing.state.targetPower, 1);

// Collision recovery remains a safeguard if scenery changes after a valid launch.
const recovery = make();
recovery.tick(0, context);
recovery.onActionDown();
recovery.state.charge = 0.5;
assert.equal(recovery.onActionUp(), true);
recovery.tick(0.1, blocked);
assert.equal(recovery.state.retrieving, true);
const frozen = JSON.stringify(recovery.state);
recovery.tick(0, blocked);
assert.equal(JSON.stringify(recovery.state), frozen);
for (let i = 0; i < 600 && recovery.state.fs === "flight"; i += 1) recovery.tick(1 / 60, blocked);
assert.equal(recovery.state.fs, "idle");

// A water aim can be shallower than the actual, longer charged landing.
const shoreline = new SnejCastSystem({ rodRange: 10, floatDepth: 0.5 });
const shoreContext = {
  ...context, pitch: -0.4,
  terrainHeightAt: (x, z) => z < 8 ? -0.35 : -1.2,
  terrainDepthAt: (x, z) => z < 8 ? 0.35 : 1.2
};
shoreline.tick(0, shoreContext);
assert.equal(shoreline.state.aimValid, true, "Selected hook depth must not hide a visible water aim.");
shoreline.onActionDown();
shoreline.state.charge = 1;
assert.equal(shoreline.onActionUp(), true, "A deeper actual landing must not be rejected by shallow aim water.");
for (let frame = 0; frame < 600 && shoreline.state.fs === "flight"; frame += 1) shoreline.tick(1 / 60, shoreContext);
assert.equal(shoreline.state.fs, "wait");
shoreline.reset();
shoreline.tick(0, shoreContext);
shoreline.onActionDown();
shoreline.state.charge = 0.5;
assert.equal(shoreline.onActionUp(), true, "A shallow actual landing accepts the float; the hook can rest on the bed.");
assert.equal(shoreline.state.lastRejection, null);
for (let frame = 0; frame < 600 && shoreline.state.fs === "flight"; frame += 1) shoreline.tick(1 / 60, shoreContext);
assert.equal(shoreline.state.fs, "wait");

for (const override of [
  { pitch: 0.4 },
  { isWaterAt: () => false },
  { terrainDepthAt: () => 0, terrainHeightAt: () => 0 },
  { dockBlocksSegment: () => true },
  { lineObstruction: () => "rock" }
]) {
  const c = new SnejCastSystem({ rodRange: 10, floatDepth: 0.5 });
  const invalid = { ...context, ...override };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    c.tick(0, invalid);
    c.onActionDown();
    c.state.charge = 1;
    assert.equal(c.onActionUp(), false);
    assert.equal(c.state.fs, "idle");
    c.tick(0, context);
    assert.equal(c.onActionDown(), true, "A rejected cast must not block another charge.");
    assert.equal(c.state.lastRejection, null);
    assert.equal(c.state.predictedLanding.water, undefined, "Each attempt must discard the previous preview.");
    c.state.charge = 1;
    assert.equal(c.onActionUp(), true, "Valid water must work immediately after every kind of rejection.");
    for (let frame = 0; frame < 600 && c.state.fs === "flight"; frame += 1) c.tick(1 / 60, context);
    assert.equal(c.state.fs, "wait");
    c.reset();
  }
}

const flatLine = new SnejCastSystem({ rodRange: 10, floatDepth: 0.5 });
const flatContext = {
  ...context, rodTip: { x: 0, y: 0.4, z: 5 },
  terrainHeightAt: () => -0.55, terrainDepthAt: () => 0.55,
  lineObstruction: (a, b, sag) => sag > 0 ? "land" : null
};
flatLine.tick(0, flatContext);
flatLine.onActionDown();
flatLine.state.charge = 1;
assert.equal(flatLine.onActionUp(), true, "A fixed sideways line must not be checked against obsolete vertical sag.");
assert.equal(new SnejCastSystem().getCastOriginLocal().y, 1.4);
assert.equal(new SnejCastSystem().castRange, 8);
console.log("Stage 4 cast physics tests passed.");
