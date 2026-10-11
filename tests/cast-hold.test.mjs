import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const THREE = await import("three");
const { SnejAngler } = await import("../src/angler.js");
const rig = new SnejAngler();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1800);
const ids = [rig.bones.RightHand.uuid, rig.carry.rightSocket.uuid, rig.carry.rod.uuid, rig.carry.tip.uuid];
const binds = rig.skeleton.boneInverses.map((matrix) => matrix.toArray());
const axis = () => rig.getRodTip().sub(rig.carry.rod.getWorldPosition(new THREE.Vector3())).normalize();
const advance = (info, frames = 90) => {
  for (let frame = 0; frame < frames; frame += 1) rig.update(1 / 60, { state: "playing", ...info });
};

for (const length of [4, 5, 6]) {
  rig.carry.setLength(length);
  for (const viewBlend of [1, 0.5, 0]) {
    for (const aspect of [16 / 9, 390 / 844]) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      for (const yaw of [0, 1.7, Math.PI]) {
        rig.group.rotation.y = yaw;
        for (const pitch of [-1.2, 0, 1.2]) {
          camera.position.set(0, 1.62, 0);
          camera.lookAt(camera.position.clone().add(new THREE.Vector3(
            Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)
          )));
          for (const [speed, depth] of [[0, 0], [4, 0], [6.8, 0], [1.6, 0.6]]) {
            const info = { speed, depth, directionX: Math.sin(yaw), directionZ: Math.cos(yaw), camera, viewBlend, castState: "wait" };
            const origin = rig.getCastOrigin();
            advance(info);
            assert.ok(rig.getCastOrigin().distanceTo(origin) < 1e-10, "The hold overlay must not change the ballistic release origin.");
            assert.equal(rig.castHoldWeight, 1);
            assert.ok(Math.abs(axis().y) < 1e-8, "A cast rod must stay world-horizontal in either camera and every gait.");
            assert.ok(axis().dot(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))) > 0.9999);
            const shoulder = rig.bones.RightUpperArm.getWorldPosition(new THREE.Vector3());
            const elbow = rig.bones.RightForeArm.getWorldPosition(new THREE.Vector3());
            const wrist = rig.bones.RightHand.getWorldPosition(new THREE.Vector3());
            assert.ok(elbow.y < shoulder.y - 0.08, "The held elbow must stay lowered, not raised toward the head.");
            assert.ok(Math.abs(wrist.y - elbow.y) < 1e-8, "The held forearm must be parallel to the water.");
            assert.ok(wrist.y < 1.35, "The cast grip must remain below the upper chest.");
            assert.deepEqual([rig.bones.RightHand.uuid, rig.carry.rightSocket.uuid, rig.carry.rod.uuid, rig.carry.tip.uuid], ids);
            assert.equal(rig.carry.rod.parent, rig.carry.rightSocket);
            assert.equal(rig.carry.rightSocket.parent, rig.bones.RightHand);
            assert.deepEqual(rig.skeleton.boneInverses.map((matrix) => matrix.toArray()), binds);
            if (viewBlend === 0 && pitch === 0) {
              const hand = rig.bones.RightHand.getWorldPosition(new THREE.Vector3()).project(camera);
              assert.ok(hand.x > 0 && hand.x < 0.95 && Math.abs(hand.y) < 0.95, "The lowered hand must remain framed when looking forward.");
            }
          }
        }
      }
    }
  }
}

const info = { speed: 0, camera, viewBlend: 0, castState: "idle" };
advance(info);
assert.equal(rig.castHoldWeight, 0);
rig.update(1 / 60, { ...info, castState: "flight" });
assert.ok(rig.castHoldWeight > 0 && rig.castHoldWeight < 0.25, "Release must blend into the hold pose.");
advance({ ...info, castState: "flight" });
assert.equal(rig.castHoldWeight, 1);
const frozen = rig.carry.rod.matrixWorld.toArray();
for (let i = 0; i < 60; i += 1) rig.update(0, { ...info, state: "paused", castState: "wait" });
assert.deepEqual(rig.carry.rod.matrixWorld.toArray(), frozen, "Paused hold must not accumulate wrist rotations.");
for (const cleared of [{ castState: "charge" }, { castState: "idle" }, { castState: "flight", castRetrieving: true }]) {
  advance({ ...info, castState: "wait" });
  rig.update(1 / 60, { ...info, ...cleared });
  assert.ok(rig.castHoldWeight > 0 && rig.castHoldWeight < 1, "Clearing a cast must blend back, not snap.");
  advance({ ...info, ...cleared });
  assert.equal(rig.castHoldWeight, 0);
  const resting = axis().applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()).invert());
  assert.ok(resting.distanceTo(new THREE.Vector3(0.02, 0.42, -0.91).normalize()) < 1e-6);
}
for (const fps of [30, 60, 144]) {
  const sample = new SnejAngler();
  for (let frame = 0; frame < fps / 2; frame += 1) sample.update(1 / fps, { state: "playing", castState: "wait" });
  const raised = 1 - Math.exp(-6);
  assert.ok(Math.abs(sample.castHoldWeight - raised) < 1e-12, "Hold blend must be frame-rate independent.");
  for (let frame = 0; frame < fps / 2; frame += 1) sample.update(1 / fps, { state: "playing", castState: "idle" });
  assert.ok(Math.abs(sample.castHoldWeight - raised * Math.exp(-6)) < 1e-12);
}
console.log("Horizontal cast hold tests passed.");
