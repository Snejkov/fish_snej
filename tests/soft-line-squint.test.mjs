import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game, squintFov } = await import("../src/game.js");
const { SnejAngler, ROD_LIFT_ANGLE } = await import("../src/angler.js");
const { SnejFloatRig, rigForRod, writeFixedLine } = await import("../src/floatRig.js");
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const polylineLength = points => {
  let sum = 0;
  for (let i = 3; i < points.length; i += 3) sum += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]);
  return sum;
};

test("soft line sags and sways with exact endpoints and fixed actual length, even taut or vertical", () => {
  for (const [tip, end, length] of [
    [{ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 6 }, 7.5],
    [{ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, 7.5],
    [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 7.5 }, 7.5],
    [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0]
  ]) {
    for (const time of [0, 1, 50, NaN]) {
      const positions = new Float32Array(33 * 3);
      assert.equal(writeFixedLine(tip, end, length, positions, time), true);
      assert.deepEqual(Array.from(positions.slice(0, 3)), [tip.x, tip.y, tip.z]);
      assert.deepEqual(Array.from(positions.slice(-3)), [end.x, end.y, end.z]);
      assert.ok(positions.every(Number.isFinite)); near(polylineLength(positions), length, 1e-5);
      if (length > Math.hypot(end.x - tip.x, end.y - tip.y, end.z - tip.z)) assert.ok(positions[49] < (tip.y + end.y) / 2);
    }
  }
  const tip = { x: 0, y: 2, z: 0 }, end = { x: 0, y: 0, z: 6 };
  const a = new Float32Array(99), b = new Float32Array(99), c = new Float32Array(99);
  writeFixedLine(tip, end, 7.5, a, 2); writeFixedLine(tip, end, 7.5, b, 2 + 1 / 144); writeFixedLine(tip, end, 7.5, c, 3);
  assert.notDeepEqual(a, c);
  assert.ok(Math.max(...a.map((value, i) => Math.abs(value - b[i]))) < 0.005, "Adjacent frames cannot snap the rope.");
  for (const [length, point] of [[-1, tip], [NaN, tip], [6, tip], [7.5, { ...tip, x: NaN }]]) {
    const invalid = new Float32Array(99).fill(42);
    assert.equal(writeFixedLine(point, end, length, invalid), false);
    assert.ok(invalid.every(value => value === 42), "Rejected geometry cannot publish NaNs.");
  }
});

test("a lift is smooth and bounded by the real line and obstruction, without moving the anchored float", () => {
  for (const fps of [30, 60, 144]) {
    const angler = new SnejAngler(), camera = new THREE.PerspectiveCamera(70, 2, 0.05, 1800);
    camera.position.set(0, 1.62, 0); camera.lookAt(0, 1.62, 8);
    const info = { state: "playing", speed: 0, camera, castCamera: camera, cameraMode: "first-person", castState: "wait" };
    for (let i = 0; i < fps * 2; i++) angler.update(1 / fps, info);
    const baseline = angler.getRodTip().clone(), bobber = { x: baseline.x, y: 0, z: baseline.z + 2 }, before = { ...bobber };
    const rig = rigForRod(4), follow = new SnejFloatRig(), ctx = { surfaceY: () => 0, isWaterAt: () => true };
    follow.follow(1 / fps, baseline, bobber, rig, ctx, baseline);
    let previous = 0;
    for (let i = 0; i < fps * 0.3; i++) {
      angler.update(1 / fps, { ...info, rodLiftHeld: true, castBobber: bobber, castLineLength: rig.upperLine });
      const tip = angler.getRodTip();
      assert.ok(angler.rodLiftAngle >= previous - 1e-8 && angler.rodLiftAngle <= ROD_LIFT_ANGLE);
      assert.ok(angler.rodLiftAngle - previous < 0.08); previous = angler.rodLiftAngle;
      assert.ok(tip.y > angler.rodAdjustmentTip.y);
      assert.equal(follow.follow(1 / fps, tip, bobber, rig, ctx, angler.rodAdjustmentTip), true);
      near(bobber.x, before.x, 0.001); near(bobber.z, before.z, 0.001);
      assert.ok(tip.distanceTo(new THREE.Vector3().copy(bobber)) <= rig.upperLine);
    }
    angler.update(1 / fps, { ...info, rodLiftHeld: true, rodLiftAllowed: () => false });
    assert.equal(angler.rodLiftAngle, 0, "Blocked lifting cannot force a line through terrain.");
    angler.update(1 / fps, { ...info, rodLiftHeld: true, castBobber: bobber, castLineLength: 0.25 });
    assert.equal(angler.rodLiftAngle, 0);
  }
});

function cameraGame() {
  return Object.assign(Object.create(Game.prototype), {
    allowed: true, canCast() { return this.allowed; }, cast: { state: { fs: "wait", bobber: { x: 0.3, y: 0, z: 6 } } },
    camera: new THREE.PerspectiveCamera(70, 2, 0.05, 1800), castCamera: new THREE.PerspectiveCamera(70, 2, 0.05, 1800),
    terrain: { obstacleTopAt: () => -1, heightAt: () => 0 }, pos: new THREE.Vector3(0, 0.04, 0),
    yaw: 0.2, pitch: -0.1, cameraMode: "first-person"
  });
}

test("squint magnifies 1.5x at every FPS and never changes the casting camera or player look", () => {
  for (const fps of [30, 60, 144]) {
    const game = cameraGame(); game.updateCamera(2);
    const origin = game.pos.clone(), look = [game.yaw, game.pitch], castQuaternion = game.castCamera.quaternion.clone();
    assert.equal(game.setSquint(true, "keyboard"), true);
    const initial = game.camera.fov; game.updateCamera(1 / fps);
    assert.ok(game.camera.fov < initial && game.camera.fov > squintFov());
    for (let i = 0; i < fps; i++) game.updateCamera(1 / fps);
    near(Math.tan(70 * Math.PI / 360) / Math.tan(game.camera.fov * Math.PI / 360), 1.5);
    near(game.camera.getWorldDirection(new THREE.Vector3()).dot(new THREE.Vector3().copy(game.cast.state.bobber).sub(game.camera.position).normalize()), 1);
    assert.deepEqual([game.yaw, game.pitch], look); assert.ok(game.pos.equals(origin));
    assert.ok(game.castCamera.quaternion.equals(castQuaternion)); assert.equal(game.castCamera.fov, 70);
    game.setSquint(true, "mobile"); game.setSquint(false, "keyboard"); game.updateCamera(1);
    near(game.camera.fov, squintFov());
    game.setSquint(false, "mobile"); for (let i = 0; i < fps; i++) game.updateCamera(1 / fps);
    assert.equal(game.camera.fov, 70);
    for (const state of ["idle", "charge", "flight", "wait"]) {
      game.cast.state.fs = "wait"; game.allowed = true; game.setSquint(true, "keyboard"); game.updateCamera(1);
      game.cast.state.fs = state; game.allowed = false; game.updateCamera(0);
      assert.equal(game.camera.fov, 70); assert.equal(game.keyboardSquintHeld, false);
    }
  }
});

test("normal landed first-person view centers the float and shifts presentation right without moving the rig", () => {
  for (const aspect of [844 / 390, 1024 / 768, 390 / 844, 16 / 9]) {
    const game = cameraGame(), angler = new SnejAngler();
    game.camera.aspect = game.castCamera.aspect = aspect; game.camera.updateProjectionMatrix();
    game.cast.state.fs = "flight"; game.updateCamera(2);
    angler.group.position.copy(game.pos); angler.group.rotation.y = game.yaw;
    const info = { state: "playing", speed: 0, cameraMode: "first-person", viewBlend: 0,
      castState: "wait", camera: game.castCamera, castCamera: game.castCamera };
    for (let i = 0; i < 120; i++) angler.update(1 / 60, info);
    const tip = angler.getRodTip().clone(), hand = angler.bones.RightHand.getWorldPosition(new THREE.Vector3());
    const bobber = new THREE.Vector3().copy(game.cast.state.bobber), player = game.pos.clone();
    const castingPosition = game.castCamera.position.clone(), castingRotation = game.castCamera.quaternion.clone();
    game.cast.state.fs = "wait";
    for (let i = 0; i < 150; i++) game.updateCamera(1 / 60);
    game.camera.updateMatrixWorld();
    const projectedFloat = bobber.clone().project(game.camera), projectedHand = hand.clone().project(game.camera);
    near(projectedFloat.x, 0); near(projectedFloat.y, 0);
    assert.ok(projectedHand.x > 0.05 && projectedHand.x < 0.95, `Hand must remain right and visible at aspect ${aspect}: ${projectedHand.x}`);
    assert.ok(game.pos.equals(player)); assert.ok(game.castCamera.position.equals(castingPosition));
    assert.ok(game.castCamera.quaternion.equals(castingRotation)); assert.ok(angler.getRodTip().equals(tip));
    game.cameraMode = "third-person";
    for (let i = 0; i < 150; i++) game.updateCamera(1 / 60);
    assert.equal(game.fishingFocusWeight, 0, "Choosing third person must restore the independent orbit view.");
  }
});
