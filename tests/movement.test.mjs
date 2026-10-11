import assert from "node:assert/strict";
import { damp, moveDelta } from "../src/util.js";

const EPSILON = 1e-9;
const WALK_SPEED = 4.0;
const SPRINT_SPEED = 6.8;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: expected ${expected}, got ${actual}`);
}

function direction(mx, mz, yaw, speed = WALK_SPEED) {
  const length = Math.hypot(mx, mz);
  if (length === 0) return moveDelta(0, 0, yaw, speed, 1);
  return moveDelta(mx / length, mz / length, yaw, speed, 1);
}

const left = direction(-1, 0, 0);
assert.ok(left.dx > 0, "Yaw 0 + A must move toward screen-left.");
near(left.dz, 0, "Yaw 0 + A must not move on Z");

const right = direction(1, 0, 0);
assert.ok(right.dx < 0, "Yaw 0 + D must move toward screen-right.");
near(right.dz, 0, "Yaw 0 + D must not move on Z");

const forward = direction(0, 1, 0);
near(forward.dx, 0, "Yaw 0 + W must not move on X");
assert.ok(forward.dz > 0, "Yaw 0 + W must move toward positive Z.");

const backward = direction(0, -1, 0);
near(backward.dx, 0, "Yaw 0 + S must not move on X");
assert.ok(backward.dz < 0, "Yaw 0 + S must move toward negative Z.");

const rotatedForward = direction(0, 1, Math.PI * 0.5);
assert.ok(rotatedForward.dx > 0, "Yaw PI/2 + W must move toward positive X.");
near(rotatedForward.dz, 0, "Yaw PI/2 + W must not move on Z");

const rotatedRight = direction(1, 0, Math.PI * 0.5);
near(rotatedRight.dx, 0, "Yaw PI/2 + D must not move on X");
assert.ok(rotatedRight.dz > 0, "Yaw PI/2 + D must move toward screen-right.");

const cancelStrafe = direction(-1 + 1, 0, 0);
near(cancelStrafe.dx, 0, "A and D must cancel on X");
near(cancelStrafe.dz, 0, "A and D must cancel on Z");

const cancelForward = direction(0, 1 - 1, 0);
near(cancelForward.dx, 0, "W and S must cancel on X");
near(cancelForward.dz, 0, "W and S must cancel on Z");

const diagonal = direction(-1, 1, 0);
near(Math.hypot(diagonal.dx, diagonal.dz), WALK_SPEED, "Diagonal input must stay normalized");
assert.ok(diagonal.dx > 0 && diagonal.dz > 0, "W+A must move forward-left on screen.");

near(SPRINT_SPEED / WALK_SPEED, 1.7, "Sprint multiplier");
for (let i = 0; i < 32; i += 1) {
  const yaw = (i / 32) * Math.PI * 2;
  const w = direction(0, 1, yaw);
  const d = direction(1, 0, yaw);
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  const rightX = -Math.cos(yaw);
  const rightZ = Math.sin(yaw);
  assert.ok(w.dx * forwardX + w.dz * forwardZ > 0, "W must remain camera-forward at every yaw.");
  assert.ok(d.dx * rightX + d.dz * rightZ > 0, "D must remain camera-right at every yaw.");
}

const released = damp(1, 0, 10, 1 / 60);
assert.ok(released > 0 && released < 1, "Release animation must decelerate smoothly.");

console.log("Movement input tests passed.");
