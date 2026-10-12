import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejCastSystem } = await import("../src/castSystem.js");

function fixture(view = "third-person", cameraYaw = 0.8, localHeading = -1.1) {
  const group = new THREE.Group(), rig = new THREE.Group(); group.add(rig);
  group.rotation.y = cameraYaw; rig.rotation.y = view === "first-person" ? 0 : localHeading;
  group.updateMatrixWorld(true);
  const ctx = { holdCast: true, strictTarget: true, yaw: cameraYaw, pitch: -0.35, pos: { x: 0, y: 0.04, z: 0 },
    terrainHeightAt: () => -3, terrainDepthAt: () => 3, waterSurfaceY: () => 0, isWaterAt: () => true };
  const game = Object.create(Game.prototype);
  Object.assign(game, { cameraMode: view, yaw: cameraYaw, pitch: -0.35,
    cast: new SnejCastSystem({ rodRange: 8, floatDepth: 0.5, getCastOrigin: () => ({ x: 0.2, y: 1.4, z: 0.3 }) }),
    castContext: ctx, angler: { group, rig }, canCast: () => true,
    keys: new Set(), mouse: { dx: 0, dy: 0 }, floatRig: { reset() {} }, settings: { sens: 1 },
    audio: { resume() {}, cast() {}, deny() {} }, ui: { showToast() {} },
    updateCast(dt) { this.cast.tick(dt, { ...ctx, castHeading: this.castHeading ?? cameraYaw, holdPaused: Boolean(this.castApproval) }); },
    updateCastVisuals() {}, updateCamera() {}, toggleView() { this.cameraMode = "first-person"; } });
  return { game, ctx, expectedYaw: cameraYaw + (view === "first-person" ? 0 : localHeading) };
}

test("hold grows monotonically, caps without auto-cast, and release lands forward at the charged distance", () => {
  for (const fps of [30, 60, 144]) for (const seconds of [0.8, 1.7, 2.5, 8]) {
    const f = fixture(), { game } = f;
    assert.ok(game.beginHoldCast()); assert.equal(game.cameraMode, "third-person");
    let previous = 0;
    for (let i = 0; i < Math.round(fps * seconds); i += 1) {
      game.updateCast(1 / fps);
      assert.ok(game.cast.state.charge >= previous - 1e-9 && game.cast.state.charge <= 1);
      previous = game.cast.state.charge;
    }
    assert.equal(game.cast.state.fs, "charge", "Reaching maximum never throws automatically.");
    const power = Math.min(1, Math.round(fps * seconds) / fps * 0.4), distance = 7.5 * power;
    assert.ok(Math.abs(game.cast.state.charge - power) < 1e-9);
    assert.ok(Math.abs(game.cast.state.aimYaw - f.expectedYaw) < 1e-9);
    const preview = { ...game.cast.state.predictedLanding };
    assert.ok(game.endHoldCast()); assert.equal(game.cameraMode, "first-person");
    for (let i = 0; i < fps * 10 && game.cast.state.fs === "flight"; i += 1) game.updateCast(1 / fps);
    assert.equal(game.cast.state.fs, "wait");
    assert.ok(Math.abs(Math.hypot(game.cast.state.bobber.x, game.cast.state.bobber.z) - distance) < 0.00002);
    assert.ok(Math.abs(Math.atan2(game.cast.state.bobber.x, game.cast.state.bobber.z) - f.expectedYaw) < 0.00002);
    assert.ok(Math.hypot(game.cast.state.bobber.x - preview.x, game.cast.state.bobber.z - preview.z) < 0.00002);
  }
});

test("3P orbit/strafe heading and 1P visual forward determine casting, not screen pointers", () => {
  for (const view of ["first-person", "third-person"]) for (const yaw of [-2.4, 0, 1.5]) {
    const { game, ctx, expectedYaw } = fixture(view, yaw, 0.65);
    ctx.aimRay = { origin: { x: 100, y: 4, z: 100 }, direction: { x: 1, y: 0.2, z: 0 } };
    assert.ok(game.beginHoldCast()); game.updateCast(1);
    assert.ok(Math.abs(game.castHeading - expectedYaw) < 1e-9);
    game.mouse.dx = 200; game.mouse.dy = 100;
    const before = { yaw: game.yaw, pitch: game.pitch }; game.updateLook();
    assert.deepEqual({ yaw: game.yaw, pitch: game.pitch }, before, "Charging preserves camera orientation.");
    game.cancelCastAction(); assert.equal(game.cameraMode, view);
    assert.equal(game.cast.state.fs, "idle"); assert.equal(game.holdCasting, false);
  }
});

test("too-short and land releases fail; a later valid hold works without reset or view change", () => {
  const { game, ctx } = fixture();
  game.beginHoldCast(); game.updateCast(0.01); assert.equal(game.endHoldCast(), false);
  assert.equal(game.cameraMode, "third-person");
  ctx.isWaterAt = () => false; game.beginHoldCast(); game.updateCast(3);
  assert.equal(game.cast.state.canRelease, false); assert.equal(game.endHoldCast(), false);
  assert.equal(game.cameraMode, "third-person");
  ctx.isWaterAt = () => true; game.beginHoldCast(); game.updateCast(1); assert.ok(game.endHoldCast());
});
