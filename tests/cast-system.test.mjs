import assert from "node:assert/strict";
import * as cast from "../src/castSystem.js";

const { SnejCastSystem, flightRange, castTopSpeed, elevFor } = cast;
const context = {
  yaw: 0, pitch: -0.03, pos: { x: 0, y: 1.38, z: 0 },
  waterSurfaceY: () => 0, terrainHeightAt: () => -4, terrainDepthAt: () => 4,
  dockBlocksSegment: () => false, lineObstruction: () => null
};
const make = () => new SnejCastSystem({ rodRange: 30, getCastOrigin: () => ({ x: 0, y: 3, z: 0.55 }) });
for (const [name, expected] of Object.entries({
  GRAVITY: 9.8, CAST_HEADROOM: 1.07, CAST_SPEED_MIN: 0.5, CAST_TOL: 0.06,
  CAST_MISS: 0.30, LINE_SLACK: 8, RUN_MARGIN: 16, CHARGE_RATE: 1.05,
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
assert.ok(elapsed > 0.9 && elapsed < 1, "Charge half-period must be about 0.95 seconds.");
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
  c.onActionDown();
  c.tick(0, context);
  c.state.targetPower = 0.5;
  c.state.charge = power;
  c.onActionUp();
  assert.ok(Math.abs(c.state.castAcc - acc) < 1e-12);
  assert.equal(c.state.castPerfect, perfect);
  assert.equal(c.state.castPower, perfect ? 0.5 : power);
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
  assert.ok(c.state.aimDist >= c.state.minCastDist && c.state.aimDist <= 30);
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
obstruction.onActionUp();
obstruction.tick(0.055, blocked);
assert.equal(obstruction.state.castObstruction, "dock");
assert.equal(obstruction.state.retrieving, true);
assert.equal(obstruction.state.fs, "flight");
obstruction.tick(0, blocked);
assert.equal(obstruction.state.retrieving, true, "Paused recovery must remain frozen.");
obstruction.tick(1 / 60, blocked);
assert.equal(obstruction.state.fs, "idle");
assert.equal(new SnejCastSystem().getCastOriginLocal().y, 1.4);
console.log("Stage 4 cast physics tests passed.");
