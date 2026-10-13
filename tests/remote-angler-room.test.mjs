import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const { SnejRemotePlayerRoom } = await import("../src/multiplayer/room.js");
const THREE = await import("three");
const room = new SnejRemotePlayerRoom();
const presence = (clientId, x, z, yaw = 0) => ({ clientId, presence: { id: clientId === "a" ? 6 : 7, name: `SkinQA_${clientId}`, rank: "player", x, y: 0, z, yaw } });
room.applyPresence(presence("a", 0, 0, Math.PI - 0.01));
room.applyPresence(presence("b", 2, 0));
const a = room.players.get("a"), b = room.players.get("b");
for (const player of [a, b]) {
  assert.equal(player.model, player.angler.group);
  assert.equal(player.model.parent, room.group);
  assert.equal(player.angler.model.group.name, "UploadedAnglerModel");
  assert.equal(player.angler.model.meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0), 6847,
    "Remote players use the complete uploaded character, not a capsule or the old skin.");
  assert.ok(player.angler.model.meshes.every((mesh) => mesh.isSkinnedMesh && !mesh.material.transparent));
  assert.ok(player.angler.model.meshes.some((mesh) => mesh.name === "UploadedBody2"));
  assert.ok(player.angler.model.meshes.some((mesh) => mesh.name === "UploadedBody3"));
  assert.equal(player.angler.visuals.visible, false);
  assert.equal(player.angler.firstPersonWeight, 0);
}
assert.notEqual(a.angler.skeleton, b.angler.skeleton, "Each player has independent animation bones.");
assert.notEqual(a.angler.model.materials.yasin_body, b.angler.model.materials.yasin_body);
const identity = a.model;
room.applyPresence(presence("a", 1, 0, -Math.PI + 0.01));
room.update(0.1);
assert.equal(a.model, identity, "Presence updates do not rebuild meshes.");
assert.ok(a.model.position.x > 0 && a.model.position.x < 1, "Positions remain interpolated.");
assert.ok(a.model.rotation.y > Math.PI - 0.01, "A wrapped yaw takes the short turn, not a full revolution.");
assert.notEqual(a.angler.locomotionState, "idle");
assert.equal(b.angler.locomotionState, "idle", "Another player's animation remains independent.");
for (let i = 0; i < 90; i++) room.update(1 / 30);
assert.equal(a.angler.locomotionState, "idle", "Stationary players settle to idle without leaving the room.");
assert.equal(room.listPeers().length, 2);
assert.ok(a.angler.model.meshes.every((mesh) => mesh.visible && mesh.layers.mask === 1));
const position = a.model.position.clone();
room.update(0);
room.update(NaN);
assert.ok(a.model.position.equals(position));
room.applyPresence(presence("bad", NaN, 0));
room.applyPresence(null);
room.applyPresence({ clientId: "bad", presence: null });
const validTarget = a.target.clone(), validYaw = a.yaw;
for (const invalid of [{ y: Infinity }, { y: "0" }, { yaw: Infinity }, { yaw: "0" }]) {
  const bad = presence("a", 10, 10);
  Object.assign(bad.presence, invalid);
  room.applyPresence(bad);
  assert.ok(a.target.equals(validTarget), "Malformed optional transforms cannot corrupt a live model.");
  assert.equal(a.yaw, validYaw);
}
assert.equal(room.players.size, 2);

const observer = new THREE.PerspectiveCamera();
observer.position.copy(a.model.position).add(new THREE.Vector3(0, 1.6, 0));
room.update(0, observer);
assert.equal(a.model.visible, false, "A camera inside a co-located peer must not render its face around the screen.");
assert.equal(b.model.visible, true, "Other nearby players retain their complete third-person model.");
observer.position.z += 4;
room.update(0, observer);
assert.equal(a.model.visible, true, "Leaving the overlapping body restores the full skin.");
assert.equal(b.model.visible, true);
room.update(0);
assert.equal(a.model.visible, true);

const materials = a.model.userData.materials;
assert.equal(materials.length, new Set(materials).size);
const disposed = new Map();
const skinTextures = new Set(Object.values(a.angler.model.materials).map((material) => material.map));
let texturesDisposed = 0;
for (const texture of skinTextures) texture.addEventListener("dispose", () => { texturesDisposed += 1; });
for (const material of materials) material.addEventListener("dispose", () => disposed.set(material, (disposed.get(material) || 0) + 1));
a.angler.skeleton.computeBoneTexture();
let skeletonDisposed = false;
a.angler.skeleton.boneTexture.addEventListener("dispose", () => { skeletonDisposed = true; });
room.remove("a");
assert.equal(room.players.size, 1);
assert.equal(a.model.parent, null);
assert.equal(skeletonDisposed, true);
assert.ok(materials.every((material) => disposed.get(material) === 1), "Shared avatar materials are disposed exactly once.");
assert.equal(texturesDisposed, skinTextures.size, "Leaving releases the uploaded skin textures as well as meshes.");
room.remove("a");
room.clear();
assert.equal(room.players.size, 0);
assert.equal(room.group.children.length, 0);
console.info("Remote skinned angler, independent gait, shortest-turn interpolation and lifecycle tests passed.");
