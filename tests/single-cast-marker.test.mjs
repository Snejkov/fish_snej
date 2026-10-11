import assert from "node:assert/strict";
import { SnejCastSystem, CHARGE_RATE } from "../src/castSystem.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const simulate = (cast, context, fps) => {
  for (let frame = 0; frame < fps * 15 && cast.state.fs === "flight"; frame += 1) cast.tick(1 / fps, context);
  assert.equal(cast.state.fs, "wait");
};

for (const length of [4, 5, 6]) for (const depth of [0, 0.5, 1.5]) {
  for (const yaw of [0, 1.7, 3.4]) for (const fps of [30, 60, 144]) {
    const context = {
      pos: { x: 13, y: 0.04, z: -9 }, yaw, pitch: -0.3,
      waterSurfaceY: () => 0, terrainHeightAt: () => -0.02,
      terrainDepthAt: () => 0.02, isWaterAt: () => true, lineObstruction: () => null,
      aimRay: { origin: { x: 13, y: 1.66, z: -9 },
        direction: { x: Math.sin(yaw) * 20, y: -1.66, z: Math.cos(yaw) * 20 } }
    };
    const origin = { x: 13.32, y: 1.29, z: -8.56 };
    const cast = new SnejCastSystem({ rodRange: length * 2, floatDepth: depth, getCastOrigin: () => origin });
    cast.tick(0, context);
    assert.equal(cast.state.targetValid, true, "Idle must have a ready ballistic marker before charging.");
    assert.equal(cast.state.targetLanding.water, true);
    const maximum = length * 2 - depth;
    assert.ok(Math.abs(distance(cast.state.targetLanding, context.pos) - maximum) < 0.0001);
    const idlePoint = { ...cast.state.targetLanding };
    cast.onActionDown();
    let previous = null;
    for (let frame = 0; frame < fps / CHARGE_RATE; frame += 1) {
      cast.tick(1 / fps, context);
      const current = distance(cast.state.predictedLanding, context.pos);
      if (cast.state.canRelease) {
        if (previous !== null) assert.ok(current >= previous - 1e-8, "A valid prediction must travel out with rising power.");
        previous = current;
      }
      assert.ok(current <= maximum + 1e-8, "A preview cannot pass the equipped rig's depth-adjusted range.");
    }
    cast.state.charge = 1;
    cast.tick(0, context);
    assert.ok(distance(cast.state.predictedLanding, idlePoint) < 1e-8, "Full-charge and initial capped forecasts must agree.");
    const predicted = { ...cast.state.predictedLanding };
    assert.equal(cast.onActionUp(), true);
    simulate(cast, context, fps);
    assert.ok(distance(cast.state.bobber, predicted) < 1e-9, "The displayed prediction must match the physical landing.");
  }
}

const context = {
  pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: -0.3,
  waterSurfaceY: () => 0, terrainHeightAt: () => -0.01, terrainDepthAt: () => 0.01,
  isWaterAt: () => true, lineObstruction: () => null,
  aimRay: { origin: { x: 0, y: 1.62, z: 0 }, direction: { x: 0, y: -1.62, z: 5 } }
};
const blocked = new SnejCastSystem({ rodRange: 10, floatDepth: 1.5 });
for (const obstruction of ["rock", "dock", "land"]) {
  context.lineObstruction = () => obstruction;
  blocked.tick(0, context);
  assert.equal(blocked.state.targetValid, false);
  assert.equal(blocked.state.targetLanding.water, false);
  blocked.onActionDown();
  blocked.state.charge = blocked.state.targetPower;
  blocked.tick(0, context);
  const predicted = { ...blocked.state.predictedLanding };
  assert.equal(blocked.onActionUp(), false, "A fixed-color marker cannot bypass collision validation.");
  assert.equal(blocked.state.lastRejection, obstruction === "land" ? "terrain" : obstruction);
  assert.equal(blocked.state.fs, "idle");
  assert.ok(Number.isFinite(predicted.x) && Number.isFinite(predicted.z));
  context.lineObstruction = () => null;
  blocked.tick(0, context);
  assert.equal(blocked.state.targetValid, true, "Rejection must not poison the next initial preview.");
}
for (const meters of [1, 1.5, 5]) {
  context.aimRay.direction.z = meters;
  blocked.reset();
  blocked.tick(0, context);
  assert.equal(blocked.state.targetValid, true, "Shallow-water and short-cast rules must remain intact.");
  blocked.onActionDown();
  blocked.state.charge = blocked.state.targetPower;
  blocked.tick(0, context);
  const predicted = { ...blocked.state.predictedLanding };
  assert.equal(blocked.onActionUp(), true);
  simulate(blocked, context, 60);
  assert.ok(distance(blocked.state.bobber, predicted) < 1e-9);
}
console.log("Single-marker ballistic preview tests passed.");
