import test from "node:test";
import assert from "node:assert/strict";
import { fishingMeters, fishingWorld } from "../src/fishingUnits.js";
import { rigForRod } from "../src/floatRig.js";

test("fishing meters are a display scale; converting editable depth is lossless", () => {
  for (const length of [4, 5, 6]) for (const depth of [0, 0.5, 2, 2 * length - 0.25]) {
    const rig = rigForRod(length, depth);
    assert.equal(fishingWorld(fishingMeters(depth)), depth);
    assert.equal(fishingMeters(rig.castRange), fishingMeters(rig.lineLength) - fishingMeters(depth));
    assert.equal(rig.castRange, length * 2 - depth);
    assert.equal(fishingMeters(rig.maxDepth), length - 0.125);
  }
});
