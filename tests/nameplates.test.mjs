import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const THREE = await import("three");
const { SnejRemotePlayerRoom } = await import("../src/multiplayer/room.js");

test("nameplates follow interpolated avatars, hide behind the camera and clean up", () => {
  const children = [];
  const root = { ownerDocument: { createElement() { return { dataset: {}, style: {},
    remove() { children.splice(children.indexOf(this), 1); } }; } }, appendChild(value) { children.push(value); } };
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
