import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { castLimitsForTip, rigForRod, SnejFloatRig, writeFixedLine } from "../src/floatRig.js";
import { SnejCastSystem } from "../src/castSystem.js";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejAngler } = await import("../src/angler.js");
const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const water = { surfaceY: () => 0, isWaterAt: () => true };

test("water reach includes the actual pole tip, its height and lateral offset, without stretching the line", () => {
  const player = { x: 10, z: -8 }, tip = { x: 10.2, y: 1, z: -4 };
  const limits = castLimitsForTip(player, tip, 3, 0, 0, 7);
  near(limits.max, 4 + Math.sqrt(9 - 1 - 0.04));
  near(limits.min, 4 - Math.sqrt(9 - 1 - 0.04));
  near(span(tip, { x: player.x, y: 0, z: player.z + limits.max }), 3);
  assert.deepEqual(castLimitsForTip(player, { ...tip, y: 4 }, 3, 0), { min: 0, max: 0 });
  assert.deepEqual(castLimitsForTip(player, { ...tip, x: NaN }, 3, 0), { min: 0, max: 0 });
  for (const length of [4, 5, 6]) {
    const rig = rigForRod(length, 1);
    assert.equal(rig.castRange, length * 2 - 1);
    assert.equal(rig.lineLength, length);
  }
});

function fixture(length, depth, yaw, aspect) {
  const angler = new SnejAngler(), camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 100);
  const pos = new THREE.Vector3(10, 0.04, -8), pitch = -0.35;
  angler.carry.setLength(length); angler.group.position.copy(pos); angler.group.rotation.y = yaw;
  camera.position.copy(pos).add(new THREE.Vector3(0, 1.62, 0));
  camera.lookAt(pos.x + Math.sin(yaw) * 8, camera.position.y + Math.sin(pitch) * 8, pos.z + Math.cos(yaw) * 8);
  const tip = angler.getCastHoldTip(camera, new THREE.Vector3(), yaw).clone();
  const ctx = { holdCast: true, cameraAim: true, strictTarget: true, yaw, pitch, pos,
    aimRay: { origin: camera.position, direction: new THREE.Vector3(Math.sin(yaw), -0.2, Math.cos(yaw)).normalize() },
    rodTip: tip, rodTipForYaw: angle => angler.getCastHoldTip(camera, new THREE.Vector3(), angle),
    waterSurfaceY: () => 0, terrainHeightAt: () => -4, terrainDepthAt: () => 4, isWaterAt: () => true };
  const cast = new SnejCastSystem({ rodRange: length * 2, floatDepth: depth,
    getCastOrigin: () => angler.getCastOrigin(new THREE.Vector3(), cast.state.aimYaw) });
  cast.tick(0, ctx); cast.onActionDown();
  return { cast, ctx, tip };
}

test("100 percent reaches beyond the visible tip; 50 percent lands closer with real slack on every device", () => {
  for (const length of [4, 5, 6]) for (const depth of [0, 0.5, 1])
    for (const yaw of [0, 0.9, 2.8]) for (const aspect of [16 / 9, 844 / 390, 390 / 844])
      for (const power of [0.5, 0.9, 1]) for (const fps of [30, 60, 144]) {
        const { cast, ctx, tip } = fixture(length, depth, yaw, aspect);
        cast.state.charge = power; cast.tick(0, ctx);
        const target = { ...cast.state.aimPoint }, range = cast.castRange;
        assert.ok(range > length + 2 && range <= length * 2 - depth);
        assert.equal(cast.state.canRelease, true); assert.equal(cast.onActionUp(), true);
        for (let i = 0; i < fps * 10 && cast.state.fs === "flight"; i++) cast.tick(1 / fps, ctx);
        assert.equal(cast.state.fs, "wait");
        near(cast.state.castDist, range * power);
        near(span(target, cast.state.bobber), 0);
        assert.ok(span(tip, cast.state.bobber) <= cast.rig.upperLine + 1e-6);
        const follower = new SnejFloatRig();
        assert.equal(follower.follow(1 / fps, tip, cast.state.bobber, cast.rig, water), true);
        if (power === 0.5) assert.ok(follower.slack > 1, "Half strength keeps excess fixed line, not an invisible shorter rig.");
        if (power === 1) {
          const forward = (tip.x - ctx.pos.x) * Math.sin(yaw) + (tip.z - ctx.pos.z) * Math.cos(yaw);
          assert.ok(cast.state.castDist - forward > 2, "The float must land out beyond the rod, not underneath its tip.");
        }
        const points = new Float32Array(99);
        assert.equal(writeFixedLine(tip, cast.state.bobber, cast.rig.upperLine, points), true);
        let total = depth;
        for (let i = 3; i < points.length; i += 3) total += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]);
        near(total, length, 3e-5);
      }
});

test("pulling the pole brings a fully extended float closer; a short cast first consumes slack", () => {
  for (const power of [0.5, 1]) for (const fps of [30, 60, 144]) {
    const { cast, ctx, tip } = fixture(4, 1, 0, 16 / 9);
    cast.state.charge = power; cast.tick(0, ctx); assert.equal(cast.onActionUp(), true);
    for (let i = 0; i < fps * 10 && cast.state.fs === "flight"; i++) cast.tick(1 / fps, ctx);
    const float = new SnejFloatRig(), bobber = cast.state.bobber;
    assert.equal(float.follow(1 / fps, tip, bobber, cast.rig, water), true);
    const before = { ...bobber }; tip.z -= 0.15;
    assert.equal(float.follow(1 / fps, tip, bobber, cast.rig, water), true);
    if (power === 1) assert.ok(bobber.z < before.z - 0.1);
    else assert.deepEqual(bobber, before);
    assert.ok(span(tip, bobber) <= cast.rig.upperLine + 1e-6);
    assert.equal(cast.rig.lineLength, 4, "Moving a fixed-line pole never reels or permanently shortens its line.");
  }
});

test("an impossible high-tip pose cannot cast by using the body-origin range alone", () => {
  const { cast, ctx } = fixture(4, 1, 0, 16 / 9);
  ctx.rodTipForYaw = () => ({ x: ctx.pos.x, y: 4, z: ctx.pos.z + 4 });
  cast.state.charge = 1; cast.tick(0, ctx);
  assert.equal(cast.onActionUp(), false);
  assert.equal(cast.state.fs, "idle");
});
