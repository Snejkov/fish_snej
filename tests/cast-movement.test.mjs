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

function makeGame(depth, keys, yaw) {
  const effects = { steps: 0, splashes: 0, groundSnaps: 0 };
  const game = {
    releaseFishingView: SnejFishingGame.prototype.releaseFishingView,
    cast: new SnejCastSystem(),
    pos: new THREE.Vector3(3, -depth + 0.04, 7),
    terrain: { depthAt: () => depth, heightAt: () => -depth, blockedAt: () => false },
    keys: new Set(keys), yaw, pitch: -0.12, settings: { sens: 1 },
    mouse: { dx: 0, dy: 0 }, moveAmt: 1, moveSpeed: 6.8, stepTimer: 1,
    audio: { ready: true, deny() {}, step() { effects.steps += 1; }, waterSplash() {} },
    water: { addSplash() { effects.splashes += 1; } },
    snapToGround() {
      effects.groundSnaps += 1;
      SnejFishingGame.prototype.snapToGround.call(this);
    }
  };
  return { game, effects };
}

for (const fps of [30, 60, 144]) {
  for (const depth of [0, 0.6]) {
    for (const yaw of [0, 1.7, Math.PI]) {
      for (const keys of [["KeyW"], ["KeyS"], ["KeyA"], ["KeyD"], ["KeyW", "KeyD", "ShiftLeft"]]) {
        const { game, effects } = makeGame(depth, keys, yaw);
        const origin = game.pos.clone();
        for (const [fs, retrieving] of [["aim", false], ["charge", false], ["flight", false], ["wait", false], ["flight", true]]) {
          Object.assign(game.cast.state, { fs, retrieving });
          game.moveAmt = 1;
          game.moveSpeed = 6.8;
          game.stepTimer = 1;
          for (let frame = 0; frame < fps; frame += 1) {
            SnejFishingGame.prototype.updateMove.call(game, 1 / fps);
            assert.deepEqual(game.pos.toArray(), origin.toArray(), "A released cast must stop movement immediately without ground snapping.");
            assert.equal(game.moveAmt, 0);
            assert.equal(game.moveSpeed, 0);
            assert.equal(game.stepTimer, 0);
          }
          assert.deepEqual(effects, { steps: 0, splashes: 0, groundSnaps: 0 });
          assert.deepEqual([...game.keys], keys, "Blocking movement must not discard held keys.");
        }
        game.mouse.dx = 20;
        game.mouse.dy = 10;
        SnejFishingGame.prototype.updateLook.call(game);
        assert.notEqual(game.yaw, yaw, "Camera look must remain available while waiting or recovering.");
        assert.notEqual(game.pitch, -0.12);
        game.cast.reset();
        SnejFishingGame.prototype.updateMove.call(game, 1 / fps);
        assert.ok(game.pos.distanceTo(origin) > 0, "Resetting a cast must restore movement on the next frame.");
        assert.ok(game.moveAmt > 0 && game.moveSpeed > 0);
        assert.equal(effects.groundSnaps, 1);
      }
    }
  }
}

for (const fs of ["idle"]) {
  const { game, effects } = makeGame(0.6, ["KeyW", "ShiftRight"], 0);
  game.cast.state.fs = fs;
  const origin = game.pos.clone();
  SnejFishingGame.prototype.updateMove.call(game, 0.1);
  assert.ok(game.pos.distanceTo(origin) > 0, `${fs} must retain normal movement.`);
  assert.equal(effects.steps, 1);
  assert.equal(effects.splashes, 1);
}

console.log("Cast movement lock tests passed.");
