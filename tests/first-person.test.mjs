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
const { SnejFishingGame } = await import("../src/game.js");
const rig = new SnejAngler();
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1800);
const dt = 1 / 60;
const info = { state: "playing", speed: 0, depth: 0, camera, cameraMode: "third-person", viewBlend: 1 };
const ids = [rig.group.uuid, rig.bones.RightHand.uuid, rig.carry.rightSocket.uuid, rig.carry.rod.uuid, rig.carry.tip.uuid];
const inverses = rig.skeleton.boneInverses.map((matrix) => matrix.toArray());
const armBones = new Set(["RightForeArm", "RightHand", "RightHandTip"]);
const world = (object) => object.getWorldPosition(new THREE.Vector3());
const projected = (object) => world(object).project(camera);
const matrix = new THREE.Matrix4();

function assertAttachments() {
  assert.equal(rig.carry.rightSocket.parent, rig.bones.RightHand);
  assert.equal(rig.carry.rod.parent, rig.carry.rightSocket);
  assert.deepEqual([rig.group.uuid, rig.bones.RightHand.uuid, rig.carry.rightSocket.uuid, rig.carry.rod.uuid, rig.carry.tip.uuid], ids);
  const grip = new THREE.Vector3(-0.035, 0, 0).applyMatrix4(rig.bones.RightHand.matrixWorld);
  assert.ok(world(rig.carry.rod).distanceTo(grip) < 1e-6, "The same rod must remain attached to the same hand.");
  assert.ok(Math.abs(world(rig.carry.tip).distanceTo(world(rig.carry.rod)) - 2.45) < 1e-6);
  assert.ok(Math.abs(world(rig.bones.RightUpperArm).distanceTo(world(rig.bones.RightForeArm)) - 0.28) < 1e-6);
  assert.ok(Math.abs(world(rig.bones.RightForeArm).distanceTo(world(rig.bones.RightHand)) - 0.25) < 1e-6);
  assert.deepEqual(rig.skeleton.boneInverses.map((bind) => bind.toArray()), inverses);
}

rig.group.position.set(8, 2, -12);
for (const aspect of [16 / 9, 1, 390 / 844]) {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const pitch of [-1.50, -0.35, 0, 0.85, 1.50]) {
      rig.group.rotation.y = yaw;
      camera.position.copy(rig.group.position).add(new THREE.Vector3(0, 1.62, 0));
      camera.lookAt(camera.position.clone().add(new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)
      )));
      for (const [speed, depth] of [[0, 0], [4, 0], [6.8, 0], [1.6, 0.6]]) {
        rig.update(dt, { ...info, speed, depth, directionX: Math.sin(yaw), directionZ: Math.cos(yaw), cameraMode: "first-person", viewBlend: 0 });
        assertAttachments();
        const hand = projected(rig.bones.RightHand);
        const tip = projected(rig.carry.tip);
        assert.ok(hand.x > 0 && hand.x < 0.95 && hand.y > -0.95 && hand.y < 0.2,
          "The wrist must remain visible in the lower-right screen area.");
        assert.ok(Math.abs(tip.x) < 0.95 && Math.abs(tip.y) < 0.95 && tip.y > hand.y,
          "The rod must extend upward into the screen without clipping.");
        assert.ok(hand.z > -1 && hand.z < 1 && tip.z > -1 && tip.z < 1);
        const handEdge = world(rig.bones.RightHand).addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), 0.034).project(camera);
        assert.ok(handEdge.x < 0.98, "The wrist joint must not be cropped by the mobile screen edge.");
        assert.equal(rig.group.visible, true);
        assert.equal(rig.headCage.visible, false);
        assert.equal(rig.chestCage.visible, false);
        assert.equal(rig.carry.tackleBox.visible, false);
        assert.ok(rig.viewRenderStates.every(({ object }) => object.layers.mask === 2),
          "The same raised arm meshes must use the view pass.");
        assert.equal(rig.segments.material.depthTest, true, "Depth between the hand and rod must remain enabled.");
        rig.links.forEach(({ bone }, index) => {
          rig.segments.getMatrixAt(index, matrix);
          assert.equal(matrix.determinant() !== 0, armBones.has(bone.name), "Only the right arm may occlude first-person view.");
        });
        rig.skeleton.bones.forEach((bone, index) => {
          rig.joints.getMatrixAt(index, matrix);
          assert.equal(matrix.determinant() !== 0, armBones.has(bone.name));
        });
      }
    }
  }
}

// Changing or reversing the existing view blend must never clone or detach the carry rig.
for (let repeat = 0; repeat < 20; repeat += 1) {
  for (const viewBlend of [1, 0.8, 0.5, 0.2, 0, 0.3, 0.1, 0.7, 1]) {
    rig.update(dt, { ...info, viewBlend, cameraMode: viewBlend === 1 ? "third-person" : "first-person" });
    assert.equal(rig.firstPersonWeight, 1 - viewBlend);
    assertAttachments();
  }
}
assert.deepEqual(rig.bones.RightShoulder.position.toArray(), [-0.12, 0.12, 0]);
assert.deepEqual(rig.bones.RightHand.quaternion.toArray(), [0, 0, 0, 1]);
assert.equal(rig.carry.tackleBox.visible, true);
assert.equal(rig.headCage.visible, true);
assert.ok(rig.viewRenderStates.every(({ object, layers, shadow }) => object.layers.mask === layers && object.castShadow === shadow));
rig.links.forEach((link, index) => {
  rig.segments.getMatrixAt(index, matrix);
  assert.ok(matrix.determinant() !== 0, "All body segments must return in third-person view.");
});

rig.update(0, { ...info, cameraMode: "first-person", viewBlend: 0 });
const paused = rig.carry.rod.matrixWorld.toArray();
for (let frame = 0; frame < 120; frame += 1) {
  rig.update(0, { ...info, state: "paused", cameraMode: "first-person", viewBlend: 0 });
  assert.ok(rig.carry.rod.matrixWorld.toArray().every((value, index) => Math.abs(value - paused[index]) < 1e-10),
    "The view overlay must not accumulate on paused frames.");
}
rig.update(0, { ...info, viewBlend: 1 });
assert.deepEqual(rig.bones.RightShoulder.position.toArray(), [-0.12, 0.12, 0]);
assert.equal(rig.carry.tackleBox.visible, true);

const calls = [];
const background = { name: "WorldBackground" };
const renderState = {
  angler: { armOnly: true },
  scene: { background },
  camera: new THREE.PerspectiveCamera(),
  renderer: {
    autoClear: true,
    shadowMap: { autoUpdate: true },
    render(scene, view) { calls.push({ layers: view.layers.mask, background: scene.background, clear: this.autoClear }); },
    clearDepth() { calls.push("clearDepth"); }
  }
};
SnejFishingGame.prototype.render.call(renderState);
assert.deepEqual(calls, [
  { layers: 1, background, clear: true }, "clearDepth", { layers: 2, background: null, clear: false }
]);
assert.equal(renderState.camera.layers.mask, 1);
assert.equal(renderState.renderer.autoClear, true);
assert.equal(renderState.renderer.shadowMap.autoUpdate, true);
assert.equal(renderState.scene.background, background);
calls.length = 0;
renderState.angler.armOnly = false;
SnejFishingGame.prototype.render.call(renderState);
assert.equal(calls.length, 1, "Third-person view must render a single normal world pass.");
renderState.angler.armOnly = true;
renderState.renderer.render = (scene, view) => { if (view.layers.mask === 2) throw new Error("View pass failure"); };
assert.throws(() => SnejFishingGame.prototype.render.call(renderState), /View pass failure/);
assert.equal(renderState.camera.layers.mask, 1, "A failed view pass must restore the world camera layers.");
assert.equal(renderState.renderer.autoClear, true);
assert.equal(renderState.renderer.shadowMap.autoUpdate, true);
assert.equal(renderState.scene.background, background);
console.log("First-person carry tests passed.");
