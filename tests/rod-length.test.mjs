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
const { RODS, rodForLength } = await import("../src/rods.js");
assert.deepEqual(RODS, [{ length: 4, range: 20 }, { length: 5, range: 25 }, { length: 6, range: 30 }]);
assert.equal(rodForLength("6"), RODS[2]);
assert.equal(rodForLength(99), RODS[0]);
const rig = new SnejAngler();
const carry = rig.carry;
const objects = [];
carry.rod.traverse((object) => objects.push(object));
const geometryIds = objects.filter((object) => object.geometry).map((object) => object.geometry.uuid);
const grip = carry.rod.children[0];
const gripPosition = grip.position.clone();
const gripScale = grip.scale.clone();
const bindMatrices = rig.skeleton.boneInverses.map((matrix) => matrix.clone());
const origin = new THREE.Vector3(), tip = new THREE.Vector3();
for (const rod of [...RODS, RODS[0]]) {
  assert.equal(carry.setLength(rod.length), true);
  for (const speed of [0, 2.5, 0]) {
    rig.update(1 / 30, { state: "playing", speed, viewBlend: 1 });
    origin.set(0, -0.1925, 0).applyMatrix4(carry.rod.matrixWorld);
    carry.tip.getWorldPosition(tip);
    assert.ok(Math.abs(origin.distanceTo(tip) - rod.length) < 1e-6);
    assert.equal(carry.rod.parent, carry.rightSocket);
    assert.equal(carry.rightSocket.parent, rig.bones.RightHand);
    assert.deepEqual(grip.position, gripPosition);
    assert.deepEqual(grip.scale, gripScale);
  }
}
const current = [];
carry.rod.traverse((object) => current.push(object));
assert.deepEqual(current, objects, "Rod changes must reuse every existing model object.");
assert.deepEqual(current.filter((object) => object.geometry).map((object) => object.geometry.uuid), geometryIds);
rig.skeleton.boneInverses.forEach((matrix, index) => assert.ok(matrix.equals(bindMatrices[index])));
assert.equal(carry.setLength(7), false);
assert.equal(carry.length, 4);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1800);
for (const rod of RODS) {
  carry.setLength(rod.length);
  for (const aspect of [16 / 9, 390 / 844]) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    for (const yaw of [0, 1.7]) {
      rig.group.rotation.y = yaw;
      for (const pitch of [-1.2, 0, 1.2]) {
        camera.position.set(0, 1.62, 0);
        camera.lookAt(camera.position.clone().add(new THREE.Vector3(
          Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)
        )));
        for (const speed of [0, 2.5]) {
          for (let frame = 0; frame < 150; frame += 1) {
            rig.update(1 / 60, { state: "playing", speed, viewBlend: 0, cameraMode: "first-person", camera });
          }
          const hand = rig.bones.RightHand.getWorldPosition(new THREE.Vector3()).project(camera);
          const shaft = new THREE.Vector3(0, 0.3, 0).applyMatrix4(carry.rod.matrixWorld).project(camera);
          assert.ok(hand.x > 0 && hand.x < 0.95 && Math.abs(hand.y) < 0.95);
          assert.ok(Math.abs(shaft.x) < 0.95 && Math.abs(shaft.y) < 0.95,
            "All selected rods must retain first-person grip and lower-shaft framing.");
          assert.equal(carry.rod.parent, carry.rightSocket);
        }
      }
    }
  }
}
console.log("Rod length and attachment tests passed.");
