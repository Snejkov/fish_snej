import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { SnejCastSystem, CAST_TOL } from "../src/castSystem.js";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { t, setLanguage } = await import("../src/i18n.js");
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.00002, message);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

for (const length of [4, 5, 6]) for (const depth of [0, 0.5, 1.5]) {
  for (const fps of [30, 60, 144]) for (const yaw of [0, 1.7, 4.8]) {
    for (const error of [-0.2, -CAST_TOL, 0, CAST_TOL, 0.2]) {
      const ctx = { pos: { x: 13, y: 0.04, z: -9 }, yaw, pitch: -0.4,
        waterSurfaceY: () => 0, terrainHeightAt: () => -4, terrainDepthAt: () => 4,
        isWaterAt: () => true, lineObstruction: () => null };
      const cast = new SnejCastSystem({ rodRange: length * 2, floatDepth: depth,
        getCastOrigin: () => ({ x: 13.32, y: 1.29, z: -8.56 }) });
      close(cast.castRange, length - depth, "Maximum throw is equipped line length minus selected depth.");
      cast.tick(0, ctx);
      assert.equal(cast.beginTargeting(), true);
      assert.equal(cast.state.fs, "aim");
      const meters = cast.castRange * 0.65;
      const target = { x: ctx.pos.x + Math.sin(yaw) * meters, z: ctx.pos.z + Math.cos(yaw) * meters };
      assert.equal(cast.selectTarget(target), true);
      assert.equal(cast.state.fs, "charge");
      assert.equal(cast.state.charge, 0, "Selecting a target does not release a cast.");
      const selected = { ...cast.state.aimPoint }, power = cast.state.targetPower;
      ctx.yaw += 1.2; ctx.pitch += 0.3;
      cast.tick(0.5, ctx);
      assert.deepEqual(cast.state.aimPoint, selected, "Camera movement cannot move the selected point or green zone.");
      close(cast.state.targetPower, power);
      cast.state.charge = power + error;
      cast.tick(0, ctx);
      const forecast = { ...cast.state.predictedLanding };
      assert.equal(cast.onActionUp(), true);
      const perfect = Math.abs(error) <= CAST_TOL + Number.EPSILON;
      assert.equal(cast.state.castPerfect, perfect);
      for (let i = 0; i < fps * 10 && cast.state.fs === "flight"; i += 1) cast.tick(1 / fps, ctx);
      assert.equal(cast.state.fs, "wait");
      close(distance(cast.state.bobber, forecast), 0, "Displayed trajectory and physical landing agree.");
      close(cast.state.castDist, (perfect ? power : power + error) * cast.castRange);
      assert.ok(cast.state.castDist <= cast.castRange + 1e-8);
      if (perfect) close(distance(cast.state.bobber, target), 0, "The whole green zone lands on the selected point.");
      else assert.equal(cast.state.castDist > meters, error > 0, "Early is short; late is long.");
    }
  }
}

const cast = new SnejCastSystem({ rodRange: 8, floatDepth: 0.5 });
const ctx = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: -0.4,
  terrainHeightAt: () => -4, terrainDepthAt: () => 4, isWaterAt: () => true };
cast.tick(0, ctx);
cast.beginTargeting();
assert.equal(cast.selectTarget({ x: NaN, z: 2 }), false);
assert.equal(cast.selectTarget({ x: 0, z: 100 }), true);
assert.equal(cast.state.aimCapped, true);
close(cast.state.aimDist, 3.5);
cast.state.charge = 1;
assert.equal(cast.onActionUp(), true);
for (let i = 0; i < 600 && cast.state.fs === "flight"; i += 1) cast.tick(1 / 60, ctx);
close(cast.state.castDist, 3.5);
assert.equal(cast.beginTargeting(), true, "Recast replaces a waiting float.");
cast.cancelCharge();
assert.equal(cast.state.fs, "idle");
for (const obstruction of ["dock", "rock", "land"]) {
  cast.tick(0, { ...ctx, lineObstruction: () => obstruction });
  cast.beginTargeting();
  assert.equal(cast.selectTarget({ x: 0, z: 2.5 }), false);
  assert.equal(cast.state.fs, "aim", "A bad target must allow another selection.");
  assert.equal(cast.state.selectedTarget, null);
  cast.tick(0, ctx);
  assert.equal(cast.selectTarget({ x: 0, z: 2.5 }), true);
  assert.equal(cast.setRodRange(12), false);
  cast.cancelCharge();
  assert.equal(cast.state.selectedTarget, null);
}
cast.beginTargeting();
assert.equal(cast.setRodRange(12), false, "Aiming locks gear too.");
assert.equal(cast.selectTarget({ x: 0, z: 0.1 }), false, "Taps inside the minimum throw distance are refused.");
assert.equal(cast.state.lastRejection, "range");
assert.equal(cast.selectTarget({ x: 0, z: 2.5 }), true);
cast.state.charge = 0;
cast.tick(0, ctx);
assert.equal(cast.onActionUp(), true, "Even an immediate early stop makes the nearest safe undercast.");
for (let i = 0; i < 600 && cast.state.fs === "flight"; i += 1) cast.tick(1 / 60, ctx);
close(cast.state.castDist, cast.state.minCastDist);
assert.equal(cast.state.castPerfect, false);
cast.reset();
cast.beginTargeting();
cast.cancelCharge();
cast.setRodRange(12, 1.5);
close(cast.castRange, 4.5);

const camera = new THREE.PerspectiveCamera(70, 844 / 390, 0.05, 1800);
camera.position.set(0, 1.62, 0); camera.lookAt(0, 0, 2.5);
camera.updateProjectionMatrix(); camera.updateMatrixWorld();
const game = Object.create(Game.prototype);
let denies = 0, charges = 0;
Object.assign(game, { cast: new SnejCastSystem({ rodRange: 8, floatDepth: 0.5 }), camera,
  pos: new THREE.Vector3(), water: { surfaceY: () => 0 },
  canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 844, height: 390 }) },
  ui: { showToast: () => { denies += 1; } }, audio: { cast: () => { charges += 1; } }, cameraMode: "first-person",
  canCast: () => true, isCastWater: () => true,
  updateCast: () => game.cast.tick(0, { ...ctx, yaw: game.yaw, aimRay: game.castScreenRay?.ray }), updateCamera() {}, updateCastVisuals() {} });
game.cast.tick(0, ctx); game.cast.beginTargeting();
assert.equal(game.handleCastTap(422, 195), true, "A real screen ray selects the tapped water point.");
close(game.cast.state.aimDist, 2.5); assert.equal(charges, 1); assert.equal(denies, 0);
assert.equal(game.cast.state.fs, "flight", "A screen selection releases immediately, without a strength meter.");
assert.equal(game.handleCastTap(422, 195), false, "Extra taps cannot fire a second cast during flight.");
for (let i = 0; i < 600 && game.cast.state.fs === "flight"; i += 1) game.cast.tick(1 / 60, { ...ctx, yaw: game.yaw });
assert.equal(game.cast.state.fs, "wait");
close(game.cast.state.castDist, 2.5, "Direct input lands exactly at its preview.");
game.cast.reset(); game.cast.tick(0, ctx); game.cast.beginTargeting(); game.isCastWater = () => false;
assert.equal(game.handleCastTap(422, 195), false); assert.equal(game.cast.state.fs, "aim");
game.ui.rosterOpen = true;
assert.equal(Game.prototype.canCast.call({ mode: "playing", ui: game.ui }), false);
for (const lang of ["en", "ru"]) {
  setLanguage(lang, { persist: false });
  for (const key of ["Cast strength", "Stop cast", "Tap the water to choose a target.", "Tap again when the marker reaches green.", "Move closer to the water."]) {
    assert.ok(t(key)); if (lang === "ru") assert.notEqual(t(key), key);
  }
}
console.log("Targeted cast: screen selection, fixed target, green snap, under/over, rig budget and cancellation tests passed.");
