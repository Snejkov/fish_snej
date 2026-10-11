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
const dt = 1 / 60;
const info = { state: "playing", cameraMode: "third-person", depth: 0, directionX: 0, directionZ: 1 };

assert.equal(rig.skeleton.bones.length, 24);
assert.equal(new Set(rig.skeleton.bones.map((bone) => bone.name)).size, 24);
assert.ok(rig.skeleton.bones.every((bone) => bone.isBone));
assert.equal(rig.bones.LeftLowerLeg.parent, rig.bones.LeftUpperLeg);
assert.equal(rig.bones.RightHand.parent, rig.bones.RightForeArm);
assert.equal(rig.carry.leftSocket.parent, rig.bones.LeftHand);
assert.equal(rig.carry.rightSocket.parent, rig.bones.RightHand);
assert.equal(rig.carry.tackleBox.parent, rig.carry.leftSocket);
assert.equal(rig.carry.rod.parent, rig.carry.rightSocket);
const bindMatrices = rig.skeleton.boneInverses.map((matrix) => matrix.toArray());

const vector = () => new THREE.Vector3();
const leftGrip = new THREE.Vector3(0.035, 0, 0);
const rightGrip = new THREE.Vector3(-0.035, 0, 0);
const carryPoses = new Set();
for (const [speed, depth] of [[0, 0], [4, 0], [6.8, 0], [1.6, 0.6]]) {
  for (let i = 0; i < 90; i += 1) {
    rig.update(dt, { ...info, speed, depth });
    const box = rig.carry.tackleBox.getWorldPosition(vector());
    const rod = rig.carry.rod.getWorldPosition(vector());
    const tip = rig.carry.tip.getWorldPosition(vector());
    const hips = rig.bones.Hips.getWorldPosition(vector());
    const head = rig.bones.Head.getWorldPosition(vector());
    assert.ok(box.distanceTo(leftGrip.clone().applyMatrix4(rig.bones.LeftHand.matrixWorld)) < 1e-6,
      "The box handle must stay attached to the left hand.");
    assert.ok(rod.distanceTo(rightGrip.clone().applyMatrix4(rig.bones.RightHand.matrixWorld)) < 1e-6,
      "The rod grip must stay attached to the right hand.");
    assert.ok(box.x > hips.x + 0.15 && rod.x < hips.x - 0.15, "Props must stay on the anatomical sides.");
    assert.ok(tip.y > head.y + 0.6, "The rod must remain upright above the head.");
    assert.ok(Math.abs(tip.distanceTo(rod) - 2.45) < 1e-6, "Carry animation must not stretch the rod.");
    assert.ok(new THREE.Box3().setFromObject(rig.carry.tackleBox).min.y > 0.2,
      "The box must stay clear of the ground.");
    carryPoses.add(box.toArray().map((value) => value.toFixed(4)).join(","));
  }
}
assert.ok(carryPoses.size > 100, "Carry props must move with the animation.");

const kneePoses = new Set();
for (let i = 0; i < 90; i += 1) {
  rig.update(dt, { ...info, speed: 4 });
  kneePoses.add(rig.bones.LeftLowerLeg.quaternion.toArray().map((value) => value.toFixed(4)).join(","));
  const thigh = rig.bones.LeftUpperLeg.getWorldPosition(new THREE.Vector3());
  const knee = rig.bones.LeftLowerLeg.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(thigh.distanceTo(knee) - 0.42) < 1e-6, "Animation must preserve bone lengths.");
}
assert.equal(rig.locomotionState, "walk");
assert.ok(kneePoses.size > 20, "The knee must visibly bend throughout the gait.");
assert.ok(rig.weights.walk > 0.99);

rig.update(dt, { ...info, speed: 6.8 });
assert.equal(rig.locomotionState, "run");
rig.update(dt, { ...info, speed: 1.6, depth: 0.6 });
assert.equal(rig.locomotionState, "wade");

for (let i = 0; i < 120; i += 1) rig.update(dt, { ...info, speed: 0 });
assert.equal(rig.locomotionState, "idle", "A blocked or released movement must return to idle.");
assert.ok(rig.weights.idle > 0.99);
assert.deepEqual(rig.group.position.toArray(), [0, 0, 0], "Animation must not drift the player's world placement.");
assert.ok(Math.abs(Object.values(rig.weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
assert.deepEqual(rig.skeleton.boneInverses.map((matrix) => matrix.toArray()), bindMatrices);

const snapshot = () => rig.skeleton.bones.map((bone) => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
const pausedPose = snapshot();
const pausedProps = [rig.carry.tackleBox.matrixWorld.toArray(), rig.carry.rod.matrixWorld.toArray()];
for (let i = 0; i < 60; i += 1) rig.update(0, { ...info, state: "paused", speed: 0 });
assert.deepEqual(snapshot(), pausedPose, "Pause must freeze the pose.");
assert.deepEqual([rig.carry.tackleBox.matrixWorld.toArray(), rig.carry.rod.matrixWorld.toArray()], pausedProps,
  "Pause must also freeze the carry props.");
rig.update(dt, { ...info, speed: 0, cameraMode: "first-person" });
assert.equal(rig.group.visible, false);
rig.update(dt, { ...info, speed: 0 });
assert.equal(rig.group.visible, true);

// A weighted vertex proves that the exposed skeleton can drive a compatible skin.
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.Float32BufferAttribute([0.11, 0.06, 0], 3));
const footIndex = rig.skeleton.bones.indexOf(rig.bones.LeftFoot);
geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([footIndex, 0, 0, 0], 4));
geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));
const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
mesh.bind(rig.skeleton, new THREE.Matrix4());
const source = new THREE.Vector3(0.11, 0.06, 0);
const before = mesh.applyBoneTransform(0, source.clone());
let displacement = 0;
for (let i = 0; i < 90; i += 1) {
  rig.update(dt, { ...info, speed: 4 });
  const vertex = mesh.applyBoneTransform(0, source.clone());
  assert.ok(vertex.toArray().every(Number.isFinite));
  displacement = Math.max(displacement, before.distanceTo(vertex));
}
assert.ok(displacement > 0.2, "The skeleton must move a skinned vertex throughout its gait.");
rig.update(dt, { state: "playing", speed: 4, directionZ: 1 });
assert.ok(rig.bones.LeftFoot.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite),
  "An omitted direction component must not corrupt the rig.");
geometry.dispose();
mesh.material.dispose();

console.log("Character rig tests passed.");
