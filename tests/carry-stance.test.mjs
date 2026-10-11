import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "three") {
      return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});

const THREE = await import("three");
const { SnejAngler } = await import("../src/angler.js");
const rig = new SnejAngler();
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1800);
const dt = 1 / 60;
const info = { state: "playing", speed: 0, depth: 0, directionX: 0, directionZ: 1, camera, cameraMode: "first-person", viewBlend: 0 };
const ids = [rig.bones.RightHand.uuid, rig.carry.rightSocket.uuid, rig.carry.rod.uuid];
const up = new THREE.Vector3(0, 1, 0);
const restAxis = new THREE.Vector3(0.02, 0.42, -0.91).normalize();
const world = (object) => object.getWorldPosition(new THREE.Vector3());
const rodAxis = () => world(rig.carry.tip).sub(world(rig.carry.rod)).normalize();
const viewAxis = () => rodAxis().applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()).invert());
const advance = (frames, state) => { for (let frame = 0; frame < frames; frame += 1) rig.update(dt, { ...info, ...state }); };

for (const aspect of [16 / 9, 390 / 844]) {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    for (const pitch of [-1.5, -0.35, 0, 0.85, 1.5]) {
      rig.group.rotation.y = yaw;
      camera.position.set(0, 1.62, 0);
      camera.lookAt(camera.position.clone().add(new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)
      )));
      advance(150, { speed: 0 });
      assert.equal(rig.carryMoveWeight, 0);
      assert.ok(viewAxis().distanceTo(restAxis) < 1e-6, "Stopping must restore the original angled first-person pose.");
      rig.update(dt, { ...info, speed: 4 });
      assert.ok(rig.carryMoveWeight > 0 && rig.carryMoveWeight < 0.25, "Starting must blend, not snap, to upright.");
      for (const [speed, depth] of [[4, 0], [6.8, 0], [1.6, 0.6]]) {
        advance(90, { speed, depth });
        assert.equal(rig.carryMoveWeight, 1);
        assert.ok(viewAxis().distanceTo(up) < 1e-6, "Walk, run, and wade must carry the rod vertically in view.");
        const hand = world(rig.bones.RightHand).project(camera);
        const shaft = new THREE.Vector3(0, 0.3, 0).applyMatrix4(rig.carry.rod.matrixWorld).project(camera);
        assert.ok(hand.x > 0 && hand.x < 0.95 && Math.abs(hand.y) < 0.95);
        assert.ok(Math.abs(shaft.x) < 0.95 && Math.abs(shaft.y) < 0.95, "The grip and lower shaft must remain visible on mobile.");
        assert.deepEqual([rig.bones.RightHand.uuid, rig.carry.rightSocket.uuid, rig.carry.rod.uuid], ids);
      }
      rig.update(dt, info);
      assert.ok(rig.carryMoveWeight > 0.9 && rig.carryMoveWeight < 1, "Stopping must begin a gradual lowering.");
      const pausedWeight = rig.carryMoveWeight;
      const pausedRod = rig.carry.rod.matrixWorld.toArray();
      for (let frame = 0; frame < 30; frame += 1) rig.update(0, { ...info, state: "paused" });
      assert.equal(rig.carryMoveWeight, pausedWeight);
      assert.ok(rig.carry.rod.matrixWorld.toArray().every((value, index) => Math.abs(value - pausedRod[index]) < 1e-10));
      advance(150, { speed: 0 });
      assert.equal(rig.carryMoveWeight, 0, "Blocked movement with no actual speed must also lower the rod.");
    }
  }
}

for (const [speed, depth] of [[4, 0], [6.8, 0], [1.6, 0.6]]) {
  advance(90, { speed, depth, viewBlend: 1, cameraMode: "third-person" });
  assert.ok(rodAxis().distanceTo(up) < 1e-6, "Third-person walking must keep the same rod world-vertical.");
}

const releaseWeights = [];
for (const fps of [30, 60, 144]) {
  const sample = new SnejAngler();
  for (let frame = 0; frame < fps; frame += 1) sample.update(1 / fps, { state: "playing", speed: 4 });
  for (let frame = 0; frame < fps; frame += 1) sample.update(1 / fps, { state: "playing", speed: 0 });
  releaseWeights.push(sample.carryMoveWeight);
}
assert.ok(releaseWeights.every((weight) => Math.abs(weight - Math.exp(-4.5)) < 1e-12),
  "Carry transitions must be frame-rate independent.");
console.log("Carry stance tests passed.");
