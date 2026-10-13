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

test("Every third-person orbit is twenty percent closer again at phone/tablet aspects and every FPS", () => {
  for (const aspect of [844 / 390, 390 / 844, 1024 / 768, 16 / 9]) for (const fps of [30, 60, 144]) {
    for (const enabled of [false, true]) {
      const game = fixture(enabled, aspect), state = structuredClone(game.cast.state), player = game.pos.clone();
      settle(game, fps);
      near(game.camera.position.distanceTo(game.castCamera.position), (enabled ? 3.3 : 4.6) * 0.7 * 0.8);
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
    near(game.camera.position.distanceTo(game.castCamera.position), Math.max(1.1, (enabled ? 3.3 : 4.6) * 0.7 * 0.8 * 0.55));
    const horizontal = enabled ? Math.max(0.9, Math.cos(game.pitch)) : Math.cos(game.pitch);
    const back = new THREE.Vector3(-Math.sin(game.yaw) * horizontal,
      enabled ? 1.0 - Math.sin(game.pitch) * 0.2 : 0.35 - Math.sin(game.pitch) * 0.6, -Math.cos(game.yaw) * horizontal);
    if (enabled) back.addScaledVector(new THREE.Vector3(Math.cos(game.yaw), 0, -Math.sin(game.yaw)), 0.25);
    const expected = game.castCamera.position.clone().addScaledVector(back.normalize(), (enabled ? 3.3 : 4.6) * 0.7 * 0.8);
    near(probes[0].x, expected.x); near(probes[0].z, expected.z);
    game.terrain.heightAt = () => 4;
    settle(game);
    assert.ok(game.camera.position.y >= 4.35 - 1e-6);
  }
});

test("The closer mobile baseline looks less steep than the preceding raised camera", () => {
  for (const aspect of [390 / 844, 844 / 390, 768 / 1024, 1024 / 768]) {
    for (const pitch of [-0.8, -0.1, 0.7]) for (const fps of [30, 60, 144]) {
      const game = fixture(true, aspect); game.pitch = pitch; settle(game, fps);
      const horizontal = Math.max(0.9, Math.cos(pitch));
      const previousBack = new THREE.Vector3(-Math.sin(game.yaw) * horizontal,
        1.7 - Math.sin(pitch) * 0.2, -Math.cos(game.yaw) * horizontal)
        .addScaledVector(new THREE.Vector3(Math.cos(game.yaw), 0, -Math.sin(game.yaw)), 0.25).normalize();
      const previousPosition = game.castCamera.position.clone().addScaledVector(previousBack, 3.3 * 0.7);
      const previousDirection = game.castCamera.position.clone().add(new THREE.Vector3(0, -0.4, 0)).sub(previousPosition).normalize();
      const direction = game.camera.getWorldDirection(new THREE.Vector3());
      const angle = Math.atan2(-direction.y, Math.hypot(direction.x, direction.z));
      const previousAngle = Math.atan2(-previousDirection.y, Math.hypot(previousDirection.x, previousDirection.z));
      assert.ok(angle < previousAngle - 0.07, `The mobile view did not become visibly less steep: ${angle}, ${previousAngle}`);
      near(game.camera.position.distanceTo(game.castCamera.position), 3.3 * 0.7 * 0.8);
    }
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

test("Raised mobile orbit frames real avatar and short, medium and long floats without body occlusion", () => {
  for (const aspect of [390 / 844, 844 / 390, 768 / 1024, 1024 / 768]) for (const height of [0, 1.5, 2.6]) {
    for (const range of [1.5, 3, 8, 20]) for (const pitch of [-0.8, -0.1, 0.7]) {
      for (const offset of [-0.3, 0, 0.3]) {
        const game = fixture(true, aspect), angler = new SnejAngler();
        game.pos.y = height + 0.04; game.terrain.heightAt = () => height;
        game.pitch = pitch; game.cast.state.fs = "wait";
        Object.assign(game.cast.state.bobber, { x: Math.sin(game.yaw + offset) * range,
          y: 0.05, z: Math.cos(game.yaw + offset) * range });
        const state = structuredClone(game.cast.state); settle(game);
        angler.group.position.copy(game.pos); angler.group.rotation.y = game.yaw + offset;
        for (let i = 0; i < 120; i++) angler.update(1 / 60, { state: "playing", speed: 0,
          camera: game.castCamera, castCamera: game.castCamera, cameraMode: "third-person", viewBlend: 1, castState: "wait" });
        angler.group.updateMatrixWorld(true); game.camera.updateMatrixWorld();
        const float = new THREE.Vector3().copy(game.cast.state.bobber), projected = float.clone().project(game.camera);
        const label = `aspect=${aspect} height=${height} range=${range} pitch=${pitch} offset=${offset}`;
        assert.ok(Math.abs(projected.x) < 0.95 && Math.abs(projected.y) < 0.95 && projected.z < 1, `Float clipped: ${label} ${projected.toArray()}`);
        const ray = new THREE.Raycaster(game.camera.position, float.clone().sub(game.camera.position).normalize(), 0,
          float.distanceTo(game.camera.position));
        assert.equal(ray.intersectObjects(angler.model.meshes, false).length, 0, `Avatar blocks float: ${label}`);
        for (const bone of ["HeadTip", "LeftFoot", "RightFoot"]) {
          const point = angler.bones[bone].getWorldPosition(new THREE.Vector3()).project(game.camera);
          assert.ok(Math.abs(point.x) < 0.95 && Math.abs(point.y) < 0.95 && point.z < 1, `Character clipped ${bone}: ${label}`);
        }
        near(game.camera.position.distanceTo(game.castCamera.position), 3.3 * 0.7 * 0.8);
        assert.deepEqual(game.cast.state, state);
      }
    }
  }
});

test("Desktop keeps its prior viewing angle and mobile look-away does not force the float into view", () => {
  for (const pitch of [-0.8, -0.1, 0.7]) {
    const game = fixture(false); game.pitch = pitch; settle(game);
    const back = new THREE.Vector3(-Math.sin(game.yaw) * Math.cos(pitch),
      0.35 - Math.sin(pitch) * 0.6, -Math.cos(game.yaw) * Math.cos(pitch)).normalize();
    assert.ok(game.camera.position.distanceTo(game.castCamera.position.clone().addScaledVector(back, 4.6 * 0.7 * 0.8)) < 1e-6);
    const expected = game.camera.clone(); expected.lookAt(game.castCamera.position);
    assert.ok(game.camera.quaternion.angleTo(expected.quaternion) < 1e-6);
  }
  const game = fixture(true); game.cast.state.fs = "wait"; game.yaw = Math.PI; settle(game);
  const expected = game.camera.clone(); expected.lookAt(game.castCamera.position.clone().add(new THREE.Vector3(0, -0.4, 0)));
  assert.ok(game.camera.quaternion.angleTo(expected.quaternion) < 1e-6);
});

test("Mobile wall pull-in leaves the landed float unobstructed by the real avatar", () => {
  for (const range of [1.5, 3, 8, 20]) for (const pitch of [-1.4, -0.1, 1.4]) {
    const game = fixture(true), angler = new SnejAngler();
    game.pitch = pitch; game.cast.state.fs = "wait";
    game.terrain.obstacleTopAt = () => 10;
    Object.assign(game.cast.state.bobber, { x: Math.sin(game.yaw) * range, y: 0.05, z: Math.cos(game.yaw) * range });
    settle(game); angler.group.position.copy(game.pos); angler.group.rotation.y = game.yaw;
    angler.update(1, { state: "playing", speed: 0, camera: game.castCamera, castCamera: game.castCamera,
      cameraMode: "third-person", viewBlend: 1, castState: "wait" });
    angler.group.updateMatrixWorld(true); game.camera.updateMatrixWorld();
    const float = new THREE.Vector3().copy(game.cast.state.bobber);
    const ray = new THREE.Raycaster(game.camera.position, float.clone().sub(game.camera.position).normalize(), 0,
      float.distanceTo(game.camera.position));
    assert.equal(ray.intersectObjects(angler.model.meshes, false).length, 0, `Wall pull-in blocks float range=${range} pitch=${pitch}`);
    near(game.camera.position.distanceTo(game.castCamera.position), Math.max(1.1, 3.3 * 0.7 * 0.8 * 0.55));
  }
});

test("Mobile landed-float framing blends smoothly when looking away", () => {
  for (const height of [0, 1.5, 2.6]) for (const range of [1.5, 8]) {
  const game = fixture(true); game.pos.y = height + 0.04; game.terrain.heightAt = () => height;
  game.cast.state.fs = "wait"; game.cast.state.bobber = { x: 0, y: 0.05, z: range };
  for (let yaw = 0.75; yaw <= 1.5; yaw += 0.01) {
    game.yaw = yaw; settle(game); const previous = game.camera.quaternion.clone();
    game.yaw += 0.01; settle(game);
    assert.ok(game.camera.quaternion.angleTo(previous) < 0.045, `Framing jumps at yaw ${yaw}`);
  }
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
