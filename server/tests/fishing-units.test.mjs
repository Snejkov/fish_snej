import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStore } from "../store.mjs";
import { initialState, trustedOwnerState } from "../validation.mjs";
import { rigForRod } from "../../src/floatRig.js";

test("server normalizes legacy depth once, preserves progress and persists only on an ordinary write", () => {
  const directory = mkdtempSync(join(tmpdir(), "snej-line-units-")), path = join(directory, "game.sqlite");
  let store = new GameStore(path);
  try {
    const user = store.createGuest("LineTester"), state = initialState();
    state.settings.floatDepth = 2; delete state.settings.fishingUnitsVersion;
    state.stats = { successfulCasts: 7 }; state.catchLog = [{ name: "Test fish" }];
    state.inventory.owned["bait.earthworm"] = 0;
    state.position = { x: 7, y: 0.04, z: 11, yaw: 0.8, pitch: -0.4, view: "first-person" };
    store.write(user.id, state, 12345, 7);
    const raw = () => store.db.prepare("SELECT state_json FROM profiles WHERE user_id=?").get(user.id).state_json;
    const original = raw(), expected = structuredClone(state);
    expected.settings.floatDepth = 1; expected.settings.fishingUnitsVersion = 2;
    for (let i = 0; i < 3; i++) {
      const profile = store.profile(user.id);
      assert.deepEqual(profile.state, expected); assert.equal(profile.coins, 12345); assert.equal(profile.revision, 7);
      assert.equal(raw(), original, "Read normalization does not silently write a profile.");
      assert.equal(rigForRod(4, profile.state.settings.floatDepth).upperLine, 3);
    }
    store.close(); store = new GameStore(path);
    assert.deepEqual(store.profile(user.id).state, expected);
    const patch = settings => store.patch(user.id, { expectedRevision: 7, patch: { settings } });
    for (const settings of [{ floatDepth: 2 }, { floatDepth: 2, fishingUnitsVersion: 1 }]) {
      assert.throws(() => patch(settings), error => error.code === "client_update_required");
      assert.equal(raw(), original);
    }
    const updated = patch({ floatDepth: 1, fishingUnitsVersion: 2 });
    assert.deepEqual(updated.state, expected); assert.equal(updated.coins, 12345); assert.equal(updated.revision, 8);
    assert.deepEqual(JSON.parse(raw()), expected);
    store.close(); store = new GameStore(path);
    assert.equal(store.profile(user.id).state.settings.floatDepth, 1);
    store.updatePosition(user.id, expected.position);
    assert.deepEqual(store.profile(user.id).state, expected); assert.equal(store.profile(user.id).coins, 12345);
    assert.throws(() => store.patch(user.id, { expectedRevision: 9, patch: { settings: {
      floatDepth: 4, fishingUnitsVersion: 2 } } }), error => error.code === "depth_out_of_range");
    assert.equal(store.profile(user.id).state.settings.floatDepth, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("trusted legacy owner imports preserve displayed depth without converting current imports twice", () => {
  const input = { coins: 777, state: initialState() };
  input.state.settings.floatDepth = 2; delete input.state.settings.fishingUnitsVersion;
  const normalized = trustedOwnerState(input);
  assert.equal(normalized.state.settings.floatDepth, 1);
  assert.equal(normalized.state.settings.fishingUnitsVersion, 2);
  assert.equal(normalized.coins, 777); assert.equal(input.state.settings.floatDepth, 2);
  assert.deepEqual(trustedOwnerState(normalized), normalized);
});
