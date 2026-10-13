import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejUI: UI } = await import("../src/ui.js");
const { SnejAuth } = await import("../src/auth.js");
const { SnejInventory } = await import("../src/gear/inventory.js");
const { SPAWNS, SPAWN_INITIAL_NAME } = await import("../src/spawns.js");

function fixture(enabled = false) {
  return Object.assign(Object.create(Game.prototype), {
    firstPersonOnly: true, cameraMode: "third-person", viewBlend: 1,
    viewTransition: { start: 0, end: 1, elapsed: 0 },
    pos: new THREE.Vector3(5, 2, 7), yaw: 0.3, pitch: -0.12,
    camera: new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1800),
    castCamera: new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1800),
    terrain: { heightAt: () => 0, obstacleTopAt: () => -1 },
    cast: { state: { fs: "idle", bobber: { x: 0, y: 0, z: 8 } } },
    ui: { updateViewChip() {} }, canCast: () => true,
    mobileInput: { enabled, reset() { throw new Error("A disabled view toggle cannot reset held touches."); } },
    save() { throw new Error("A disabled toggle cannot write a save."); },
    auth: new SnejAuth(), settings: { sens: 1 }
  });
}

test("Production starts in first person before any profile or local save is loaded", () => {
  const source = readFileSync(new URL("../src/game.js", import.meta.url), "utf8");
  assert.match(source, /this\.firstPersonOnly = true;\s*this\.cameraMode = "first-person";\s*this\.viewBlend = 0;/);
  assert.match(source, /event\.code === "KeyV" && !this\.firstPersonOnly/);
});

test("Every spawn and saved third-person restore opens first person without moving the player", () => {
  for (const enabled of [false, true]) for (const mode of [undefined, "third-person", "first-person"]) {
    const game = fixture(enabled), position = { x: 5, y: 2, z: 7, yaw: 0.6, pitch: -0.2 };
    game.applyStart(position, { mode, pitch: -0.26 });
    assert.equal(game.cameraMode, "first-person"); assert.equal(game.viewBlend, 0);
    assert.equal(game.viewTransition, null); assert.deepEqual(game.pos.toArray(), [5, 2, 7]);
    assert.equal(game.yaw, 0.6); assert.equal(game.pitch, -0.26);
    game.setInitialSpawn();
    assert.equal(game.cameraMode, "first-person"); assert.equal(game.viewBlend, 0);
    assert.deepEqual(game.pos.toArray(), [SPAWNS[SPAWN_INITIAL_NAME].x, SPAWNS[SPAWN_INITIAL_NAME].y, SPAWNS[SPAWN_INITIAL_NAME].z]);
  }
});

test("Local camera migration preserves position, money, items and named loadouts", () => {
  const game = fixture(), inventory = new SnejInventory();
  inventory.state.coins = 12345;
  inventory.saveLoadout("Saved set");
  const data = { version: 5, settings: { lang: "en" }, player: { name: "PolicyTester",
    lastPosition: { x: 5, y: 2, z: 7, yaw: 0.3, pitch: -0.2 },
    inventory: inventory.serialize(), view: { mode: "third-person", pitch: -0.2 } } };
  const before = structuredClone(data), migrated = game.migrateSave(data);
  assert.equal(migrated.player.view.mode, "first-person");
  assert.deepEqual(migrated.player.lastPosition, before.player.lastPosition);
  assert.deepEqual(migrated.player.inventory, before.player.inventory);
  assert.deepEqual(data, before, "Migration cannot mutate its input.");
});

test("Authoritative profile restoration uses first person without rewriting server progress", () => {
  const game = fixture(true), inventory = new SnejInventory();
  inventory.saveLoadout("Online set");
  game.lake = { depthAt: () => 0 };
  Object.assign(game.ui, { showRegistration() {}, syncSettings() {}, updateProfile() {}, refreshInventory() {} });
  const profile = { user: { id: 42, name: "PolicyTester", role: "player" }, coins: 3456,
    state: { inventory: inventory.serialize(), catchLog: [], stats: {}, settings: { lang: "en" },
      position: { x: 5, y: 2, z: 7, yaw: 0.6, pitch: -0.2, view: "third-person" } } };
  const before = structuredClone(profile);
  game.applyServerProfile(profile, "restore");
  assert.equal(game.cameraMode, "first-person"); assert.equal(game.viewBlend, 0);
  assert.deepEqual(game.pos.toArray(), [5, 2, 7]); assert.equal(game.yaw, 0.6); assert.equal(game.pitch, -0.2);
  assert.equal(game.inventory.coins(), 3456);
  assert.deepEqual(game.inventory.state.loadouts, before.state.inventory.loadouts);
  assert.deepEqual(game.inventory.state.owned, before.state.inventory.owned);
  assert.deepEqual(profile, before, "Camera policy cannot change the authoritative profile.");
});

test("Disabled view toggles and old transition state cannot restore third person on any device", () => {
  for (const enabled of [false, true]) for (const fs of ["idle", "aim", "charge", "flight", "wait"]) {
    const game = fixture(enabled); game.cast.state.fs = fs;
    assert.equal(game.toggleView(), false);
    assert.equal(game.cameraMode, "first-person"); assert.equal(game.viewBlend, 0);
    assert.equal(game.viewTransition, null);
    game.cameraMode = "third-person"; game.viewBlend = 1;
    game.viewTransition = { start: 1, end: 1, elapsed: 0 };
    for (let i = 0; i < 180; i++) game.updateCamera(1 / 60);
    assert.equal(game.cameraMode, "first-person"); assert.equal(game.viewBlend, 0);
    assert.equal(game.viewTransition, null);
    if (fs !== "wait") assert.ok(game.camera.position.distanceTo(game.castCamera.position) < 1e-6);
  }
});

test("Desktop view hint and phone/tablet toggle stay hidden and disabled in all cast states", () => {
  const game = fixture(), ui = Object.create(UI.prototype), label = {}, attributes = {};
  const button = { querySelector: () => label, setAttribute: (key, value) => { attributes[key] = value; } };
  ui.el = { viewChip: {}, mobileControls: { querySelector: selector => selector === "[data-mobile-action='view']" ? button : null } };
  game.ui = ui; game.cameraMode = "first-person";
  game.castActions = game.castCancelButton = { classList: { toggle() {} } }; game.castInstruction = {};
  const original = globalThis.document;
  globalThis.document = { documentElement: { classList: { toggle() {} } } };
  try {
    for (const fs of ["idle", "aim", "charge", "flight", "wait"]) {
      game.cast.state.fs = fs; ui.updateViewChip(game); game.updateCastControls(true);
      assert.equal(ui.el.viewChip.hidden, true); assert.equal(button.hidden, true);
      assert.equal(button.disabled, true); assert.equal(label.textContent, "1P");
      assert.equal(attributes["aria-pressed"], "true");
    }
  } finally { globalThis.document = original; }
});
