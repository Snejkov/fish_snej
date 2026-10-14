import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "three" ? { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejAngler } = await import("../src/angler.js");
const { skinFactory } = await import("../src/skins.js");
const { SnejRemotePlayerRoom } = await import("../src/multiplayer/room.js");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { makePresence } = await import("../src/multiplayer/presence.js");
const { SKIN_OPTIONS, normalizeSkinId, readSkinPreference, saveSkinPreference } = await import("../src/skinIds.js");
const { SKIN_DATA } = await import("../src/assets/elise-skin/skinData.js");

test("Known skins have real portraits; preferences tolerate unavailable storage", () => {
  assert.deepEqual(SKIN_OPTIONS.map((skin) => skin.id), ["angler", "elise", "zubenko"]);
  for (const skin of SKIN_OPTIONS) {
    const bytes = readFileSync(new URL("../" + skin.portrait, import.meta.url));
    assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a");
  }
  for (const value of [null, undefined, "unknown", "../file", { toString: () => "elise" }]) assert.equal(normalizeSkinId(value), "angler");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value)
    } });
    assert.equal(readSkinPreference(), "angler");
    assert.equal(saveSkinPreference("elise"), "elise");
    assert.equal(readSkinPreference(), "elise");
    assert.equal(saveSkinPreference("zubenko"), "zubenko");
    assert.equal(readSkinPreference(), "zubenko");
    const game = Object.assign(Object.create(Game.prototype), { mode: "title", skinId: "angler", ui: { syncSkinPickers() {} } });
    assert.equal(game.selectSkin("elise"), true);
    assert.equal(game.skinId, "elise");
    game.mode = "playing";
    assert.equal(game.selectSkin("angler"), false, "Skin changes happen before entry, not during a cast.");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.equal(readSkinPreference(), "angler");
    assert.equal(saveSkinPreference("elise"), "elise");
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});

test("Elise source geometry, transparency, weighted animation and gameplay sockets", () => {
  const rig = new SnejAngler({ modelFactory: skinFactory("elise") });
  const original = new SnejAngler({ modelFactory: skinFactory("angler") });
  assert.equal(rig.model.group.name, "EliseAnglerModel");
  assert.equal(SKIN_DATA.vertexCount, 42150);
  assert.equal(rig.model.meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0), 63182);
  assert.equal(Object.keys(rig.model.materials).length, 14);
  assert.equal(new Set(rig.model.meshes.flatMap((mesh) => Object.values(mesh.geometry.attributes))).size, 5);
  assert.equal(rig.skeleton.bones.length, 24);
  assert.equal(rig.model.skeleton.bones.length, 28);
  const tipIndex = rig.model.skeleton.bones.indexOf(rig.model.extraBones.SkinRightFingertip);
  const handGeometry = rig.model.meshes[0].geometry;
  assert.ok(handGeometry.attributes.skinWeight.array.some((weight, index) => weight > 0.1 && handGeometry.attributes.skinIndex.array[index] === tipIndex),
    "Appearance-only fingertip weights let the supplied straight fingers curl around the existing grip.");
  assert.equal(rig.model.materials["h-d_base"].alphaTest, 0.35);
  assert.equal(rig.model.materials.face_eyeshadow_base.transparent, true);
  for (const texture of SKIN_DATA.textures) {
    assert.ok(texture.width <= 1024 && texture.height <= 1024);
    const png = readFileSync(new URL(`../src/assets/elise-skin/${texture.name}.png`, import.meta.url));
    assert.equal(png.readUInt32BE(16), texture.width);
    assert.equal(png.readUInt32BE(20), texture.height);
  }
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 50);
  camera.position.set(0, 1.66, 0); camera.lookAt(0, 1.66, 1);
  const cases = [{ speed: 0, castState: "idle" }, { speed: 4, castState: "idle" }, { speed: 6.8, castState: "idle" },
    { speed: 1.6, depth: 0.5, castState: "idle" }, { speed: 0, castState: "charge" },
    { speed: 0, castState: "wait" }, { speed: 0, castState: "wait", rodLiftHeld: true },
    { speed: 0, castState: "flight", castRetrieving: true }];
  const point = new THREE.Vector3();
  for (const handCase of cases) {
    const info = { state: "playing", directionX: 0, directionZ: 1, depth: 0,
      camera, castCamera: camera, cameraMode: "first-person", viewBlend: 0, ...handCase };
    for (let frame = 0; frame < 90; frame++) { rig.update(1 / 60, info); original.update(1 / 60, info); }
    rig.group.updateMatrixWorld(true); rig.model.skeleton.update();
    assert.ok(rig.getRodTip().distanceTo(original.getRodTip()) < 1e-8);
    assert.ok(rig.getRetrieveHand().distanceTo(original.getRetrieveHand()) < 1e-8);
    const geometry = rig.model.meshes[0].geometry;
    for (let vertex = 0; vertex < SKIN_DATA.vertexCount; vertex += 37) {
      point.fromBufferAttribute(geometry.attributes.position, vertex);
      rig.model.meshes[0].applyBoneTransform(vertex, point);
      assert.ok(point.toArray().every(Number.isFinite));
      let weight = 0;
      for (let influence = 0; influence < 4; influence++) weight += geometry.attributes.skinWeight.array[vertex * 4 + influence];
      assert.ok(Math.abs(weight - 1) < 1e-6);
    }
    assert.ok(rig.model.meshes.some((mesh) => mesh.userData.firstPerson && mesh.visible));
  }
  let disposals = 0;
  rig.model.skeleton.computeBoneTexture();
  rig.model.skeleton.boneTexture.addEventListener("dispose", () => disposals++);
  rig.model.dispose(); rig.model.dispose();
  assert.equal(disposals, 1);
  original.model.dispose();
});

test("Remote peers choose independent known skins and dispose a replaced appearance", () => {
  const room = new SnejRemotePlayerRoom();
  const message = (clientId, skinId) => ({ clientId, presence: { id: 2, name: "SkinPlayer", x: 3, y: 1, z: 4, skinId } });
  room.applyPresence(message("first", "angler"));
  room.applyPresence(message("second", "elise"));
  room.applyPresence(message("third", "zubenko"));
  const a = room.players.get("first"), b = room.players.get("second");
  assert.equal(a.angler.model.group.name, "UploadedAnglerModel");
  assert.equal(b.angler.model.group.name, "EliseAnglerModel");
  assert.equal(room.players.get("third").angler.model.group.name, "ZubenkoAnglerModel");
  assert.notEqual(a.angler.skeleton, b.angler.skeleton);
  assert.notEqual(a.angler.model.meshes[0].geometry.attributes.position, b.angler.model.meshes[0].geometry.attributes.position);
  let disposed = 0;
  b.angler.model.materials.body_base.addEventListener("dispose", () => disposed++);
  room.applyPresence(message("second", "unknown"));
  assert.equal(disposed, 1);
  assert.equal(room.players.get("second").skinId, "angler");
  assert.equal(room.players.size, 3);
  const game = { skinId: "elise", pos: new THREE.Vector3(), yaw: 0 };
  assert.equal(makePresence(game, 1).skinId, "elise");
  game.skinId = "zubenko";
  assert.equal(makePresence(game, 2).skinId, "zubenko");
  game.skinId = "file:///outside.js";
  assert.equal(makePresence(game, 2).skinId, "angler");
  room.clear();
  assert.equal(room.players.size, 0);
});

test("Zubenko preserves supplied geometry and the original pole throughout real poses", async () => {
  const { SKIN_DATA: data } = await import("../src/assets/zubenko-skin/skinData.js");
  const rig = new SnejAngler({ modelFactory: skinFactory("zubenko") });
  const reference = new SnejAngler({ modelFactory: skinFactory("angler") });
  assert.equal(data.vertexCount, 4095);
  assert.equal(rig.model.meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0), 6530);
  assert.equal(Object.keys(rig.model.materials).length, 4);
  assert.equal(new Set(rig.model.meshes.flatMap((mesh) => Object.values(mesh.geometry.attributes))).size, 5);
  assert.deepEqual(rig.skeleton.bones.map((bone) => bone.name), reference.skeleton.bones.map((bone) => bone.name));
  assert.deepEqual(rig.skeleton.boneInverses.map((matrix) => matrix.toArray()), reference.skeleton.boneInverses.map((matrix) => matrix.toArray()));
  for (const texture of data.textures) {
    const bytes = readFileSync(new URL(`../src/assets/zubenko-skin/${texture.name}.png`, import.meta.url));
    assert.equal(bytes.readUInt32BE(16), 256);
    assert.equal(bytes.readUInt32BE(20), 256);
  }
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 50);
  camera.position.set(0, 1.66, 0); camera.lookAt(0, 1.66, 1);
  for (const pose of [{ speed: 0 }, { speed: 4 }, { speed: 6.8 }, { speed: 1.6, depth: 0.5 },
    { speed: 0, castState: "charge" }, { speed: 0, castState: "wait" },
    { speed: 0, castState: "wait", rodLiftHeld: true }, { speed: 0, castState: "flight", castRetrieving: true }]) {
    const info = { state: "playing", depth: 0, directionX: 0, directionZ: 1, castState: "idle",
      camera, castCamera: camera, cameraMode: "first-person", viewBlend: 0, ...pose };
    for (let frame = 0; frame < 90; frame++) { rig.update(1 / 60, info); reference.update(1 / 60, info); }
    assert.ok(rig.getRodTip().distanceTo(reference.getRodTip()) < 1e-8);
    assert.ok(rig.getRetrieveHand().distanceTo(reference.getRetrieveHand()) < 1e-8);
    rig.group.updateMatrixWorld(true); rig.model.skeleton.update();
    const mesh = rig.model.meshes[0], point = new THREE.Vector3();
    for (let vertex = 0; vertex < data.vertexCount; vertex += 7) {
      point.fromBufferAttribute(mesh.geometry.attributes.position, vertex);
      mesh.applyBoneTransform(vertex, point);
      assert.ok(point.toArray().every(Number.isFinite));
    }
    assert.ok(rig.model.meshes.some((mesh) => mesh.userData.firstPerson && mesh.visible));
  }
  rig.model.dispose(); reference.model.dispose();
});
