import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "three" ? { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejAngler } = await import("../src/angler.js");
const { createUploadedSkin } = await import("../src/uploadedSkin.js");
const { SKIN_DATA } = await import("../src/assets/angler-skin/skinData.js");
const original = new SnejAngler();
const rig = new SnejAngler({ modelFactory: createUploadedSkin });
const model = rig.model;
assert.ok(original.model.meshes.some((mesh) => mesh.name === "Jacket"), "The original factory remains available without changing the rig contract.");
assert.deepEqual(rig.skeleton.bones.map((bone) => bone.name), original.skeleton.bones.map((bone) => bone.name));
assert.deepEqual(rig.skeleton.boneInverses.map((matrix) => matrix.toArray()), original.skeleton.boneInverses.map((matrix) => matrix.toArray()));
assert.equal(model.meshes.reduce((count, mesh) => count + mesh.geometry.index.count / 3, 0), 6847);
assert.equal(Object.keys(model.materials).length, 5);
assert.ok(Object.values(model.materials).every((material) => material.map.wrapS === THREE.RepeatWrapping && material.map.wrapT === THREE.RepeatWrapping),
  "GTA UV islands need repeat addressing, not clamp-to-edge.");
assert.ok(model.meshes.some((mesh) => mesh.userData.firstPerson));
assert.equal(model.driverSkeleton, rig.skeleton);
assert.equal(model.skeleton.bones.length, rig.skeleton.bones.length + 4);
assert.ok(model.meshes.every((mesh) => mesh.skeleton === model.skeleton && mesh.frustumCulled === false));
const uniqueAttributes = new Set(model.meshes.flatMap((mesh) => Object.values(mesh.geometry.attributes)));
assert.equal(uniqueAttributes.size, 5, "Mesh parts share vertex attributes inside one avatar without a global cache.");
assert.notEqual(model.meshes[0].geometry.index, model.meshes[1].geometry.index);
assert.equal(model.extraBones.SkinRightPalm.parent, rig.bones.RightHand);
assert.equal(model.extraBones.SkinRightForearm.parent, rig.bones.RightForeArm);
assert.equal(model.extraBones.SkinRightFinger.parent, model.extraBones.SkinRightPalm);
assert.equal(model.extraBones.SkinRightFingertip.parent, model.extraBones.SkinRightFinger);
const retainedFingerIndices = new Set([model.skeleton.bones.indexOf(model.extraBones.SkinRightFinger), model.skeleton.bones.indexOf(model.extraBones.SkinRightFingertip)]);
assert.ok([...model.meshes[0].geometry.attributes.skinIndex.array].some((index) => retainedFingerIndices.has(index)), "Source finger influences are not collapsed into the hand.");
for (const texture of SKIN_DATA.textures) {
  const png = readFileSync(new URL(`../src/assets/angler-skin/${texture.name}.png`, import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), texture.width);
  assert.equal(png.readUInt32BE(20), texture.height);
}
for (const mesh of model.meshes) {
  const { position, normal, skinIndex, skinWeight, uv } = mesh.geometry.attributes;
  assert.equal(position.count, SKIN_DATA.vertexCount);
  assert.equal(uv.count, position.count);
  assert.ok([...position.array, ...normal.array, ...uv.array].every(Number.isFinite));
  for (let i = 0; i < position.count; i += 1) {
    let sum = 0;
    for (let j = 0; j < 4; j += 1) {
      const offset = i * 4 + j;
      assert.ok(skinIndex.array[offset] < model.skeleton.bones.length);
      assert.ok(skinWeight.array[offset] >= 0);
      sum += skinWeight.array[offset];
    }
    assert.ok(Math.abs(sum - 1) < 1e-6);
  }
}
const identities = model.meshes.map((mesh) => [mesh.uuid, mesh.geometry.uuid, mesh.material.uuid]);
const inverseBinds = rig.skeleton.boneInverses.map((matrix) => matrix.toArray());
const gripRig = new SnejAngler({ modelFactory: createUploadedSkin });
const gripModel = gripRig.model;
const hand = gripRig.bones.RightHand;
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
camera.position.set(0, 1.62, 0);
camera.lookAt(0, 1.62, 1);
const handBones = new Set(gripModel.skeleton.bones.map((bone, index) => bone.name.startsWith("SkinRight") && bone.name !== "SkinRightForearm" ? index : -1));
const samples = model.meshes.map((mesh) => [...new Set(mesh.geometry.index.array)].filter((index, i) => i % 30 === 0));
const worldVertex = (mesh, index) => mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
const leg = model.meshes.find((mesh) => mesh.name === "UploadedBody1");
const legPositions = new Set();
for (const [speed, depth] of [[0, 0], [4, 0], [6.8, 0], [1.6, 0.6]]) {
  for (let frame = 0; frame < 60; frame += 1) {
    rig.update(1 / 60, { state: "playing", speed, depth, directionX: 0, directionZ: 1 });
    model.meshes.forEach((mesh, i) => samples[i].forEach((index) => assert.ok(worldVertex(mesh, index).toArray().every(Number.isFinite))));
    if (speed > 0) legPositions.add(worldVertex(leg, leg.geometry.index.array[0]).toArray().map((value) => value.toFixed(4)).join(","));
  }
}
assert.ok(legPositions.size > 50, "The actual uploaded leg mesh, not only hidden bones, must animate.");
const reference = new SnejAngler();
reference.carry.setLength(4); gripRig.carry.setLength(4);
const handCases = [
  { castState: "idle" }, { castState: "charge" }, { castState: "flight" }, { castState: "wait" },
  { castState: "wait", rodLiftHeld: true }, { castState: "flight", castRetrieving: true }
];
for (const handCase of handCases) {
  const info = { state: "playing", camera, castCamera: camera, cameraMode: "first-person", viewBlend: 0, ...handCase };
  for (let frame = 0; frame < 120; frame++) {
    gripRig.update(1 / 60, info);
    reference.update(1 / 60, info);
    gripModel.meshes.filter((part) => part.userData.firstPerson).forEach((mesh) => {
      for (const index of mesh.geometry.index.array) assert.ok(worldVertex(mesh, index).toArray().every(Number.isFinite));
    });
  }
  assert.ok(gripRig.getRodTip().distanceTo(reference.getRodTip()) < 1e-8, "The skin-only bones cannot alter the gameplay pole tip.");
  assert.ok(gripRig.getRetrieveHand().distanceTo(reference.getRetrieveHand()) < 1e-8, "The physical retrieval hand is unchanged.");
  assert.ok(gripModel.meshes.every((mesh) => mesh.visible === mesh.userData.firstPerson && mesh.layers.mask === 2));
  let nearest = Infinity;
  const grip = gripRig.carry.rod.getWorldPosition(new THREE.Vector3());
  for (const mesh of gripModel.meshes.filter((part) => part.userData.firstPerson)) {
    const attributes = mesh.geometry.attributes;
    for (const index of new Set(mesh.geometry.index.array)) {
      let weight = 0;
      for (let influence = 0; influence < 4; influence += 1) {
        if (handBones.has(attributes.skinIndex.array[index * 4 + influence])) weight += attributes.skinWeight.array[index * 4 + influence];
      }
      if (weight > 0.7) nearest = Math.min(nearest, worldVertex(mesh, index).distanceTo(grip));
    }
  }
  assert.ok(nearest < 0.09, `The uploaded hand must stay around the unchanged rod grip (${nearest}).`);
  assert.equal(gripRig.carry.rod.parent, gripRig.carry.rightSocket);
  assert.equal(gripRig.carry.rightSocket.parent, hand);
  if (handCase.castRetrieving) {
    const direction = gripRig.getRodTip().sub(gripRig.carry.rod.getWorldPosition(new THREE.Vector3())).normalize();
    assert.ok(direction.y > 0.9999, "Full retrieval reaches vertical with the uploaded hand, not just the default model.");
  }
  if (handCase.rodLiftHeld) assert.ok(gripRig.rodLiftAngle > 0.2 && gripRig.rodLiftAngle < 0.4, "Short pull retains the limited physical lift.");
}
gripModel.dispose();
rig.update(0, { state: "paused", cameraMode: "third-person", viewBlend: 1 });
assert.ok(model.meshes.every((mesh) => mesh.visible && mesh.layers.mask === 1));
assert.deepEqual(model.meshes.map((mesh) => [mesh.uuid, mesh.geometry.uuid, mesh.material.uuid]), identities);
assert.deepEqual(rig.skeleton.boneInverses.map((matrix) => matrix.toArray()), inverseBinds);
model.skeleton.computeBoneTexture();
let geometryDisposals = 0, materialDisposals = 0, skinSkeletonDisposals = 0;
model.skeleton.boneTexture.addEventListener("dispose", () => { skinSkeletonDisposals += 1; });
for (const mesh of model.meshes) mesh.geometry.addEventListener("dispose", () => { geometryDisposals += 1; });
for (const material of Object.values(model.materials)) material.addEventListener("dispose", () => { materialDisposals += 1; });
model.dispose(); model.dispose();
assert.equal(geometryDisposals, model.meshes.length);
assert.equal(materialDisposals, 5);
assert.equal(model.group.children.length, 0);
assert.equal(skinSkeletonDisposals, 1);
assert.equal(model.extraBones.SkinRightPalm.parent, null);
assert.equal(model.extraBones.SkinRightForearm.parent, null);
console.log("Uploaded skin geometry, textures, unchanged rig, gait, first-person grip and disposal tests passed.");
