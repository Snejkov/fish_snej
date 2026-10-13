import assert from "node:assert/strict";
import { SnejCastSystem } from "../src/castSystem.js";

const direction = (x, y, z) => {
  const n = Math.hypot(x, y, z);
  return { x: x / n, y: y / n, z: z / n };
};
const context = {
  pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0.2,
  waterSurfaceY: () => 0, terrainHeightAt: () => -3, terrainDepthAt: () => 3,
  isWaterAt: (x, z) => z > 1,
  aimRay: { origin: { x: 0, y: 3, z: -4 }, direction: direction(0, -3, 9) }
};
const cast = new SnejCastSystem({ rodRange: 16, floatDepth: 0.5 });
cast.tick(0, context);
assert.equal(cast.state.aimValid, true, "Actual downward camera ray must work with positive third-person orbit pitch.");
assert.ok(Math.abs(cast.state.aimPoint.z - 5) < 1e-9);
assert.ok(Math.abs(cast.state.targetPower - 5 / 15.5) < 1e-9);
cast.onActionDown();
cast.state.charge = cast.state.targetPower;
assert.equal(cast.onActionUp(), true);
for (let i = 0; i < 200 && cast.state.fs === "flight"; i += 1) cast.tick(1 / 60, context);
assert.equal(cast.state.fs, "wait");
assert.ok(Math.abs(cast.state.bobber.z - 5) < 0.01, "Flight must follow the camera target.");

cast.reset();
context.pitch = -0.2;
context.aimRay.direction = direction(0, 1, 3);
cast.tick(0, context);
assert.equal(cast.state.aimValid, false, "Looking at sky must not be accepted because orbit pitch is negative.");
cast.onActionDown();
cast.state.charge = 1;
assert.equal(cast.onActionUp(), false);
assert.equal(cast.state.lastRejection, "water");

context.aimRay.direction = direction(3, -3, 9);
cast.tick(0, context);
assert.equal(cast.state.aimValid, true, "Rejected sky aim must not latch the next valid aim.");
assert.ok(Math.abs(cast.state.aimPoint.x - 3) < 1e-9);
assert.ok(Math.abs(cast.state.aimPoint.z - 5) < 1e-9);
cast.onActionDown();
cast.state.charge = cast.state.targetPower;
assert.equal(cast.onActionUp(), true);
for (let i = 0; i < 200 && cast.state.fs === "flight"; i += 1) cast.tick(1 / 60, context);
assert.equal(cast.state.fs, "wait");
assert.ok(Math.abs(cast.state.bobber.x - 3) < 0.01);
assert.ok(Math.abs(cast.state.bobber.z - 5) < 0.01);

cast.reset();
context.aimRay.direction = direction(0, -3, 100);
cast.tick(0, context);
assert.equal(cast.state.aimCapped, true);
assert.ok(Math.abs(cast.state.aimDist - 15.5) < 1e-9, "Camera aim cannot bypass the pole-plus-line/depth range.");
context.isWaterAt = () => false;
cast.tick(0, context);
assert.equal(cast.state.aimValid, false, "Camera ray must still respect the water mask.");
delete context.aimRay;
context.isWaterAt = () => true;
context.pitch = -0.2;
cast.tick(0, context);
assert.equal(cast.state.aimValid, true, "Headless/legacy contexts without a camera ray remain supported.");
context.aimRay = { origin: { x: 0, y: 3, z: -4 }, direction: direction(0, -3, 9) };
context.terrainHeightAt = () => -0.1;
context.terrainDepthAt = () => 0.1;
cast.tick(0, context);
assert.equal(cast.state.aimValid, true, "Visible shallow water is still a water aim, not land.");
cast.onActionDown();
cast.state.charge = 1;
assert.equal(cast.onActionUp(), true, "Visible shallow water must accept a cast regardless of selected hook depth.");
assert.equal(cast.state.lastRejection, null);
cast.reset();
context.terrainHeightAt = () => -3;
context.terrainDepthAt = () => 3;
context.isWaterAt = (x, z) => z > 20;
context.aimRay.direction = direction(0, -3, 100);
cast.tick(0, context);
assert.equal(cast.state.aimValid, false);
assert.equal(cast.state.aimOutOfReach, true);
cast.onActionDown();
cast.state.charge = 1;
assert.equal(cast.onActionUp(), false);
assert.equal(cast.state.lastRejection, "reach", "Visible water beyond the rod limit must not be described as non-water.");
console.log("Camera-based cast aim tests passed.");
