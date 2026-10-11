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
const model = rig.model;
assert.equal(model.group.parent, rig.rig);
assert.equal(rig.visuals.visible, false, "The main character must be a solid model, not the skeleton preview.");
assert.ok(model.meshes.length > 20);
assert.ok(model.meshes.every((mesh) => mesh.isSkinnedMesh && mesh.skeleton === rig.skeleton));
assert.ok(model.meshes.every((mesh) => !mesh.material.transparent && mesh.material.depthTest));
assert.ok(model.meshes.every((mesh) => mesh.frustumCulled === false));
assert.ok(model.meshes.some((mesh) => mesh.name === "Face"));
assert.ok(model.meshes.some((mesh) => mesh.name === "Jacket"));
const triangles = model.meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
assert.ok(triangles < 5000, "The local model must stay lightweight.");
const identities = model.meshes.map((mesh) => [mesh.uuid, mesh.geometry.uuid, mesh.material.uuid]);
const binds = rig.skeleton.boneInverses.map((matrix) => matrix.toArray());
for (const mesh of model.meshes) {
  const { position, normal, skinIndex, skinWeight } = mesh.geometry.attributes;
  assert.equal(skinIndex.count, position.count);
  assert.equal(skinWeight.count, position.count);
  assert.ok([...position.array, ...normal.array].every(Number.isFinite));
  for (let i = 0; i < position.count; i += 1) {
    let sum = 0;
    for (let j = 0; j < 4; j += 1) {
      const index = skinIndex.array[i * 4 + j], weight = skinWeight.array[i * 4 + j];
      assert.ok(index >= 0 && index < rig.skeleton.bones.length);
      assert.ok(weight >= 0 && weight <= 1);
      sum += weight;
    }
    assert.ok(Math.abs(sum - 1) < 1e-6, "Every model vertex must have normalized skin weights.");
  }
}

const pants = model.meshes.find((mesh) => mesh.name === "LeftTrousers");
const hand = model.meshes.find((mesh) => mesh.name === "RightHand");
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1800);
const castCamera = camera.clone();
const vertex = (mesh, index = 0) => {
  mesh.updateMatrixWorld(true);
  return mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
};
let movingVertices = new Set();
rig.group.position.set(2, 0.15, -3);
rig.group.rotation.y = 1.1;
for (const [speed, depth, state] of [[0, 0, "idle"], [4, 0, "walk"], [6.8, 0, "run"], [1.6, 0.5, "wade"]]) {
  for (let frame = 0; frame < 90; frame += 1) {
    rig.update(1 / 60, { state: "playing", speed, depth, directionX: Math.sin(1.1), directionZ: Math.cos(1.1) });
    for (const mesh of model.meshes) {
      for (const index of [0, Math.floor(mesh.geometry.attributes.position.count / 2)]) {
        assert.ok(vertex(mesh, index).toArray().every(Number.isFinite), "Animation cannot corrupt the skinned model.");
      }
    }
    const position = vertex(pants);
    if (speed > 0) movingVertices.add(position.toArray().map((n) => n.toFixed(4)).join(","));
    const grip = rig.carry.rod.getWorldPosition(new THREE.Vector3());
    assert.ok(vertex(hand).distanceTo(grip) < 0.15, "The same model hand must remain around the rod grip.");
  }
  assert.equal(rig.locomotionState, state);
  assert.ok(model.meshes.every((mesh) => mesh.visible), "All model parts must be visible in third person.");
}
assert.ok(movingVertices.size > 100, "The actual trouser mesh, not just invisible bones, must animate.");
const paused = model.meshes.map((mesh) => vertex(mesh).toArray());
for (let frame = 0; frame < 20; frame += 1) rig.update(0, { state: "paused", speed: 0 });
assert.deepEqual(model.meshes.map((mesh) => vertex(mesh).toArray()), paused);

for (const aspect of [16 / 9, 390 / 844]) {
  camera.aspect = castCamera.aspect = aspect;
  camera.position.copy(rig.group.position).add(new THREE.Vector3(0, 1.62, 0));
  const forward = new THREE.Vector3(Math.sin(1.1), 0, Math.cos(1.1));
  camera.lookAt(camera.position.clone().add(forward));
  castCamera.position.copy(camera.position);
  castCamera.quaternion.copy(camera.quaternion);
  camera.updateProjectionMatrix();
  castCamera.updateProjectionMatrix();
  for (const castState of ["idle", "wait"]) {
    for (let frame = 0; frame < 90; frame += 1) {
      rig.update(1 / 60, { state: "playing", speed: 0, camera, castCamera, cameraMode: "first-person", viewBlend: 0, castState });
    }
    for (const mesh of model.meshes) {
      assert.equal(mesh.visible, mesh.userData.firstPerson, "First person must show only the existing right forearm and hand.");
      assert.equal(mesh.layers.mask, 2);
      assert.equal(mesh.castShadow, false);
    }
    assert.equal(model.meshes.find((mesh) => mesh.name === "Face").visible, false);
    const handPoint = rig.bones.RightHand.getWorldPosition(new THREE.Vector3()).project(camera);
    assert.ok(handPoint.x > 0 && handPoint.x < 1 && handPoint.y > -1 && handPoint.y < 1);
    const grip = rig.carry.rod.getWorldPosition(new THREE.Vector3());
    assert.ok(vertex(hand).distanceTo(grip) < 0.15);
    const before = rig.getRodTip();
    rig.update(1 / 60, { state: "playing", speed: 0, camera, castCamera, cameraMode: "third-person", viewBlend: 1, castState });
    assert.ok(model.meshes.every((mesh) => mesh.visible && mesh.layers.mask === 1 && mesh.castShadow));
    if (castState === "wait") assert.ok(rig.getRodTip().distanceTo(before) < 1e-6, "Model visibility must not change the cast grip.");
  }
}
assert.deepEqual(model.meshes.map((mesh) => [mesh.uuid, mesh.geometry.uuid, mesh.material.uuid]), identities);
assert.deepEqual(rig.skeleton.boneInverses.map((matrix) => matrix.toArray()), binds);
assert.equal(rig.carry.rod.parent, rig.carry.rightSocket);
assert.equal(rig.carry.rightSocket.parent, rig.bones.RightHand);

const disposable = new SnejAngler().model;
let disposed = 0;
for (const mesh of disposable.meshes) mesh.geometry.addEventListener("dispose", () => { disposed += 1; });
for (const material of Object.values(disposable.materials)) material.addEventListener("dispose", () => { disposed += 1; });
disposable.dispose();
assert.equal(disposed, disposable.meshes.length + Object.keys(disposable.materials).length);
assert.equal(disposable.group.children.length, 0, "Rebuilding the world must release the previous model resources.");

console.log(`Skinned character model tests passed (${triangles} triangles).`);
