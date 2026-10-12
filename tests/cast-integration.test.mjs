import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { t } from "../src/i18n.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const THREE = await import("three");
const { SnejAngler } = await import("../src/angler.js");
const { SnejFishingGame } = await import("../src/game.js");
const { SnejWater } = await import("../src/water.js");
const { SnejAudio } = await import("../src/audio.js");
const { SnejCastSystem } = await import("../src/castSystem.js");
const { SnejFloatRig } = await import("../src/floatRig.js");
const rig = new SnejAngler();
rig.group.position.set(10, 2, -5);
rig.group.rotation.y = Math.PI / 2;
rig.heading = 0;
const origin = rig.getCastOrigin();
assert.ok(origin.distanceTo(new THREE.Vector3(10.55, 3.25, -5)) < 1e-9, "Cast origin must include the group world yaw.");
const out = new THREE.Vector3();
assert.equal(rig.getRodTip(out), out);
assert.ok(out.distanceTo(rig.carry.tip.getWorldPosition(new THREE.Vector3())) < 1e-9,
  "The line must start at the actual rod tip, not at the wrist.");
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1800);
camera.position.set(10, 3.62, -5);
camera.lookAt(11, 4, -5);
for (const viewBlend of [0, 0.5, 1, 0]) {
  rig.update(1 / 60, { state: "playing", speed: 0, camera, viewBlend });
  assert.ok(rig.getCastOrigin(out).distanceTo(origin) < 1e-9, "Camera and arm poses must not jitter the virtual origin.");
}
const parent = new THREE.Group();
parent.position.set(3, 1, 7);
parent.rotation.y = -Math.PI / 2;
parent.add(rig.group);
const expected = new THREE.Vector3(0, 1.25, 0.55);
rig.group.updateWorldMatrix(true, false);
expected.applyMatrix4(rig.group.matrixWorld);
assert.ok(rig.getCastOrigin(out).distanceTo(expected) < 1e-9, "Parent transforms must be included.");
assert.equal(SnejWater.prototype.surfaceY(8, 10), 0);
const grid = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
[0, 2, 3, 9].forEach((height, index) => grid.geometry.attributes.position.setY(index, height));
const visualWorld = {
  renderedTerrainHeight: SnejFishingGame.prototype.renderedTerrainHeight,
  terrain: { groundMesh: grid, heightAt: () => 0, depthAt: () => 0, dockLocal: () => ({ along: -100, side: 100 }) },
  water: { surfaceY: () => 0 }, lake: { dockLength: 20, dockWidth: 3 }
};
for (const [x, z] of [[-3, -3], [3, 3], [-3, 3], [2, -1]]) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(grid)[0];
  const height = SnejFishingGame.prototype.castMarkerHeight.call(visualWorld, { x, z });
  assert.ok(Math.abs(height - hit.point.y) < 1e-6, "Marker height must match both rendered grid triangles.");
}
const waterMaskWorld = {
  renderedTerrainHeight: SnejFishingGame.prototype.renderedTerrainHeight,
  castSurfacePoint: new THREE.Vector3(),
  terrain: { ...visualWorld.terrain, depthAt: () => 4, obstacles: [] },
  water: { surfaceY: () => 4 }, lake: { dockLength: 20, dockWidth: 3 }
};
const waterMask = (x, z) => SnejFishingGame.prototype.isCastWater.call(waterMaskWorld, x, z);
assert.equal(waterMask(-3, -3), true);
assert.equal(waterMask(3, 3), false, "Rendered land over the analytic lake cannot accept a cast.");
waterMaskWorld.terrain.dockLocal = () => ({ along: 1, side: 0 });
assert.equal(waterMask(-3, -3), false, "A dock covering the water must block the water mask.");
waterMaskWorld.terrain.dockLocal = () => ({ along: -100, side: 100 });
waterMaskWorld.terrain.obstacles = [{ x: -3, z: -3, r: 1, top: 6 }];
assert.equal(waterMask(-3, -3), false, "A rock covering the water must block the water mask.");
waterMaskWorld.terrain.obstacles[0].top = 2;
assert.equal(waterMask(-3, -3), true, "A submerged rock does not hide the water texture.");
grid.geometry.dispose();
grid.material.dispose();

const tones = [];
const audio = { tone: (tone) => tones.push(tone) };
SnejAudio.prototype.charge.call(audio);
SnejAudio.prototype.cast.call(audio, 0.5);
SnejAudio.prototype.splash.call(audio, 0.5);
assert.equal(tones.length, 3);
assert.equal(tones[1].freq, 500);
assert.equal(tones[2].gain, 0.05);

const game = {
  castGroundHeight: SnejFishingGame.prototype.castGroundHeight,
  terrain: {
    dockBlocksSegment: (x0, y0, z0, x1, y1, z1) => x0 < 2 && x1 >= 2 && Math.min(y0, y1) < 2,
    heightAt: () => -4,
    obstacles: [{ x: 5, z: 0, r: 0.5, top: 3, kind: "rock" }]
  }
};
const obstruction = (a, b, sag) => SnejFishingGame.prototype.lineObstruction.call(game, a, b, sag);
assert.equal(obstruction({ x: 0, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }, 0), "dock");
assert.equal(obstruction({ x: 0, y: 4, z: 0 }, { x: 3, y: 4, z: 0 }, 0), null);
assert.equal(obstruction({ x: 4, y: 2, z: 0 }, { x: 6, y: 2, z: 0 }, 0), "rock");
assert.equal(obstruction({ x: 4, y: 4, z: 0 }, { x: 6, y: 4, z: 0 }, 0), null);
game.terrain.heightAt = () => 0.5;
assert.equal(obstruction({ x: 4, y: 1, z: 4 }, { x: 6, y: 0, z: 4 }, 0), "land");
for (const field of ["buildOpen", "profileOpen", "inventoryOpen", "modalOpen"]) {
  assert.equal(SnejFishingGame.prototype.canCast.call({ mode: "playing", ui: { [field]: true } }), false);
}
assert.equal(SnejFishingGame.prototype.canCast.call({ mode: "playing", ui: {} }), true);
assert.equal(SnejFishingGame.prototype.canCast.call({ mode: "paused", ui: {} }), false);
assert.equal(SnejFishingGame.prototype.toastForCast({ castPerfect: true }), "Perfect");
assert.equal(SnejFishingGame.prototype.toastForCast({ charge: 0.8, targetPower: 0.5 }), "Overcast");
assert.equal(SnejFishingGame.prototype.toastForCast({ charge: 0.2, targetPower: 0.5 }), "Undercast");
for (const [reason, message] of Object.entries({
  range: "Charge a longer cast.",
  dock: "Dock blocks the cast.", rock: "Rock blocks the cast.",
  terrain: "The cast would land on land.", water: "Aim at open water.",
  reach: "Water is out of reach. Move closer."
})) assert.equal(SnejFishingGame.prototype.toastForCastRejection(reason), message);

const element = () => ({ classList: { toggle(name, enabled) { this[name] = enabled; } }, style: {}, setAttribute() {} });
const markerState = {
  fs: "idle", retrieving: false, aimValid: true, canRelease: true,
  charge: 0.5, targetPower: 0.5, requestedDist: 4, minCastDist: 1, targetValid: true,
  aimPoint: { x: 0, y: 0, z: 4 }, targetLanding: { x: 0.2, y: 0, z: 5, water: true },
  predictedLanding: { x: 0, y: 0, z: 4, water: true }
};
const placements = [];
const markerGame = {
  mode: "playing", ui: {}, yaw: 0, pitch: -0.12, pos: new THREE.Vector3(0, 0.04, 0),
  canCast: SnejFishingGame.prototype.canCast, angler: rig, castContext: {}, castTip: new THREE.Vector3(),
  cast: { state: markerState, castRange: 8, tick: () => markerState, cancelCharge() {}, isWaterAt: () => true },
  rodSelect: {}, floatDepthInput: {}, castMeter: element(), castMeterFill: element(), castMeterDistance: element(),
  castMeterTarget: element(), castMeterTol: element(),
  aimMarker: new THREE.Mesh(new THREE.RingGeometry(), new THREE.MeshBasicMaterial({ color: 0x9ff0ff })),
  terrain: { depthAt: () => 1 }, placeCastMarker: (marker, point) => placements.push({ marker, point })
};
const markerId = markerGame.aimMarker.uuid;
function checkMarkers(fs, aimValid, predictedWater, currentWater, enabled, aimVisible) {
  Object.assign(markerState, { fs, aimValid });
  markerState.predictedLanding.water = predictedWater;
  markerGame.mode = enabled ? "playing" : "paused";
  markerGame.cast.isWaterAt = () => currentWater;
  placements.length = 0;
  const before = markerGame.pos.toArray();
  SnejFishingGame.prototype.updateCast.call(markerGame, 0);
  assert.equal(markerGame.aimMarker.visible, aimVisible, "The single ring must be hidden off water or behind blocking UI.");
  assert.equal(placements.length, aimVisible ? 1 : 0, "A cast preview can place only one ring.");
  if (aimVisible) {
    assert.equal(placements[0].marker, markerGame.aimMarker);
    assert.equal(placements[0].point, markerState.targetLanding);
  }
  assert.equal(markerGame.aimMarker.material.color.getHex(), 0x9ff0ff, "Perfect, blocked, and shallow previews must keep the same color.");
  assert.deepEqual(markerGame.aimMarker.scale.toArray(), [1, 1, 1]);
  assert.equal(markerGame.aimMarker.uuid, markerId);
  assert.deepEqual(markerGame.pos.toArray(), before, "Marker visibility must not move the player.");
}
for (const fs of ["idle", "aim"]) {
  checkMarkers(fs, true, true, true, true, true);
  checkMarkers(fs, false, true, true, true, false);
  checkMarkers(fs, false, false, false, true, false);
  checkMarkers(fs, true, false, false, true, false);
  checkMarkers(fs, true, true, false, true, false);
  checkMarkers(fs, true, true, true, false, false);
}
for (const fs of ["charge", "flight", "wait"]) {
  checkMarkers(fs, true, true, true, true, false);
  assert.equal(markerGame.castMeter.classList.hidden, true, "Direct casts never show a strength meter.");
}
markerState.targetValid = false;
checkMarkers("aim", true, true, true, true, false);
markerState.targetValid = true;
checkMarkers("idle", true, true, true, true, true);
for (const depth of [0.01, 0.4, 4]) {
  markerGame.terrain.depthAt = () => depth;
  checkMarkers("aim", true, true, true, true, true);
}
markerGame.aimMarker.geometry.dispose();
markerGame.aimMarker.material.dispose();
const depthGame = {
  settings: { rodLength: 5, floatDepth: 0.5 }, angler: rig,
  cast: new SnejCastSystem({ rodRange: 10, floatDepth: 0.5 }), floatRig: new SnejFloatRig(),
  rodSelect: { options: [{}, {}, {}] }, rodReadout: {}, floatDepthInput: {}, floatDepthReadout: {},
  applyRod: SnejFishingGame.prototype.applyRod,
  updateCast() {}, updateCastVisuals() {},
  save() { this.saved = { ...this.settings }; }
};
for (const value of [-1, 99, NaN]) {
  assert.equal(SnejFishingGame.prototype.selectFloatDepth.call(depthGame, value), false);
  assert.equal(depthGame.settings.floatDepth, 0.5);
}
for (const fs of ["charge", "flight"]) {
  depthGame.cast.state.fs = fs;
  assert.equal(SnejFishingGame.prototype.selectFloatDepth.call(depthGame, 1), false);
  assert.equal(depthGame.cast.rig.floatDepth, 0.5);
}
depthGame.cast.state.fs = "wait";
assert.equal(SnejFishingGame.prototype.selectFloatDepth.call(depthGame, 0.75), true);
assert.equal(depthGame.cast.state.fs, "idle");
assert.equal(depthGame.cast.castRange, 4.25);
assert.equal(depthGame.floatDepthInput.value, "0.75");
assert.equal(depthGame.saved.floatDepth, 0.75);
assert.equal(depthGame.rodReadout.textContent, t("Rod {length} m / Range {range} m", { length: 5, range: 4.25 }));
assert.equal(depthGame.floatDepthReadout.textContent, t("Depth {depth} m / Line {length} m", { depth: 0.75, length: 5 }));
depthGame.settings.floatDepth = 4.5;
depthGame.applyRod({ length: 4, range: 8 });
assert.equal(depthGame.settings.floatDepth, 3.75, "Selecting a shorter rod must clamp the stored depth to its line budget.");
assert.equal(depthGame.floatDepthInput.max, "3.75");
console.log("Stage 4 cast integration tests passed.");
