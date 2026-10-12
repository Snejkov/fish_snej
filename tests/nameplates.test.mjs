import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const THREE = await import("three");
const { SnejRemotePlayerRoom } = await import("../src/multiplayer/room.js");

function labelRoot() {
  const children = [];
  const root = { ownerDocument: { createElement() { return { dataset: {}, style: {},
    remove() { children.splice(children.indexOf(this), 1); } }; } }, appendChild(value) { children.push(value); } };
  return { root, children };
}

test("nameplates follow interpolated avatars, hide behind the camera and clean up", () => {
  const { root, children } = labelRoot();
  const room = new SnejRemotePlayerRoom({ labelRoot: root });
  const presence = (x, name = "Player") => ({ clientId: "peer", presence: { x, y: 0, z: 0, id: 3, name } });
  room.applyPresence(presence(0));
  const player = room.players.get("peer"), label = player.label;
  assert.equal(label.textContent, "Player #3");
  assert.equal(label.dataset.i18nSkip, "true");
  const camera = new THREE.PerspectiveCamera(70, 2, 0.05, 1800);
  camera.position.set(0, 2.15, 10); camera.lookAt(0, 2.15, 0);
  room.update(0, camera, { width: 800, height: 400 });
  assert.equal(label.hidden, false);
  assert.equal(label.style.left, "400px");
  assert.equal(label.style.top, "200px");
  room.applyPresence(presence(2, "OtherName"));
  room.update(0.1, camera, { width: 800, height: 400 });
  assert.equal(player.label, label);
  assert.equal(label.textContent, "OtherName #3");
  assert.ok(Number.parseFloat(label.style.left) > 400);
  camera.lookAt(0, 2.15, 20);
  room.update(0, camera, { width: 800, height: 400 });
  assert.equal(label.hidden, true);
  camera.position.copy(player.model.position).add(new THREE.Vector3(0, 1.6, 0));
  room.update(0, camera, { width: 800, height: 400 });
  assert.equal(label.hidden, true);
  room.remove("peer");
  assert.equal(children.length, 0);
  room.clear();
});

test("names stop at 50 horizontal meters; connected players beyond local chat retain an activity marker", () => {
  const { root, children } = labelRoot();
  const room = new SnejRemotePlayerRoom({ labelRoot: root });
  const camera = new THREE.PerspectiveCamera(70, 2, 0.05, 1800);
  camera.position.set(0, 2.15, 0); camera.lookAt(0, 2.15, -200);
  const observer = new THREE.Vector3();
  for (const [distance, distant] of [[49.999, false], [50, false], [50.001, true], [75, true], [100, true], [100.001, true], [200, true]]) {
    room.applyPresence({ clientId: "peer", presence: { x: 0, y: 0, z: -distance, id: 7, name: "NearFar" } });
    room.update(0, camera, { width: 800, height: 400 }, observer);
    const label = room.players.get("peer").label;
    assert.equal(label.dataset.distant, String(distant));
    assert.equal(label.textContent, distant ? "" : "NearFar #7");
    assert.equal(label.hidden, false);
    assert.equal(room.listPeers()[0].name, "NearFar", "Distance must not change membership or the real roster.");
    room.remove("peer");
    assert.equal(children.length, 0);
  }
});

test("changing the camera cannot change the range and height does not count toward horizontal distance", () => {
  const { root } = labelRoot();
  const room = new SnejRemotePlayerRoom({ labelRoot: root });
  const camera = new THREE.PerspectiveCamera(70, 2, 0.05, 1800);
  const observer = new THREE.Vector3(0, 100, 0);
  for (const [x, z, distant] of [[30, -40, false], [30.01, -40, true]]) {
    room.applyPresence({ clientId: "peer", presence: { x, y: 0, z, id: 7, name: "Boundary" } });
    for (const cameraZ of [-4, 4]) {
      camera.position.set(0, 2.15, cameraZ); camera.lookAt(x, 2.15, z);
      room.update(0, camera, { width: 800, height: 400 }, observer);
      assert.equal(room.players.get("peer").label.dataset.distant, String(distant));
    }
    room.remove("peer");
  }
});

test("approaching reveals the latest name on the same interpolated label; leaving restores the marker", () => {
  const { root } = labelRoot();
  const room = new SnejRemotePlayerRoom({ labelRoot: root });
  const camera = new THREE.PerspectiveCamera(70, 2, 0.05, 1800);
  camera.position.set(0, 2.15, 0); camera.lookAt(0, 2.15, -100);
  const observer = new THREE.Vector3(), viewport = { width: 800, height: 400 };
  const presence = (distance, name) => ({ clientId: "peer", presence: { x: 0, y: 0, z: -distance, id: 9, name } });
  room.applyPresence(presence(51, "FarName"));
  room.update(0, camera, viewport, observer);
  const label = room.players.get("peer").label;
  assert.equal(label.textContent, "");
  room.applyPresence(presence(49, "UpdatedName"));
  assert.equal(label.textContent, "", "Presence updates cannot expose a far name between animation frames.");
  room.update(0.01, camera, viewport, observer);
  assert.equal(label.dataset.distant, "true");
  room.update(0.1, camera, viewport, observer);
  assert.equal(room.players.get("peer").label, label);
  assert.equal(label.dataset.distant, "false");
  assert.equal(label.textContent, "UpdatedName #9");
  observer.z = 100;
  room.update(0, camera, viewport, observer);
  assert.equal(label.dataset.distant, "true");
  assert.equal(label.textContent, "");
  room.clear();
});
