import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { SnejCastSystem } from "../src/castSystem.js";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { SnejFishingGame: Game } = await import("../src/game.js");
const THREE = await import("three");
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.00002, `${a} != ${b}`);

function fixture(length, depth, desired, yaw, obstruction = null) {
  const pos = { x: 13, y: 0.04, z: -9 };
  const eye = new THREE.Vector3(pos.x, 1.62, pos.z);
  const target = new THREE.Vector3(pos.x + Math.sin(yaw) * desired, 0, pos.z + Math.cos(yaw) * desired);
  const ctx = { pos, yaw, pitch: -0.4, strictTarget: true, aimRay: new THREE.Ray(eye, target.sub(eye).normalize()),
    waterSurfaceY: () => 0, terrainHeightAt: () => -4, terrainDepthAt: () => 4,
    isWaterAt: () => true, lineObstruction: () => obstruction };
  const cast = new SnejCastSystem({ rodRange: length * 2, floatDepth: depth,
    getCastOrigin: () => ({ x: pos.x + 0.32, y: 1.29, z: pos.z - 0.44 }) });
  const game = Object.create(Game.prototype);
  let releases = 0;
  Object.assign(game, { cast, cameraMode: "first-person", keys: new Set(), mouse: {},
    audio: { cast() { releases += 1; }, deny() {} }, ui: { showToast() {} }, canCast: () => true,
    updateCast: () => cast.tick(0, ctx), updateCamera() {}, updateCastVisuals() {} });
  game.updateCast(); cast.beginTargeting(); game.updateCast();
  return { game, cast, ctx, releases: () => releases };
}

test("Direct release lands on the circle with an offset grip at every frame rate and rig budget", () => {
  for (const length of [4, 5, 6]) for (const depth of [0, 0.5, 1.5]) {
    // The shortest 2.5m upper line still needs the unchanged 1m minimum launch clearance.
    for (const factor of [0.4, 0.75, 1]) for (const yaw of [0, 1.7, 4.8]) for (const fps of [30, 60, 144]) {
      const { game, cast, ctx, releases } = fixture(length, depth, (length - depth) * factor, yaw);
      const circle = { ...cast.state.targetLanding };
      assert.equal(cast.state.targetValid, true,
        `${length}m/depth ${depth}, power ${factor}, yaw ${yaw}, min ${cast.state.minCastDist}: ${cast.state.releaseBlock}`);
      close(Math.hypot(circle.x - ctx.pos.x, circle.z - ctx.pos.z), cast.state.aimDist);
      assert.ok(cast.state.aimDist <= length - depth + 1e-8);
      assert.equal(cast.castRange, length - depth);
      assert.equal(game.endCastAction(), true);
      assert.equal(cast.state.fs, "flight");
      assert.equal(releases(), 1);
      assert.equal(game.endCastAction(), false, "Repeated release during flight is ignored.");
      for (let i = 0; i < fps * 10 && cast.state.fs === "flight"; i += 1) cast.tick(1 / fps, ctx);
      assert.equal(cast.state.fs, "wait");
      close(Math.hypot(cast.state.bobber.x - circle.x, cast.state.bobber.z - circle.z), 0);
      assert.ok(cast.state.castDist <= length - depth + 1e-8);
    }
  }
});

test("Out-of-range and land keep the actual chosen point but cannot release; moving back restores a valid circle", () => {
  for (const length of [4, 5, 6]) {
    const { game, cast, ctx, releases } = fixture(length, 0.5, 40, 0);
    close(cast.state.aimPoint.z - ctx.pos.z, 40);
    assert.equal(cast.state.aimHasPoint, true);
    assert.equal(cast.state.targetValid, false);
    assert.equal(cast.state.releaseBlock, "reach");
    assert.equal(game.endCastAction(), false);
    assert.equal(releases(), 0);
    ctx.aimRay.direction.set(0, -1.62, cast.castRange).normalize();
    game.updateCast(); assert.equal(cast.state.targetValid, true);
    ctx.isWaterAt = () => false; game.updateCast(); assert.equal(cast.state.targetValid, false);
    ctx.isWaterAt = () => true; game.updateCast(); assert.equal(cast.state.targetValid, true);
    assert.equal(game.endCastAction(), true);
  }
});

test("Blocked circles do not cast, while cancellation clears aiming without changing the view", () => {
  for (const obstacle of ["rock", "dock", "land"]) {
    const { game, cast, releases } = fixture(4, 0.5, 2.5, 0, obstacle);
    game.cameraMode = "third-person";
    assert.equal(game.endCastAction(), false);
    assert.equal(cast.state.fs, "aim");
    assert.equal(releases(), 0);
    assert.equal(game.cameraMode, "third-person");
    game.castPointer = { x: 10, y: 20 };
    game.cancelCastAction();
    assert.equal(cast.state.fs, "idle");
    assert.equal(game.castPointer, null);
    assert.equal(game.cameraMode, "third-person");
  }
});
