import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejUI: UI } = await import("../src/ui.js");
const { setLanguage, t } = await import("../src/i18n.js");

function fixture(mode, release = true) {
  const game = Object.create(Game.prototype);
  Object.assign(game, { cameraMode: mode, viewBlend: mode === "third-person" ? 1 : 0,
    viewTransition: null, pitch: 0.12, yaw: 0.7, keys: new Set(), mouse: { dx: 0, dy: 0 },
    camera: new THREE.PerspectiveCamera(), floatRig: { reset() {} },
    audio: { resume() {}, cast() {}, deny() {} },
    ui: { updateViewChip() {}, showToast() {}, el: { toast: { classList: { add() {} } } } },
    cast: { state: { fs: "idle", castPower: 0.7 },
      beginTargeting() { this.state.fs = "aim"; return true; },
      onActionUp() { this.state.fs = release ? "flight" : "idle"; this.state.lastRejection = release ? null : "range"; return release; },
      cancelCharge() { this.state.fs = "idle"; } },
    canCast: () => true, castWaterNearby: () => true,
    updateCast() {}, updateCastVisuals() {}, save() {},
    toastForCastRejection: reason => reason
  });
  game.camera.position.set(4, 3, -2);
  return game;
}

test("Aiming and cancellation preserve both original views, pitch and camera position", () => {
  const original = globalThis.document;
  globalThis.document = {};
  try {
    for (const mode of ["first-person", "third-person"]) {
      const game = fixture(mode), position = game.camera.position.clone();
      const transition = { elapsed: 0.05, start: 0.4, end: game.viewBlend };
      game.viewTransition = transition;
      assert.equal(game.beginCastAction(), true);
      assert.equal(game.cast.state.fs, "aim");
      assert.equal(game.cameraMode, mode);
      assert.equal(game.pitch, 0.12);
      assert.equal(game.yaw, 0.7);
      assert.deepEqual(game.camera.position, position);
      assert.equal(game.viewTransition, transition);
      game.cancelCastAction();
      assert.equal(game.cast.state.fs, "idle");
      assert.equal(game.cameraMode, mode);
      assert.deepEqual(game.camera.position, position);
    }
  } finally { globalThis.document = original; }
});

test("Only a successful release switches third person to first; manual switching still works afterwards", () => {
  for (const mode of ["first-person", "third-person"]) for (const accepted of [true, false]) {
    const game = fixture(mode, accepted);
    game.cast.state.fs = "charge";
    game.endCastAction();
    assert.equal(game.cameraMode, accepted ? "first-person" : mode);
    assert.equal(Boolean(game.viewTransition), accepted && mode === "third-person");
    if (accepted) {
      game.toggleView();
      assert.equal(game.cameraMode, "third-person");
      game.cast.state.fs = "wait";
      game.toggleView();
      assert.equal(game.cameraMode, "first-person");
    }
  }
  const blocked = fixture("third-person");
  blocked.cast.state.fs = "charge";
  blocked.canCast = () => false;
  blocked.endCastAction();
  assert.equal(blocked.cameraMode, "third-person");
  assert.equal(blocked.cast.state.fs, "idle");
});

test("Mobile view button reports the actual view and locks only during target and strength selection", () => {
  const label = {}, attributes = {};
  const button = { querySelector: () => label, setAttribute: (key, value) => { attributes[key] = value; } };
  const ui = Object.create(UI.prototype);
  ui.el = { viewChip: {}, mobileControls: { querySelector: selector => selector === "[data-mobile-action='view']" ? button : null } };
  const game = fixture("third-person");
  game.ui = ui;
  game.castActions = { classList: { toggle() {} } };
  game.castCancelButton = { classList: { toggle() {} } };
  game.castInstruction = {};
  const original = globalThis.document;
  globalThis.document = { documentElement: { classList: { toggle() {} } } };
  try {
    for (const language of ["en", "ru"]) {
      setLanguage(language, { persist: false });
      for (const mode of ["first-person", "third-person"]) {
        game.cameraMode = mode;
        ui.updateViewChip(game);
        assert.equal(label.textContent, mode === "first-person" ? "1P" : "3P");
        assert.equal(attributes["aria-pressed"], String(mode === "first-person"));
        assert.equal(button.title, t(mode === "first-person" ? "Third Person" : "First Person"));
        for (const state of ["idle", "aim", "charge", "flight", "wait"]) {
          game.cast.state.fs = state;
          game.updateCastControls(true);
          assert.equal(button.disabled, ["aim", "charge"].includes(state));
          if (button.disabled) { game.toggleView(); assert.equal(game.cameraMode, mode); }
        }
      }
    }
  } finally { globalThis.document = original; }
});
