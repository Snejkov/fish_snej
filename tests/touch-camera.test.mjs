import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejAngler } = await import("../src/angler.js");
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function fixture(enabled, aspect = 16 / 9) {
  return Object.assign(Object.create(Game.prototype), {
    canCast: () => true, mobileInput: { enabled }, cameraMode: "third-person",
    camera: new THREE.PerspectiveCamera(70, aspect, 0.05, 1800),
    castCamera: new THREE.PerspectiveCamera(70, aspect, 0.05, 1800),
    terrain: { obstacleTopAt: () => -1, heightAt: () => 0 },
    pos: new THREE.Vector3(0, 0.04, 0), yaw: 0.2, pitch: -0.1,
    cast: { state: { fs: "idle", bobber: { x: 0.3, y: 0, z: 6 },
      aimPoint: { x: 0.3, y: 0, z: 6 }, selectedTarget: { x: 0.3, y: 0, z: 6 } } }
  });
}
function settle(game, fps = 60) {
  for (let i = 0; i < fps * 3; i++) game.updateCamera(1 / fps);
}

test("Only touch third-person orbit gets closer at phone/tablet aspects and every FPS", () => {
  for (const aspect of [844 / 390, 390 / 844, 1024 / 768, 16 / 9]) for (const fps of [30, 60, 144]) {
    for (const enabled of [false, true]) {
      const game = fixture(enabled, aspect), state = structuredClone(game.cast.state), player = game.pos.clone();
      settle(game, fps);
      near(game.camera.position.distanceTo(game.castCamera.position), enabled ? 3.3 : 4.6);
      assert.ok(game.pos.equals(player)); assert.deepEqual(game.cast.state, state);
      assert.equal(game.camera.fov, 70); assert.equal(game.castCamera.fov, 70);
      const desktop = fixture(false, aspect); settle(desktop, fps);
      assert.ok(game.castCamera.position.equals(desktop.castCamera.position));
      assert.ok(game.castCamera.quaternion.equals(desktop.castCamera.quaternion));
      game.cameraMode = "first-person"; settle(game, fps);
      assert.ok(game.camera.position.distanceTo(game.castCamera.position) < 1e-6);
      assert.ok(game.camera.quaternion.angleTo(game.castCamera.quaternion) < 1e-6);
    }
  }
});

test("The closer orbit retains obstacle pull-in and terrain clearance", () => {
  for (const enabled of [false, true]) {
    const game = fixture(enabled), probes = [];
    game.terrain.obstacleTopAt = (x, z) => { probes.push({ x, z }); return 10; };
    settle(game);
    near(game.camera.position.distanceTo(game.castCamera.position), (enabled ? 3.3 : 4.6) * 0.55);
    const back = new THREE.Vector3(-Math.sin(game.yaw) * Math.cos(game.pitch),
      0.35 - Math.sin(game.pitch) * 0.6, -Math.cos(game.yaw) * Math.cos(game.pitch)).normalize();
    const expected = game.castCamera.position.clone().addScaledVector(back, enabled ? 3.3 : 4.6);
    near(probes[0].x, expected.x); near(probes[0].z, expected.z);
    game.terrain.heightAt = () => 4;
    settle(game);
    assert.ok(game.camera.position.y >= 4.35 - 1e-6);
  }
});

test("Manual view transitions leave landed targets and physical cameras identical across devices", () => {
  const desktop = fixture(false), touch = fixture(true), games = [desktop, touch];
  for (const game of games) { game.cast.state.fs = "wait"; settle(game); }
  for (const end of [0, 1, 0, 1]) {
    for (const game of games) {
      const before = structuredClone(game.cast.state);
      game.cameraMode = end ? "third-person" : "first-person";
      game.viewTransition = { start: game.viewBlend, end, elapsed: 0 };
      for (let i = 0; i < 12; i++) game.updateCamera(1 / 60);
      settle(game);
      assert.deepEqual(game.cast.state, before); assert.equal(game.viewTransition, null);
      near(game.viewBlend, end);
    }
    assert.ok(touch.castCamera.position.equals(desktop.castCamera.position));
    assert.ok(touch.castCamera.quaternion.equals(desktop.castCamera.quaternion));
    if (!end) assert.ok(touch.camera.position.equals(desktop.camera.position));
  }
});

test("The rod tip moves further right only in presentation while the float remains centered", () => {
  for (const aspect of [844 / 390, 390 / 844, 1024 / 768, 16 / 9]) {
    const game = fixture(true, aspect), angler = new SnejAngler();
    game.cameraMode = "first-person"; settle(game);
    angler.group.position.copy(game.pos); angler.group.rotation.y = game.yaw;
    const info = { state: "playing", speed: 0, camera: game.castCamera, castCamera: game.castCamera,
      cameraMode: "first-person", viewBlend: 0, castState: "wait" };
    for (let i = 0; i < 120; i++) angler.update(1 / 60, info);
    const tip = angler.getRodTip().clone(), physical = game.castCamera.position.clone();
    const bobber = new THREE.Vector3().copy(game.cast.state.bobber);
    const previous = game.camera.clone();
    previous.position.copy(physical).addScaledVector(new THREE.Vector3(-Math.cos(game.yaw), 0, Math.sin(game.yaw)), -0.15);
    previous.lookAt(bobber); previous.updateMatrixWorld();
    const priorTip = tip.clone().project(previous);
    game.cast.state.fs = "wait"; settle(game); game.camera.updateMatrixWorld();
    const projected = tip.clone().project(game.camera), float = bobber.clone().project(game.camera);
    assert.ok(projected.x > priorTip.x, "The requested extra rightward shift must actually be visible.");
    near(float.x, 0); near(float.y, 0);
    assert.ok(game.castCamera.position.equals(physical)); assert.ok(angler.getRodTip().equals(tip));
  }
});
