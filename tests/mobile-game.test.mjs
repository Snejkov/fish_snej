import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame } = await import("../src/game.js");
const { SnejUI } = await import("../src/ui.js");
const { SnejAuth } = await import("../src/auth.js");
const { SnejInventory } = await import("../src/gear/inventory.js");
const { editableProfile } = await import("../src/serverClient.js");
const { setLanguage, t } = await import("../src/i18n.js");

function movingGame(axes, autoSprint = false, keys = []) {
  const game = Object.create(SnejFishingGame.prototype);
  Object.assign(game, { pos: new THREE.Vector3(0, 0.04, 0), yaw: 0, pitch: 0,
    settings: { sens: 1, autoSprint }, keys: new Set(keys), cast: { state: { fs: "idle" } },
    mouse: { dx: 0, dy: 0 }, moveAmt: 0, moveSpeed: 0, stepTimer: 0,
    mobileInput: { movement: () => axes, takeLook: () => ({ dx: 40, dy: -10 }) },
    terrain: { depthAt: () => 0, heightAt: () => 0, blockedAt: () => false }, audio: { ready: false, step() {} }
  });
  return game;
}
for (const [axes, auto, keys, distance] of [
  [{ mx: 0, mz: 0.5 }, false, [], 0.2],
  [{ mx: 0, mz: 0.5 }, true, [], 0.34],
  [{ mx: 0, mz: 0.5, sprint: true }, false, [], 0.34],
  [{ mx: 0, mz: 1, sprint: true }, false, [], 0.68],
  [{ mx: 0, mz: 0, sprint: true }, false, [], 0],
  [{ mx: 0, mz: 0 }, false, ["KeyW"], 0.4],
  [{ mx: 0, mz: 0 }, false, ["KeyW", "ShiftLeft"], 0.68],
  [{ mx: 0, mz: 0 }, true, [], 0]
]) {
  const game = movingGame(axes, auto, keys);
  game.updateMove(0.1);
  assert.ok(Math.abs(Math.hypot(game.pos.x, game.pos.z) - distance) < 1e-8);
}
const game = movingGame({ mx: 0, mz: 1 }, true);
assert.equal(Boolean(game.isTouchCompatibilityEvent({ pointerType: "mouse" })), false);
assert.equal(game.isTouchCompatibilityEvent({ pointerType: "touch" }), true);
assert.equal(game.isTouchCompatibilityEvent({ sourceCapabilities: { firesTouchEvents: true } }), true);
game.lastTouchCanvas = performance.now();
assert.equal(game.isTouchCompatibilityEvent({}), true, "Legacy touch-generated mouse events cannot cast or lock the cursor.");
game.lastTouchCanvas -= 900;
assert.equal(Boolean(game.isTouchCompatibilityEvent({ pointerType: "mouse" })), false);
game.updateLook(1 / 60);
assert.ok(Math.abs(game.yaw + 0.088) < 1e-12);
assert.ok(Math.abs(game.pitch - 0.022) < 1e-12);
game.cast.state.fs = "wait";
const origin = game.pos.clone(), yaw = game.yaw;
game.updateMove(0.1);
assert.deepEqual(game.pos, origin, "Mobile sprint cannot bypass cast movement lock.");
game.updateLook(1 / 60);
assert.ok(Math.abs(game.yaw - yaw) <= 0.001, "Touch look retains the released-cast correction cap.");

game.auth = new SnejAuth();
for (const value of [undefined, false, true]) {
  const migrated = game.migrateSave({ version: 5, settings: value === undefined ? {} : { autoSprint: value }, player: {} });
  assert.equal(migrated.settings.autoSprint, value === true);
}
let saves = 0;
game.save = () => { saves += 1; };
game.setSetting("autoSprint", true);
assert.equal(game.settings.autoSprint, true);
assert.equal(saves, 1);
game.inventory = { serialize: () => ({ equipped: {}, clothing: {}, loadouts: [] }) };
assert.equal(editableProfile(game).settings.autoSprint, true, "Server editable settings retain the toggle.");
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const memory = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)
} });
try {
  game.inventory = new SnejInventory();
  game.stats = { stampSeen() {}, serialize: () => ({}) };
  game.catchLog = { serialize: () => [] };
  game.playerName = "MobileTest";
  game.hasProgress = true;
  for (const value of [false, true]) {
    game.settings.autoSprint = value;
    SnejFishingGame.prototype.save.call(game);
    assert.equal(JSON.parse(memory.get("snejfishing-save-v1")).settings.autoSprint, value);
    assert.equal(game.loadSave().settings.autoSprint, value, "Actual local save and migration restore the flag.");
  }
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
  else delete globalThis.localStorage;
}
for (const lang of ["en", "ru"]) {
  setLanguage(lang, { persist: false });
  assert.ok(t("Run without holding Shift"));
  assert.ok(t("Server Profile"));
}

let resolveEquip, snapshots = 0;
const ui = Object.create(SnejUI.prototype);
ui.game = { serverBusy: false, equipGear: () => new Promise((resolve) => { resolveEquip = resolve; }),
  inventory: { saveLoadout: () => { snapshots += 1; return { ok: true, message: "Saved" }; } }, save() {} };
ui.el = { loadoutName: { value: "New rod" }, loadoutSave: { disabled: false },
  inventoryGrid: { querySelectorAll: () => [] }, inventoryCategory: { querySelector: () => ({ focus() {} }) } };
ui.refreshInventory = ui.refreshProfile = ui.showToast = () => {};
const pending = ui.inventoryAction("equip", "rod.fixture");
assert.equal(ui.el.loadoutSave.disabled, true);
assert.equal(ui.saveLoadout().ok, false);
assert.equal(snapshots, 0, "Enter cannot snapshot stale equipment while equip is pending.");
resolveEquip({ ok: true, message: "Equipped" });
await pending;
assert.equal(ui.el.loadoutSave.disabled, false);
assert.equal(ui.saveLoadout().ok, true);
assert.equal(snapshots, 1);
ui.game.equipGear = async () => { throw new Error("fixture failure"); };
await assert.rejects(ui.inventoryAction("equip", "rod.fixture"));
assert.equal(ui.pendingInventoryActions, 0);
assert.equal(ui.el.loadoutSave.disabled, false);
console.log("Mobile game movement, camera, auto sprint persistence and pending equipment tests passed.");
