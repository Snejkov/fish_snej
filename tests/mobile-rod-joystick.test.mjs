import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { ROD_JOYSTICK_SPEED, rodJoystickDelta } from "../src/mobileInput.js";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejFloatRig, rigForRod } = await import("../src/floatRig.js");
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test("Fine rod response is analog, smooth and identical at 30/60/144 FPS", () => {
  for (const axes of [{ mx: 1, mz: 0 }, { mx: 0, mz: 0.5 }, { mx: 1, mz: 1 }]) {
    let reference;
    for (const fps of [30, 60, 144]) {
      const velocity = { mx: 0, mz: 0 }, sum = { dx: 0, dy: 0 };
      for (let frame = 0; frame < fps; frame++) {
        const delta = rodJoystickDelta(axes, velocity, 1 / fps);
        assert.ok(Math.hypot(delta.dx, delta.dy) <= ROD_JOYSTICK_SPEED / fps);
        sum.dx += delta.dx; sum.dy += delta.dy;
      }
      if (reference) { near(sum.dx, reference.dx); near(sum.dy, reference.dy); }
      reference = sum;
      near(Math.hypot(sum.dx, sum.dy), Math.min(1, Math.hypot(axes.mx, axes.mz))
        * ROD_JOYSTICK_SPEED * (1 - (1 - Math.exp(-10)) / 10));
    }
  }
});

test("Neutral, invalid and paused input stop instantly without inertia", () => {
  for (const [axes, dt] of [[{}, 0.05], [{ mx: NaN, mz: Infinity }, 0.05], [{ mx: 1 }, 0], [{ mx: 1 }, -1], [{ mx: 1 }, NaN]]) {
    const velocity = { mx: 0.035, mz: -0.02 };
    assert.deepEqual(rodJoystickDelta(axes, velocity, dt), { dx: 0, dy: 0 });
    assert.deepEqual(velocity, { mx: 0, mz: 0 });
  }
  const delta = rodJoystickDelta({ mx: 1 }, { mx: 0, mz: 0 }, 10);
  assert.ok(delta.dx <= ROD_JOYSTICK_SPEED * 0.1, "A stalled frame cannot create a large correction.");
});

function gameFixture({ enabled = true, view = "first-person", fs = "wait", retrieving = false, sens = 1 } = {}) {
  const game = Object.create(Game.prototype), velocity = { mx: 0, mz: 0 }, calls = [];
  Object.assign(game, {
    yaw: 0, pitch: 0, cameraMode: view, settings: { sens }, mouse: { dx: 0, dy: 0 },
    cast: { state: { fs, retrieving } }, pos: new THREE.Vector3(1, 2, 3),
    terrain: {}, moveAmt: 1, moveSpeed: 4, stepTimer: 1,
    mobileInput: { enabled, setStickMode: mode => calls.push(mode),
      takeLook: () => ({ dx: 0, dy: 0 }),
      rodLook: dt => rodJoystickDelta({ mx: 0.5, mz: 0.5 }, velocity, dt) }
  });
  return { game, calls };
}

test("Only mobile first-person landed casts route the joystick to the rod", () => {
  for (const enabled of [true, false]) for (const view of ["first-person", "third-person"])
    for (const fs of ["idle", "aim", "charge", "flight", "wait"]) for (const retrieving of [true, false]) {
      const { game, calls } = gameFixture({ enabled, view, fs, retrieving });
      game.updateLook(1 / 60);
      const expected = enabled && view === "first-person" && fs === "wait" && !retrieving;
      assert.deepEqual(calls, [expected ? "rod" : "move"]);
      assert.equal(game.castAdjusting, expected);
      if (expected) {
        assert.ok(game.yaw < 0 && game.pitch > 0);
        const origin = game.pos.clone(); game.updateMove(1 / 60);
        assert.deepEqual(game.pos, origin, "Fine rod adjustment never translates the player.");
        assert.equal(game.moveSpeed, 0);
      } else assert.deepEqual([game.yaw, game.pitch], [0, 0]);
    }
});

test("Rod sensitivity is independent of saved camera sensitivity and shares the combined cap", () => {
  let reference;
  for (const sens of [0.2, 1, 5]) {
    const { game } = gameFixture({ sens });
    for (let i = 0; i < 60; i++) game.updateLook(1 / 60);
    if (reference) near(game.yaw, reference);
    reference = game.yaw;
    assert.equal(game.settings.sens, sens);
    const before = [game.yaw, game.pitch];
    game.mouse.dx = game.mouse.dy = 10000; game.updateLook(1 / 60);
    near(Math.hypot(game.yaw - before[0], game.pitch - before[1]), 0.12 / 60);
  }
});

test("Post-cast analog and mouse response are exactly twice the prior rates, not just a higher cap", () => {
  assert.equal(ROD_JOYSTICK_SPEED, 0.07);
  for (const fps of [30, 60, 144]) {
    const velocity = { mx: 0, mz: 0 };
    let sum = 0;
    for (let i = 0; i < fps; i++) sum += rodJoystickDelta({ mx: 0.5, mz: 0 }, velocity, 1 / fps).dx;
    const previous = 0.5 * 0.035 * (1 - (1 - Math.exp(-10)) / 10);
    near(sum, previous * 2);
    for (const enabled of [false, true]) for (const fs of ["idle", "aim", "charge", "flight", "wait"]) {
      const { game } = gameFixture({ enabled, fs });
      game.mobileInput.rodLook = () => ({ dx: 0, dy: 0 });
      game.mouse.dx = 1;
      game.updateLook(1 / fps);
      near(-game.yaw, 0.0022 * (["flight", "wait"].includes(fs) ? 0.03 * 2 : 1));
      if (["flight", "wait"].includes(fs)) {
        const before = game.yaw;
        game.mouse.dx = 10000;
        game.updateLook(1 / fps);
        near(before - game.yaw, 0.06 * 2 / fps);
      }
    }
  }
});

test("Joystick corrections consume slack without teleporting the float or changing the line budget", () => {
  const { game } = gameFixture(), rig = rigForRod(4, 0.5), follower = new SnejFloatRig();
  const tip = { x: 0, y: 0.1, z: 5 }, bobber = { x: 0, y: 0, z: 5 };
  const context = { surfaceY: () => 0, isWaterAt: () => true };
  follower.follow(1 / 60, tip, bobber, rig, context);
  for (let i = 0; i < 60; i++) {
    game.updateLook(1 / 60);
    assert.equal(game.castAdjusting, true);
    tip.x = Math.sin(game.yaw) * 5;
    tip.z = Math.cos(game.yaw) * 5;
    const previous = { ...bobber };
    assert.equal(follower.follow(1 / 60, tip, bobber, rig, context), true);
    assert.ok(Math.hypot(bobber.x - previous.x, bobber.z - previous.z) < 0.01);
    assert.ok(Math.hypot(bobber.x - tip.x, bobber.y - tip.y, bobber.z - tip.z) <= rig.upperLine);
  }
  assert.equal(bobber.x, 0, "A slack rope cannot transmit a sideways push to the float.");
  assert.ok(follower.slack > 7);
});
