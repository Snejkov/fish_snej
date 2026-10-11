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
const { SnejFishingGame } = await import("../src/game.js");
const { SnejWater } = await import("../src/water.js");
const { SnejAudio } = await import("../src/audio.js");
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
  water: { waveHeight: () => 4 }, lake: { dockLength: 20, dockWidth: 3 }
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
for (const field of ["buildOpen", "profileOpen", "modalOpen"]) {
  assert.equal(SnejFishingGame.prototype.canCast.call({ mode: "playing", ui: { [field]: true } }), false);
}
assert.equal(SnejFishingGame.prototype.canCast.call({ mode: "playing", ui: {} }), true);
assert.equal(SnejFishingGame.prototype.canCast.call({ mode: "paused", ui: {} }), false);
assert.equal(SnejFishingGame.prototype.toastForCast({ castPerfect: true }), "Perfect");
assert.equal(SnejFishingGame.prototype.toastForCast({ charge: 0.8, targetPower: 0.5 }), "Overcast");
assert.equal(SnejFishingGame.prototype.toastForCast({ charge: 0.2, targetPower: 0.5 }), "Undercast");
console.log("Stage 4 cast integration tests passed.");
