import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejAngler, RETRIEVE_LIFT_ANGLE } = await import("../src/angler.js");
const { SnejCastSystem } = await import("../src/castSystem.js");
const { SnejFloatRig, castLimitsForTip } = await import("../src/floatRig.js");

test("continued LMB raises every pole vertically before the rig reaches the hand", () => {
  for (const fps of [30, 60, 144]) for (const length of [4, 5, 6]) for (const depth of [0, 0.5, 1])
    for (const aspect of [16 / 9, 844 / 390]) {
      const angler = new SnejAngler(), camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 100);
      angler.carry.setLength(length);
      camera.position.set(0, 1.62, 0); camera.lookAt(0, 0, 10);
      const info = { state: "playing", castState: "wait", cameraMode: "first-person", camera, castCamera: camera };
      for (let i = 0; i < fps * 2; i++) angler.update(1 / fps, info);
      const cast = new SnejCastSystem({ rodRange: length * 2, floatDepth: depth });
      const tip = angler.getRodTip(new THREE.Vector3());
      Object.assign(cast.state, { fs: "wait", bobber: { x: 0, y: 0,
        z: castLimitsForTip({ x: 0, z: 0 }, tip, cast.rig.upperLine - 0.02, 0).max } });
      const game = Object.create(Game.prototype);
      Object.assign(game, { cast, angler, castTip: new THREE.Vector3(), settings: { rodSpeed: 2 },
        floatRig: new SnejFloatRig(), canCast: () => true, resetSquint() {}, updateCastControls() {},
        audio: { resume() {}, deny() { throw new Error("Valid lift must not fail."); } }, ui: { showToast() {} },
        floatContext: { playerOrigin: new THREE.Vector3(), surfaceY: () => 0, isWaterAt: () => true },
        lineObstruction: () => false });
      const ctx = { rodTip: tip, retrieveTarget: angler.getRetrieveHand(new THREE.Vector3()), retrieveDepth: depth,
        retrieveClearanceY: () => 0 };
      cast.tick(0, ctx); game.updateFloatRig(1 / fps); assert.ok(game.beginRodLift());
      let caught = false, vertical = false, returned = false, lifted = false;
      for (let i = 0; i < fps * 8; i++) {
        game.updateRodLift(1 / fps);
        ctx.rodTip.copy(angler.getRodTip()); ctx.retrieveTarget.copy(angler.getRetrieveHand());
        ctx.retrieveLiftReady = !(angler.rodReturnWeight > 0) || angler.rodLiftAngle >= RETRIEVE_LIFT_ANGLE - 0.01;
        cast.tick(1 / fps, ctx);
        angler.update(1 / fps, { ...info, castState: cast.state.fs, castRetrieving: cast.state.retrieving,
          rodLiftHeld: game.rodLiftHeld, rodLiftPullsFloat: cast.state.fs === "wait" && game.rodLiftHeld,
          castBobber: cast.state.bobber, castLineLength: cast.state.retrieving
            ? cast.rig.lineLength - cast.state.retrieveDepth : cast.rig.upperLine,
          rodLiftAllowed: candidate => game.canLiftRodTo(candidate) });
        if (cast.state.fs === "wait") game.updateFloatRig(1 / fps);
        if (cast.state.retrieving) {
          lifted ||= cast.state.bobber.y > 0.1;
          vertical ||= angler.rodLiftAngle >= Math.PI / 2 - 0.01;
          assert.ok(angler.getRodTip(tip).distanceTo(cast.state.bobber)
            <= cast.rig.lineLength - cast.state.retrieveDepth + 1e-5, "Full lift cannot stretch the line.");
          if (cast.state.retrieveProgress === 1) {
            caught = true;
            assert.ok(vertical, "The rig cannot be caught before the real pole is vertical.");
            assert.ok(new THREE.Vector3(...Object.values(cast.state.retrieveHook)).distanceTo(ctx.retrieveTarget) < 1e-6);
          }
        }
        assert.equal(cast.rig.lineLength, length);
        if (cast.state.fs === "idle") { returned = true; break; }
      }
      assert.ok(lifted && vertical && caught && returned, `Return did not finish: ${length}m, depth ${depth}, FPS ${fps}`);
      assert.equal(game.rodLiftHeld, false); assert.equal(game.desktopCastHeld, undefined);
    }
});

test("a blocked vertical pose pauses the final catch without jumping or completing on a timer", () => {
  const cast = new SnejCastSystem({ rodRange: 8, floatDepth: 0.5 });
  Object.assign(cast.state, { fs: "wait", bobber: { x: 0, y: 0, z: 6 } });
  const ctx = { rodTip: { x: 0, y: 4, z: 0 }, retrieveTarget: { x: 0, y: 1.2, z: 0 },
    retrieveDepth: 0.5, retrieveLiftReady: false };
  cast.tick(0, ctx); assert.ok(cast.startRetrieve("manual"));
  for (let i = 0; i < 300; i++) cast.tick(1 / 60, ctx);
  assert.equal(cast.state.fs, "flight"); assert.equal(cast.state.retrieveProgress, 0.85);
  const paused = { ...cast.state.bobber }; cast.tick(0, ctx); assert.deepEqual(cast.state.bobber, paused);
  ctx.retrieveLiftReady = true; cast.tick(1 / 60, ctx);
  assert.ok(new THREE.Vector3(...Object.values(cast.state.bobber)).distanceTo(paused) < 0.2);
  for (let i = 0; i < 300 && cast.state.retrieving; i++) cast.tick(1 / 60, ctx);
  assert.equal(cast.state.fs, "idle"); assert.equal(cast.state.retrieving, false);
});
