import assert from "node:assert/strict";
import { SnejLake, SNEJ_FIXED_SEED } from "../src/lake.js";
import { resolveWalkableStart } from "../src/util.js";

const lake = new SnejLake(SNEJ_FIXED_SEED);
const legacyDeepSpawn = { x: 0, y: 1, z: 50, yaw: 0, pitch: -0.12 };

assert.ok(lake.depthAt(legacyDeepSpawn.x, legacyDeepSpawn.z) > 1, "The legacy spawn must reproduce the deep-water case.");

const corrected = resolveWalkableStart(legacyDeepSpawn, lake, 1);
assert.equal(corrected, lake.start, "A deep saved spawn must move to the validated lake start.");
assert.ok(lake.depthAt(corrected.x, corrected.z) <= 1, "The corrected spawn must respect the one-meter limit.");

const retained = resolveWalkableStart(lake.start, lake, 1);
assert.equal(retained, lake.start, "A safe land spawn must remain unchanged.");

console.log("Spawn boundary tests passed.");
