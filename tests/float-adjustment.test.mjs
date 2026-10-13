import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const THREE = await import("three");
const { SnejFishingGame } = await import("../src/game.js");
const { SnejCastSystem } = await import("../src/castSystem.js");
const { SnejFloatRig, rigForRod, FLOAT_RETRIEVE_FRACTION, writeFixedLine } = await import("../src/floatRig.js");
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, message);

function lookGame(fs, sens = 1) {
  return { releaseFishingView: SnejFishingGame.prototype.releaseFishingView,
    cast: { state: { fs } }, settings: { sens, rodSpeed: 1 }, yaw: 0, pitch: 0, mouse: { dx: 0, dy: 0 } };
}

for (const fps of [30, 60, 144]) {
  for (const sens of [0.2, 1, 3]) {
    for (const fs of ["idle", "charge", "flight", "wait"]) {
      const game = lookGame(fs, sens), active = fs === "flight" || fs === "wait";
      game.mouse.dx = 1;
      game.mouse.dy = -0.5;
      SnejFishingGame.prototype.updateLook.call(game, 1 / fps);
      close(game.yaw, -sens * 0.0022 * (active ? 0.06 : 1), "Only released casts reduce sensitivity.");
      close(game.pitch, sens * 0.0011 * (active ? 0.06 : 1));
      assert.equal(game.settings.sens, sens, "Temporary sensitivity must not overwrite saved settings.");
      assert.deepEqual(game.mouse, { dx: 0, dy: 0 });
      assert.equal(game.castAdjusting, active);
      if (!active) continue;
      game.yaw = game.pitch = 0;
      for (let frame = 0; frame < fps; frame += 1) {
        game.mouse.dx = game.mouse.dy = 10000;
        SnejFishingGame.prototype.updateLook.call(game, 1 / fps);
      }
      close(Math.hypot(game.yaw, game.pitch), 0.12, "The combined angular cap must be independent of frame rate.");
      const yaw = game.yaw;
      game.mouse.dx = -1;
      SnejFishingGame.prototype.updateLook.call(game, 1 / fps);
      assert.ok(game.yaw > yaw, "Discarded input must not leave a pending mouse backlog.");
      game.mouse.dx = game.mouse.dy = 100;
      const frozen = [game.yaw, game.pitch];
      SnejFishingGame.prototype.updateLook.call(game, 0);
      assert.deepEqual([game.yaw, game.pitch], frozen);
      assert.equal(game.castAdjusting, false);
      game.cast.state.fs = "idle";
      game.mouse.dx = 10;
      const previous = game.yaw;
      SnejFishingGame.prototype.updateLook.call(game, 1 / fps);
      close(game.yaw - previous, -sens * 0.022, "Clearing a cast restores normal sensitivity immediately.");
    }
  }
}

function floatGame(length, depth = 0.5, reach = length * 2 * 0.4 + 0.03) {
  const rig = rigForRod(length, depth);
  const tip = new THREE.Vector3(0, 0.1, reach - Math.sqrt(rig.upperLine ** 2 - 0.01)), effects = { denied: 0, toasts: [] };
  const game = {
    cast: new SnejCastSystem({ rodRange: length * 2, floatDepth: depth }),
    floatRig: new SnejFloatRig(), castTip: new THREE.Vector3(), pos: new THREE.Vector3(),
    angler: { getRodTip: (out) => out.copy(tip) }, castAdjusting: false,
    floatContext: { playerOrigin: new THREE.Vector3(), surfaceY: () => 0, bedY: () => -0.05, isWaterAt: () => true },
    audio: { deny: () => { effects.denied += 1; } },
    ui: { showToast: (text) => effects.toasts.push(text) }
  };
  Object.assign(game.cast.state, { fs: "wait", bobber: { x: 0, y: 0, z: reach } });
  return { game, tip, effects };
}

for (const length of [4, 5, 6]) {
  for (const fps of [30, 60, 144]) {
    const dt = 1 / fps, rig = rigForRod(length, 0.5);
    const follower = new SnejFloatRig(), tip = { x: 0, y: 0.4, z: 4 }, bobber = { x: 0, y: 0, z: 4 };
    const ctx = { surfaceY: () => 0, isWaterAt: () => true };
    assert.equal(follower.follow(dt, tip, bobber, rig, ctx), true);
    tip.x = -0.06;
    follower.follow(dt, tip, bobber, rig, ctx);
    close(bobber.x, 0, "The float stays put while a sideways correction only changes the slack rope.");
    tip.x = -0.02;
    follower.follow(dt, tip, bobber, rig, ctx);
    close(bobber.x, 0, "A slack reversal cannot push the float.");
    tip.x = 0;
    follower.follow(dt, tip, bobber, rig, ctx);
    close(bobber.x, 0);
    tip.x = 0.01;
    follower.follow(dt, tip, bobber, rig, ctx);
    close(bobber.x, 0);
    tip.x = 1;
    follower.follow(dt, tip, bobber, rig, ctx);
    const previousX = bobber.x;
    tip.x = 0.87;
    follower.follow(dt, tip, bobber, rig, ctx);
    close(bobber.x, previousX, "Unconsumed line slack remains physical, not an artificial backlash counter.");
    const line = new Float32Array(33 * 3);
    assert.equal(writeFixedLine(tip, bobber, rig.upperLine, line), true);
    let sum = 0;
    for (let i = 3; i < line.length; i += 3) sum += Math.hypot(line[i] - line[i - 3], line[i + 1] - line[i - 2], line[i + 2] - line[i - 1]);
    assert.ok(Math.abs(sum - rig.upperLine) < 1e-5, "Reversal cannot stretch the fixed line.");
    follower.reset();
    assert.deepEqual(follower.velocity, { x: 0, y: 0, z: 0 });

    for (const depth of [0, 0.5, length - 0.25]) {
      const { game, tip: modelTip, effects } = floatGame(length, depth);
      const threshold = game.cast.rig.lineLength * FLOAT_RETRIEVE_FRACTION;
      SnejFishingGame.prototype.updateFloatRig.call(game, dt);
      modelTip.z = threshold - Math.sqrt(game.cast.rig.upperLine ** 2 - 0.01);
      game.castAdjusting = true;
      SnejFishingGame.prototype.updateFloatRig.call(game, dt);
      assert.equal(game.cast.state.fs, "wait", "Starting to pull at 40% cannot instantly copy the pole.");
      modelTip.z -= 0.08;
      for (let frame = 0; frame < fps * 2 && game.cast.state.fs === "wait"; frame++) {
        game.castAdjusting = true;
        SnejFishingGame.prototype.updateFloatRig.call(game, dt);
      }
      assert.equal(game.cast.state.fs, "wait", "Pulling a nearby float must not retrieve an empty rig.");
      assert.equal(game.cast.state.retrieving, false);
      assert.equal(game.cast.state.castObstruction, null);
      assert.equal(game.floatRig.anchored, true);
      assert.equal(game.castAdjusting, false);
      assert.equal(effects.denied, 0, "Intentional retrieval is not a failed cast.");
      assert.deepEqual(effects.toasts, []);
      assert.equal(game.cast.startRetrieve("manual"), true, "Only an explicit return retrieves the empty rig.");
      for (let frame = 0; frame < fps * 2; frame += 1) game.cast.tick(dt, { rodTip: modelTip });
      assert.equal(game.cast.state.fs, "idle", "Recovery must finish and unlock movement.");
      assert.equal(game.cast.state.retrieving, false);
      assert.equal(game.cast.state.castObstruction, null);
    }

    const { game, tip: modelTip, effects } = floatGame(length, 0.5, 1);
    game.castAdjusting = true;
    SnejFishingGame.prototype.updateFloatRig.call(game, dt);
    assert.equal(game.cast.state.fs, "wait", "A short landing must not instantly retrieve.");
    modelTip.z -= 0.001;
    SnejFishingGame.prototype.updateFloatRig.call(game, dt);
    assert.equal(game.cast.state.fs, "wait", "Pose settling or view switching is not a player correction.");
    game.castAdjusting = true;
    modelTip.z += 0.02;
    SnejFishingGame.prototype.updateFloatRig.call(game, dt);
    assert.equal(game.cast.state.fs, "wait", "An outward correction must not retrieve a short cast.");
    game.castAdjusting = true;
    modelTip.z -= 0.1;
    SnejFishingGame.prototype.updateFloatRig.call(game, 0);
    assert.equal(game.cast.state.fs, "wait", "Pause and blocking UI must not retrieve.");
    assert.equal(game.castAdjusting, false, "Paused input must not survive into a later adjustment frame.");
    assert.deepEqual(effects, { denied: 0, toasts: [] });
  }
}

for (const fs of ["idle", "charge"]) {
  const cast = new SnejCastSystem();
  cast.state.fs = fs;
  assert.equal(cast.startRetrieve("close"), false);
  assert.equal(cast.state.fs, fs);
}

console.log("Slack-aware float adjustment, reversal, and explicit-only retrieval tests passed.");
