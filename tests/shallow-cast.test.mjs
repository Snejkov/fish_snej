import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { SnejCastSystem } from "../src/castSystem.js";
import { SnejFloatRig, rigForRod, writeFixedLine } from "../src/floatRig.js";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejWater } = await import("../src/water.js");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejAngler } = await import("../src/angler.js");
const angler = new SnejAngler();
const castCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 1800);
for (const rod of [4, 5, 6]) {
  angler.carry.setLength(rod);
  for (const aspect of [16 / 9, 0.45]) for (const yaw of [0, 2.1, 4.8]) for (const pitch of [-1.2, -0.879, 0.2, 1.2]) {
    angler.group.position.set(10, 0.19, -8);
    angler.group.rotation.y = yaw;
    castCamera.aspect = aspect;
    castCamera.position.set(10, 1.81, -8);
    castCamera.lookAt(10 + Math.sin(yaw) * Math.cos(pitch), 1.81 + Math.sin(pitch), -8 + Math.cos(yaw) * Math.cos(pitch));
    const before = angler.skeleton.bones.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
    const predicted = angler.getCastHoldTip(castCamera);
    assert.deepEqual(angler.skeleton.bones.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]), before);
    for (let i = 0; i < 90; i += 1) angler.update(1 / 60, {
      state: "playing", speed: 0, viewBlend: 1, camera: castCamera, castCamera, castState: "wait"
    });
    assert.ok(predicted.distanceTo(angler.getRodTip()) < 1e-8, "Preview must use the same settled horizontal grip as the released rig.");
  }
}
const water = new SnejWater({ quality: "low" }, {});
assert.equal(water.mesh.material.transparent, false);
assert.match(water.mesh.material.vertexShader, /p\.y = 0\.0;/);
for (let i = 0; i < water.mesh.geometry.attributes.position.count; i += 1) {
  assert.ok(Math.abs(water.mesh.geometry.attributes.position.getY(i)) < 1e-8);
}
water.update(100, null, null);
assert.equal(water.mesh.material.uniforms.uTime.value, 0);
for (const [x, z] of [[0, 0], [27, -59], [-113, 70]]) {
  assert.equal(water.waveHeight(x, z), water.surfaceY(x, z));
}

// An intentionally conflicting analytic shore cannot override the visible triangles.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 1, 1).rotateX(-Math.PI / 2));
[-0.1, -0.2, 0.1, 0.2].forEach((y, i) => ground.geometry.attributes.position.setY(i, y));
const world = {
  water, lake: { dockLength: 20, dockWidth: 3 }, castSurfacePoint: new THREE.Vector3(),
  renderedTerrainHeight: Game.prototype.renderedTerrainHeight, castGroundHeight: Game.prototype.castGroundHeight,
  terrain: { groundMesh: ground, heightAt: () => 10, depthAt: () => 0,
    dockLocal: () => ({ along: -100, side: 100 }), obstacles: [] }
};
for (let z = -4.9; z <= 4.9; z += 0.7) {
  for (let x = -4.9; x <= 4.9; x += 0.7) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
    const rendered = ray.intersectObject(ground)[0].point.y;
    assert.ok(Math.abs(world.castGroundHeight(x, z) - rendered) < 1e-8);
    assert.equal(Game.prototype.isCastWater.call(world, x, z), rendered < 0);
    assert.ok(Math.abs(Game.prototype.castMarkerHeight.call(world, { x, z }) - Math.max(0, rendered)) < 1e-8);
  }
}
assert.equal(Game.prototype.isCastWater.call(world, 10000, 0), false);

const ctx = {
  yaw: 0, pitch: -0.2, pos: { x: 0, y: 0.05, z: 0 },
  waterSurfaceY: () => 0, terrainHeightAt: () => -0.01, terrainDepthAt: () => 0.01,
  isWaterAt: (x, z) => z > 0.6, lineObstruction: () => null,
  aimRay: { origin: { x: 0, y: 1.67, z: 0 }, direction: { x: 0, y: -1.67, z: 1 } }
};
for (const rod of [4, 5, 6]) {
  for (const depth of [0.5, 1, 2]) {
    for (const meters of [1, 1.5, 2 * rod - depth]) {
      for (const fps of [30, 60, 144]) {
        const cast = new SnejCastSystem({ rodRange: rod * 2, floatDepth: depth });
        const current = { ...ctx, aimRay: { ...ctx.aimRay, direction: { x: 0, y: -1.67, z: meters } } };
        cast.tick(0, current);
        cast.onActionDown();
        cast.state.charge = meters / cast.castRange;
        cast.tick(0, current);
        assert.equal(cast.state.canRelease, true, `${rod} m rod must allow a ${meters} m shallow cast.`);
        assert.equal(cast.state.targetValid, true);
        assert.equal(cast.onActionUp(), true);
        for (let i = 0; i < 600 && cast.state.fs === "flight"; i += 1) cast.tick(1 / fps, current);
        assert.equal(cast.state.fs, "wait");
        assert.ok(Math.abs(cast.state.castDist - meters) < 0.0001);
        assert.ok(cast.state.castDist <= cast.castRange);
      }
    }
    const rig = rigForRod(rod, depth), follower = new SnejFloatRig();
    for (const bedDepth of [0.005, 0.1, 0.35, 4]) {
      follower.reset();
      const bobber = { x: 0, y: 0, z: rod + rig.upperLine / 2 };
      const tip = { x: 0, y: 0.2, z: rod };
      assert.equal(follower.follow(1 / 60, tip, bobber, rig, {
        surfaceY: () => 0, bedY: () => -bedDepth, isWaterAt: () => true, playerOrigin: ctx.pos
      }), true);
      assert.ok(follower.hook.y >= -bedDepth);
      assert.ok(follower.actualDepth <= depth);
      assert.ok(Math.abs(follower.actualDepth + follower.bottomSlack - depth) < 1e-9);
      const positions = new Float32Array(99);
      assert.equal(writeFixedLine(tip, bobber, rig.upperLine, positions), true);
      let length = 0;
      for (let i = 3; i < positions.length; i += 3) length += Math.hypot(...[0, 1, 2].map((j) => positions[i + j] - positions[i + j - 3]));
      assert.ok(Math.abs(length + follower.actualDepth + follower.bottomSlack - rod) < 0.00003);
      assert.equal(rig.castRange, rod * 2 - depth, "Bottom contact never increases the configured range.");
    }
  }
}

// Preview validation must update on every charge frame, in both meter directions.
for (const fps of [30, 60, 144]) {
  const cast = new SnejCastSystem({ rodRange: 8, floatDepth: 0.5 });
  const current = { ...ctx, aimRay: { ...ctx.aimRay, direction: { x: 0, y: -1.67, z: 3 } } };
  cast.tick(0, current);
  cast.onActionDown();
  for (let frame = 0; frame < fps * 5; frame += 1) {
    current.lineObstruction = () => frame % 2 ? "dock" : null;
    cast.tick(1 / fps, current);
    assert.equal(cast.state.releaseBlock, cast.state.requestedDist < cast.state.minCastDist - 1e-8 ? "range" : frame % 2 ? "dock" : null);
    assert.equal(cast.state.targetValid, frame % 2 === 0);
    assert.equal(cast.state.canRelease, !cast.state.releaseBlock);
  }
  current.lineObstruction = () => "rock";
  cast.state.charge = 0.5;
  cast.tick(0, current);
  assert.equal(cast.state.canRelease, false);
  assert.equal(cast.onActionUp(), false);
  assert.equal(cast.state.lastRejection, "rock");
  current.lineObstruction = () => null;
  cast.tick(0, current);
  assert.equal(cast.onActionDown(), true);
  cast.state.charge = 0.5;
  cast.tick(0, current);
  assert.equal(cast.state.canRelease, true);
  assert.equal(cast.onActionUp(), true, "Rejection must not latch a following valid attempt.");
}
water.mesh.geometry.dispose();
water.mesh.material.dispose();
ground.geometry.dispose();
ground.material.dispose();
console.log("Shallow cast, shared water surface, and live preview tests passed.");
