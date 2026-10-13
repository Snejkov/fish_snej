import assert from "node:assert/strict";
import { SnejFloatRig, rigForRod, limitLineEnd, writeFixedLine } from "../src/floatRig.js";
import { SnejCastSystem } from "../src/castSystem.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lengthOf = (positions) => {
  let length = 0;
  for (let i = 3; i < positions.length; i += 3) {
    length += Math.hypot(positions[i] - positions[i - 3], positions[i + 1] - positions[i - 2], positions[i + 2] - positions[i - 1]);
  }
  return length;
};
const context = { surfaceY: () => 0, isWaterAt: () => true, lineObstruction: () => null, playerOrigin: { x: 0, z: 0 } };

assert.deepEqual(rigForRod(5, 0.5), { lineLength: 10, floatDepth: 0.5, maxDepth: 9.75, upperLine: 9.5, castRange: 9.5, rodReach: 14.5 });
assert.equal(rigForRod(4, -1).floatDepth, 0);
assert.equal(rigForRod(4, 99).floatDepth, 7.75);
assert.equal(rigForRod(4, NaN).floatDepth, 0.5);
for (const rod of [4, 5, 6]) {
  for (const depth of [0, 0.5, 1, 2]) {
    const rig = rigForRod(rod, depth);
    assert.equal(rig.castRange, rod * 2 - depth);
    assert.equal(rig.upperLine + rig.floatDepth, rod * 2);
    for (const fps of [30, 60, 144]) {
      const model = new SnejFloatRig();
      const tip = { x: 0, y: 0.4, z: rod };
      const bobber = { x: 0, y: 0, z: rod + rig.upperLine * 0.8 };
      const positions = new Float32Array(33 * 3);
      const start = { ...bobber };
      assert.equal(model.follow(1 / fps, tip, bobber, rig, context), true);
      for (let frame = 1; frame <= fps; frame += 1) {
        tip.x = Math.sin(frame / fps) * 0.8;
        assert.equal(model.follow(1 / fps, tip, bobber, rig, context), true);
        assert.ok(distance(tip, bobber) <= rig.upperLine + 1e-6);
        assert.ok(Math.hypot(bobber.x, bobber.z) <= rig.rodReach + 1e-6);
        assert.equal(model.hook.y, bobber.y - depth);
        assert.equal(writeFixedLine(tip, bobber, rig.upperLine, positions), true);
        assert.ok(Math.abs(lengthOf(positions) + depth - rig.lineLength) < 0.00003,
          "The visible polyline and reserved leader retain the configured total length without stretching.");
      }
      assert.ok(Math.abs(bobber.x - start.x) < 1e-8, "Slack must not copy sideways pole movement to the float.");
      const frozen = JSON.stringify([bobber, model.lastTip, model.hook]);
      tip.x += 1;
      model.follow(0, tip, bobber, rig, context);
      assert.equal(JSON.stringify([bobber, model.lastTip, model.hook]), frozen, "Pause must freeze the float and its line anchor.");
      model.reset();
      assert.equal(model.anchored, false);
    }
  }
}

const rig = rigForRod(5, 0.5), model = new SnejFloatRig();
const tip = { x: 0, y: 1, z: 5 }, bobber = { x: 0, y: 0, z: 14.5 };
assert.equal(model.follow(1 / 60, tip, bobber, rig, context), true);
assert.ok(distance(tip, bobber) <= rig.upperLine + 1e-6,
  "A taut line must remain inside the exact rod-tip line limit.");
model.reset();
bobber.z = 8;
assert.equal(model.follow(1 / 60, tip, bobber, rig, context), true);
tip.x += 2;
assert.equal(model.follow(1 / 60, tip, bobber, rig, { ...context, isWaterAt: (p) => p.x <= 0.1 }), true);
assert.ok(bobber.x <= 0.1, "A dragged float must stop before leaving valid water.");
assert.equal(model.follow(1 / 60, tip, bobber, rig, { ...context, lineObstruction: () => "dock" }), false);
assert.equal(model.follow(1 / 60, { x: 0, y: 11, z: 5 }, bobber, rig, context), false, "An impossible height must request recovery, never stretch the line.");
const clipped = {};
limitLineEnd({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, 5, clipped);
assert.ok(Math.abs(distance({ x: 0, y: 0, z: 0 }, clipped) - 5) < 1e-9);
assert.equal(writeFixedLine({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 5, new Float32Array(99)), false);

for (const rod of [4, 5, 6]) {
  for (const depth of [0, 0.5, 1.5]) {
    for (const fraction of [0.5, 1]) {
      const cast = new SnejCastSystem({ rodRange: rod * 2, floatDepth: depth, getCastOrigin: () => ({ x: 0, y: 1.5, z: 0.55 }) });
      const ctx = { yaw: 0, pitch: -0.1, pos: { x: 0, y: 0, z: 0 }, waterSurfaceY: () => 0, terrainHeightAt: () => -4, terrainDepthAt: () => 4 };
      cast.tick(0, ctx);
      cast.onActionDown();
      cast.state.charge = fraction;
      assert.equal(cast.onActionUp(), true);
      for (let i = 0; i < 600 && cast.state.fs === "flight"; i += 1) cast.tick(1 / 60, ctx);
      assert.equal(cast.state.fs, "wait");
      assert.ok(Math.abs(cast.state.castDist - (rod * 2 - depth) * fraction) < 0.0001);
      assert.equal(cast.maxLine, rod * 2);
    }
  }
}
const deep = new SnejCastSystem({ rodRange: 10, floatDepth: 1 });
const shallow = { yaw: 0, pitch: -0.1, pos: { x: 0, y: 0, z: 0 }, terrainHeightAt: () => -0.5, terrainDepthAt: () => 0.5 };
deep.tick(0, shallow);
assert.equal(deep.state.aimValid, true, "An open water aim is independent of the selected underwater drop.");
assert.equal(deep.isRigWaterAt(deep.state.aimPoint), true, "Shallow water supports bottom-contact rigs without changing their line budget.");
deep.onActionDown();
deep.state.charge = 1;
assert.equal(deep.onActionUp(), true);
assert.equal(deep.state.lastRejection, null);
assert.equal(deep.state.fs, "flight");
deep.reset();
assert.equal(deep.setRodRange(10, 0.5), true);
assert.equal(deep.castRange, 9.5);
deep.onActionDown();
assert.equal(deep.setRodRange(10, 1), false);
assert.equal(deep.rig.floatDepth, 0.5);
console.log("Fixed float rig and depth tests passed.");
