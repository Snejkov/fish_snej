import test from "node:test";
import assert from "node:assert/strict";
import { fishingMeters, fishingWorld, migrateFishingSettings, FISHING_UNITS_VERSION } from "../src/fishingUnits.js";
import { rigForRod } from "../src/floatRig.js";

test("fishing meters match the real pole mesh and editable depth is lossless", () => {
  for (const length of [4, 5, 6]) for (const depth of [0, 0.5, 2, length - 0.125]) {
    const rig = rigForRod(length, depth);
    assert.equal(fishingWorld(fishingMeters(depth)), depth);
    assert.equal(fishingMeters(rig.castRange), length + fishingMeters(rig.lineLength) - fishingMeters(depth));
    assert.equal(rig.lineLength, length);
    assert.equal(rig.castRange, length * 2 - depth);
    assert.equal(fishingMeters(rig.maxDepth), length - 0.125);
  }
});

test("legacy depth preserves the displayed choice exactly once without changing other settings", () => {
  const legacy = { floatDepth: 2, lang: "en", volume: 0.6, autoSprint: true };
  const converted = migrateFishingSettings(legacy);
  assert.equal(legacy.floatDepth, 2);
  assert.deepEqual(converted, { ...legacy, floatDepth: 1, fishingUnitsVersion: FISHING_UNITS_VERSION });
  assert.deepEqual(migrateFishingSettings(converted), converted);
  assert.deepEqual(migrateFishingSettings({ lang: "ru" }), { lang: "ru", fishingUnitsVersion: FISHING_UNITS_VERSION });
});
