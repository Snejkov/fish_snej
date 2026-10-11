import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { SnejFloatRig, rigForRod, writeFixedLine } from "../src/floatRig.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const THREE = await import("three");
const { SnejAngler } = await import("../src/angler.js");
const context = { surfaceY: () => 0, isWaterAt: () => true, lineObstruction: () => null, playerOrigin: { x: 0, z: 0 } };
const polylineLength = (points) => {
  let sum = 0;
  for (let i = 3; i < points.length; i += 3) {
    sum += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]);
  }
  return sum;
};

for (const length of [4, 5, 6]) {
  for (const fps of [30, 60, 144]) {
    const angler = new SnejAngler();
    angler.carry.setLength(length);
    const yaw = fps === 30 ? 0 : fps === 60 ? 1.7 : Math.PI;
    const pitch = fps === 30 ? -0.9 : fps === 60 ? 0.2 : 0.9;
    angler.group.rotation.y = yaw;
    angler.heading = 0.6;
    const camera = new THREE.PerspectiveCamera(70, fps === 144 ? 390 / 844 : 16 / 9, 0.05, 1800);
    const castCamera = camera.clone();
    const rig = rigForRod(length, 0.5), float = new SnejFloatRig();
    const line = new Float32Array(99);
    const eye = new THREE.Vector3(0, 1.62, 0);
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const look = forward.clone().multiplyScalar(Math.cos(pitch));
    look.y = Math.sin(pitch);
    const back = forward.clone().multiplyScalar(-Math.cos(pitch));
    back.y = 0.35 - Math.sin(pitch) * 0.6;
    const thirdPosition = eye.clone().addScaledVector(back.normalize(), 4.6);
    castCamera.position.copy(eye);
    castCamera.lookAt(eye.clone().addScaledVector(look, 8));
    const frame = (viewBlend, dt = 1 / fps) => {
      camera.position.copy(eye).lerp(thirdPosition, viewBlend);
      camera.lookAt(eye.clone().addScaledVector(look, 8).lerp(eye, viewBlend));
      angler.update(dt, { state: "playing", speed: 0, camera, castCamera, viewBlend, castState: "wait" });
    };
    for (let i = 0; i < fps * 2; i += 1) frame(1);
    const tip = angler.getRodTip();
    const bobber = { x: tip.x + forward.x * rig.upperLine * 0.65, y: 0, z: tip.z + forward.z * rig.upperLine * 0.65 };
    assert.equal(float.follow(1 / fps, tip, bobber, rig, context), true);
    const initial = { ...bobber }, initialTip = tip.clone();
    const identities = [angler.carry.rod.uuid, angler.carry.tip.uuid, angler.bones.RightHand.uuid];
    const binds = angler.skeleton.boneInverses.map((matrix) => matrix.toArray());
    const stableFloat = () => {
      const currentTip = angler.getRodTip();
      assert.ok(currentTip.distanceTo(initialTip) < 1e-6, "Camera switches must not move the physical rod tip.");
      assert.equal(float.follow(1 / fps, currentTip, bobber, rig, context), true, "View changes must not request line recovery.");
      assert.ok(Math.hypot(bobber.x - initial.x, bobber.z - initial.z) < 1e-6, "Switching views must leave the float at its water position.");
      assert.equal(writeFixedLine(currentTip, bobber, rig.upperLine, line), true);
      assert.ok(Math.abs(polylineLength(line) + rig.floatDepth - length) < 0.00003);
      assert.deepEqual([angler.carry.rod.uuid, angler.carry.tip.uuid, angler.bones.RightHand.uuid], identities);
      assert.deepEqual(angler.skeleton.boneInverses.map((matrix) => matrix.toArray()), binds);
    };
    for (let cycle = 0; cycle < 5; cycle += 1) {
      for (const destination of [0, 1]) {
        const frames = Math.ceil(fps * 0.18);
        for (let i = 1; i <= frames; i += 1) {
          const t = i / frames, smooth = t * t * (3 - 2 * t);
          frame(destination === 0 ? 1 - smooth : smooth);
          stableFloat();
        }
        if (destination === 0) {
          const hand = angler.bones.RightHand.getWorldPosition(new THREE.Vector3()).project(camera);
          assert.ok(hand.x > 0 && hand.x < 0.95 && Math.abs(hand.y) < 0.95, "The same held hand must remain visible in first person.");
        }
      }
    }
    for (const interrupted of [0.2, 0.8, 0.1, 0.6, 0, 1]) {
      frame(interrupted);
      stableFloat();
    }
    const frozen = angler.getRodTip();
    frame(1, 0);
    assert.ok(angler.getRodTip().distanceTo(frozen) < 1e-10);

    castCamera.position.x += 0.2;
    castCamera.lookAt(new THREE.Vector3(0.2, 1.62, 0).addScaledVector(look, 8));
    frame(1);
    assert.equal(float.follow(1 / fps, angler.getRodTip(), bobber, rig, context), true);
    assert.ok(bobber.x > initial.x + 0.19, "Actual rod movement must still adjust the float.");
  }
}
console.log("Cast view-switch stability tests passed.");
