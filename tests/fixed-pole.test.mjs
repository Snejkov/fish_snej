import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { SnejFloatRig, rigForRod, writeFixedLine } from "../src/floatRig.js";
import { SnejCastSystem } from "../src/castSystem.js";
import { fishingMeters, fishingWorld } from "../src/fishingUnits.js";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejAngler } = await import("../src/angler.js");
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const water = { surfaceY: () => 0, bedY: () => -4, isWaterAt: () => true };
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
function fixture(rod = 4, depth = 0.5, slack = 0) {
  const rig = rigForRod(rod, depth), tip = { x: 0, y: Math.min(1, rig.upperLine / 2), z: 0 };
  const bobber = { x: Math.sqrt((rig.upperLine - slack) ** 2 - tip.y ** 2), y: 0, z: 0 };
  const float = new SnejFloatRig();
  assert.equal(float.follow(1 / 60, tip, bobber, rig, water), true);
  return { rig, tip, bobber, float };
}

test("slack transmits neither pole translation nor a push, including reversals", () => {
  for (const rod of [4, 5, 6]) for (const fps of [30, 60, 144]) {
    const f = fixture(rod, 0.5, 1), start = { ...f.bobber };
    for (let i = 0; i < fps * 2; i++) {
      f.tip.x = Math.sin(i / fps * 4) * 0.3;
      f.tip.z = Math.cos(i / fps * 4) * 0.3;
      assert.equal(f.float.follow(1 / fps, f.tip, f.bobber, f.rig, water), true);
      near(f.bobber.x, start.x); near(f.bobber.z, start.z);
      assert.equal(f.float.tension, 0); assert.ok(f.float.slack > 0.5);
    }
  }
});

test("a taut fixed line pulls immediately at its exact budget, then damps light float inertia", () => {
  for (const rod of [4, 5, 6]) for (const fps of [30, 60, 144]) {
    const f = fixture(rod), start = f.bobber.x;
    f.tip.x -= 0.06;
    f.float.follow(1 / fps, f.tip, f.bobber, f.rig, water);
    assert.ok(start - f.bobber.x >= 0.06 - 1e-6, "No extra length is allowed while the pole moves away.");
    assert.ok(f.float.tension > 0);
    const early = f.bobber.x;
    for (let i = 0; i < fps; i++) f.float.follow(1 / fps, f.tip, f.bobber, f.rig, water);
    assert.ok(f.bobber.x < early, "The light float retains a little water-damped momentum after a pull.");
    assert.ok(distance(f.tip, f.bobber) <= f.rig.upperLine + 1e-6);
    f.tip.x += 0.2;
    const before = f.bobber.x;
    f.float.follow(1 / fps, f.tip, f.bobber, f.rig, water);
    assert.ok(f.bobber.x <= before, "Releasing tension cannot push the float away from the pole.");
    assert.equal(f.float.tension, 0);
  }
});

test("line dynamics are consistent across frame rates and bounded after a stalled frame", () => {
  const results = [];
  for (const fps of [30, 60, 144]) {
    const f = fixture(), start = f.bobber.x;
    for (let i = 1; i <= fps * 3; i++) {
      f.tip.x = -Math.min(i / fps, 1) * 0.4;
      f.float.follow(1 / fps, f.tip, f.bobber, f.rig, water);
      assert.ok(distance(f.tip, f.bobber) <= f.rig.upperLine + 1e-6);
    }
    results.push(f.bobber.x); assert.ok(start - f.bobber.x > 0.35);
  }
  assert.ok(Math.max(...results) - Math.min(...results) < 0.005);
  const a = fixture(), b = fixture(); a.tip.x = b.tip.x = -0.1;
  a.float.follow(10, a.tip, a.bobber, a.rig, water);
  b.float.follow(0.1, b.tip, b.bobber, b.rig, water);
  assert.deepEqual(a.bobber, b.bobber);
});

test("fixed rendering shares the actual float endpoint and retains the total upper and lower budget", () => {
  const f = fixture(), startRange = f.rig.castRange, points = new Float32Array(99);
  f.tip.x = -0.1; f.float.follow(1 / 60, f.tip, f.bobber, f.rig, water);
  const length = f.rig.upperLine;
  assert.equal(writeFixedLine(f.tip, f.bobber, length, points), true);
  let sum = 0;
  for (let i = 3; i < points.length; i += 3) sum += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]);
  near(sum, length, 1e-5); near(points[96], f.bobber.x);
  assert.equal(f.rig.castRange, startRange); assert.equal(f.rig.lineLength, 4);
  const line = count => new THREE.Line(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3)));
  const game = Object.assign(Object.create(Game.prototype), { mode: "playing", time: 0, castTip: new THREE.Vector3(),
    cast: { rig: f.rig, state: { fs: "wait", bobber: f.bobber, waitTime: 0 } }, floatRig: f.float,
    angler: { getRodTip: out => out.copy(f.tip) }, castMesh: new THREE.Object3D(), castLine: line(33), depthLine: line(2) });
  game.updateCastVisuals(); near(game.castMesh.position.x, f.bobber.x);
  near(game.castLine.geometry.attributes.position.getX(32), f.bobber.x);
});

test("pause, automatic pose settling and reset cannot leave stale float momentum", () => {
  const f = fixture(); f.tip.x = -0.06; f.float.follow(1 / 60, f.tip, f.bobber, f.rig, water);
  const snapshot = JSON.stringify([f.bobber, f.float]); f.tip.x -= 0.02;
  for (const dt of [0, -1, NaN]) f.float.follow(dt, f.tip, f.bobber, f.rig, water);
  assert.equal(JSON.stringify([f.bobber, f.float]), snapshot);
  const before = { ...f.bobber }; f.tip.x += 0.1;
  f.float.follow(1 / 60, f.tip, f.bobber, f.rig, water, { settle: true });
  assert.deepEqual(f.bobber, before); assert.deepEqual(f.float.velocity, { x: 0, y: 0, z: 0 });
  f.float.reset(); assert.equal(f.float.anchored, false); assert.equal(f.float.tension, 0);
  assert.deepEqual(f.float.velocity, { x: 0, y: 0, z: 0 });
});

test("surface drag stops at shoreline and obstructions; impossible heights request recovery", () => {
  const f = fixture(), edge = f.bobber.x - 0.02;
  f.tip.x = -0.01;
  for (let i = 0; i < 120; i++) {
    assert.equal(f.float.follow(1 / 120, f.tip, f.bobber, f.rig, { ...water, isWaterAt: p => p.x >= edge }), true);
    assert.ok(f.bobber.x >= edge);
  }
  assert.equal(f.float.follow(1 / 60, f.tip, f.bobber, f.rig, { ...water, lineObstruction: () => "dock" }), false);
  assert.equal(f.float.follow(1 / 60, { ...f.tip, y: 20 }, f.bobber, f.rig, water), false);
  assert.equal(f.float.follow(1 / 60, { ...f.tip, x: NaN }, f.bobber, f.rig, water), false);
  const blocked = fixture(); blocked.tip.x = -0.1;
  assert.equal(blocked.float.follow(1 / 60, blocked.tip, blocked.bobber, blocked.rig,
    { ...water, isWaterAt: p => p.x >= edge }), false,
  "If shore prevents the required pull, recover the rig rather than silently grow the line.");
});

test("displayed pole length is the exact total line, minus configured depth above the float", () => {
  for (const rod of [4, 5, 6]) for (const depth of [0, 0.25, 1, rod - 0.125]) {
    const rig = rigForRod(rod, fishingWorld(depth));
    near(fishingMeters(rig.lineLength), rod);
    near(fishingMeters(rig.upperLine), rod - depth);
    assert.equal(rig.upperLine + rig.floatDepth, rig.lineLength);
  }
});

test("repeated full sideways sweeps never grow the line and only start dragging once slack is consumed", () => {
  for (const rod of [4, 5, 6]) for (const fps of [30, 60, 144]) for (const depth of [0, 0.5, rod - 0.125]) {
    const f = fixture(rod, depth), positions = new Float32Array(99);
    for (let frame = 1; frame <= fps * 3; frame++) {
      const yaw = frame / fps * 2;
      f.tip.x = Math.sin(yaw) * 0.2;
      f.tip.z = Math.cos(yaw) * 0.2 - 0.2;
      assert.equal(f.float.follow(1 / fps, f.tip, f.bobber, f.rig, water), true);
      assert.ok(distance(f.tip, f.bobber) <= f.rig.upperLine + 1e-6);
      assert.equal(writeFixedLine(f.tip, f.bobber, f.rig.upperLine, positions, frame / fps), true);
      let total = f.rig.floatDepth;
      for (let i = 3; i < positions.length; i += 3) total += Math.hypot(positions[i] - positions[i - 3],
        positions[i + 1] - positions[i - 2], positions[i + 2] - positions[i - 1]);
      near(total, f.rig.lineLength, 2e-5);
    }
    const slack = fixture(rod, 0.5, 0.5), before = { ...slack.bobber };
    slack.tip.x -= 0.2; slack.float.follow(1 / fps, slack.tip, slack.bobber, slack.rig, water);
    near(slack.bobber.x, before.x); near(slack.bobber.z, before.z);
    slack.tip.x -= 0.4; slack.float.follow(1 / fps, slack.tip, slack.bobber, slack.rig, water);
    assert.ok(slack.bobber.x < before.x - 0.05);
    assert.ok(distance(slack.tip, slack.bobber) <= slack.rig.upperLine + 1e-6);
  }
});

test("the actual meter-scaled pole consumes slack, then its sideways sweep pulls the landed float", () => {
  for (const rod of [4, 5, 6]) for (const fps of [30, 60, 144]) {
    const angler = new SnejAngler(), camera = new THREE.PerspectiveCamera(70, 2, 0.05, 100);
    angler.carry.setLength(rod); camera.position.set(0, 1.62, 0); camera.lookAt(0, 1.62, 8);
    const cast = new SnejCastSystem({ rodRange: rod * 2, floatDepth: 1 });
    const start = { x: 0, y: 0, z: rod - 1 };
    Object.assign(cast.state, { fs: "wait", bobber: { ...start } });
    const info = { state: "playing", castState: "wait", cameraMode: "first-person", camera, castCamera: camera,
      castBobber: cast.state.bobber, castLineLength: cast.rig.upperLine };
    for (let i = 0; i < fps * 2; i++) angler.update(1 / fps, info);
    const game = Object.assign(Object.create(Game.prototype), { mode: "playing", time: 0, pos: new THREE.Vector3(),
      castTip: new THREE.Vector3(), cast, angler, floatRig: new SnejFloatRig(), floatContext: water,
      audio: { deny() { assert.fail("A valid side sweep cannot retrieve an unreachable rig."); } },
      ui: { showToast() { assert.fail("A valid side sweep cannot force retrieval."); } } });
    game.updateFloatRig(1 / fps);
    assert.deepEqual(cast.state.bobber, start);
    let slackFrames = 0, pullFrames = 0;
    for (let i = 1; i <= fps * 3; i++) {
      const yaw = Math.PI / 2 * i / (fps * 3);
      angler.group.rotation.y = yaw;
      camera.lookAt(Math.sin(yaw) * 8, 1.62, Math.cos(yaw) * 8);
      angler.update(1 / fps, info);
      const tip = angler.getRodTip().clone(), before = { ...cast.state.bobber };
      const span = distance(tip, before);
      game.castAdjusting = true; game.updateFloatRig(1 / fps);
      assert.equal(cast.state.fs, "wait");
      if (pullFrames === 0 && span < cast.rig.upperLine - 1e-6) {
        slackFrames++; assert.deepEqual(cast.state.bobber, start, "Slack cannot copy any visible pole movement.");
      }
      if (span > cast.rig.upperLine + 1e-6) {
        pullFrames++;
        assert.ok(distance(tip, cast.state.bobber) < span, "The actual tip must pull once its distance exhausts the line.");
      }
      assert.ok(distance(tip, cast.state.bobber) <= cast.rig.upperLine + 1e-6);
      const base = new THREE.Vector3(0, -0.1925, 0).applyMatrix4(angler.carry.rod.matrixWorld);
      near(base.distanceTo(tip), rod);
      near(cast.rig.lineLength, base.distanceTo(tip));
    }
    assert.ok(slackFrames > fps / 2); assert.ok(pullFrames > fps / 2);
    assert.ok(Math.hypot(cast.state.bobber.x - start.x, cast.state.bobber.z - start.z) > 0.5,
      "A 90-degree sweep of the real pole must visibly move the float, not leave it on an oversized rope.");
    const points = new Float32Array(99);
    assert.equal(writeFixedLine(angler.getRodTip(), cast.state.bobber, cast.rig.upperLine, points), true);
    let total = cast.rig.floatDepth;
    for (let i = 3; i < points.length; i += 3) total += Math.hypot(points[i] - points[i - 3],
      points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]);
    near(total, rod, 2e-5);
  }
});

test("pole retrieval lifts before the main horizontal swing and preserves the fixed-line budget", () => {
  for (const rod of [4, 5, 6]) for (const fps of [30, 60, 144]) for (const depth of [0, 0.5, 2]) {
    const angler = new SnejAngler(), camera = new THREE.PerspectiveCamera(70, 2, 0.05, 100);
    angler.carry.setLength(rod); camera.position.set(0, 1.62, 0); camera.lookAt(0, 1.62, 8);
    const info = { state: "playing", castState: "wait", cameraMode: "first-person", camera, castCamera: camera };
    for (let i = 0; i < fps; i++) angler.update(1 / fps, info);
    const hand = angler.getRetrieveHand().clone(), tip = angler.getRodTip().clone();
    const cast = new SnejCastSystem({ rodRange: rod * 2, floatDepth: depth });
    const start = { x: tip.x, y: 0, z: tip.z + Math.min(3, cast.rig.upperLine / 2) };
    Object.assign(cast.state, { fs: "wait", bobber: { ...start } });
    const ctx = { retrieveTarget: hand, rodTip: tip, retrieveDepth: depth, retrieveClearanceY: () => 0 };
    cast.tick(0, ctx); assert.equal(cast.startRetrieve("manual"), true);
    let sampled = false, maxLift = 0;
    for (let i = 0; i < fps * 3 && cast.state.retrieving; i++) {
      cast.tick(1 / fps, ctx);
      angler.update(1 / fps, { ...info, castState: cast.state.fs, castRetrieving: cast.state.retrieving,
        castBobber: cast.state.bobber, castLineLength: cast.rig.lineLength - cast.state.retrieveDepth });
      maxLift = Math.max(maxLift, angler.rodLiftAngle);
      if (!sampled && cast.state.retrieveProgress >= 0.16) {
        sampled = true; assert.ok(cast.state.bobber.y > start.y + 0.15);
        assert.ok(Math.abs(cast.state.bobber.z - start.z) < Math.abs(hand.z - start.z) * 0.08);
        assert.ok(angler.rodLiftAngle > 0.25);
      }
      assert.ok(angler.getRetrieveHand().distanceTo(hand) < 0.001);
      assert.ok(angler.getRodTip().distanceTo(new THREE.Vector3().copy(cast.state.bobber)) <= cast.rig.lineLength - cast.state.retrieveDepth + 1e-5);
      ctx.rodTip.copy(angler.getRodTip()); ctx.retrieveTarget.copy(angler.getRetrieveHand());
    }
    assert.ok(sampled); assert.ok(maxLift > 0.9); assert.equal(cast.state.fs, "idle");
    assert.equal(cast.rig.lineLength, rod); assert.equal(cast.rig.floatDepth, depth);
  }
});
