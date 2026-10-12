import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejCastSystem } = await import("../src/castSystem.js");
const flush = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };
function fixture(hold = false) {
  let approve, rejectLanding;
  const cancelled = [], landed = [], errors = [];
  const game = Object.create(Game.prototype);
  const ctx = { strictTarget: true, holdCast: hold, castHeading: 0, pos: { x: 0, y: 0.04, z: 0 }, yaw: 0, pitch: -0.4,
    waterSurfaceY: () => 0, terrainHeightAt: () => -3, terrainDepthAt: () => 3, isWaterAt: () => true };
  Object.assign(game, { cast: new SnejCastSystem({ rodRange: 8, floatDepth: 0.5 }), castEpoch: 1,
    cameraMode: "third-person", settings: { floatDepth: 0.5 }, keys: new Set(), mouse: { dx: 0, dy: 0 },
    inventory: { serialize: () => ({ equipped: {}, clothing: {}, loadouts: [] }),
      state: { equipped: { bait: "bait.earthworm" } }, countOf: () => 10 },
    audio: { cast() {}, deny() {}, splash() {} }, canCast: () => true,
    ui: { showToast() {}, refreshInventory() {}, refreshProfile() {} }, handleAccountError: error => errors.push(error),
    updateCast: (dt = 0) => game.cast.tick(dt, { ...ctx, holdPaused: Boolean(game.castApproval) }), updateCastVisuals() {}, updateCamera() {},
    toggleView() { this.cameraMode = "first-person"; }, save() {}, stats: { recordCast() {} },
    angler: { group: { position: { copy() {} }, rotation: {} }, getRodTip: () => ({ x: 0, y: 1.4, z: 0 }) },
    pos: ctx.pos, yaw: 0, pitch: -0.4, castContext: ctx, floatDepthInput: {},
    castMeter: { classList: { toggle() {} } }, aimMarker: {},
    water: { particles: { children: [] }, addSplash() {}, addRipple() {} }, castMarkerHeight: () => 0,
    server: { enabled: true, save: async () => {}, beginCast: () => new Promise(resolve => { approve = resolve; }),
      cancelCast: async id => { cancelled.push(id); }, landCast: (id, value) => {
        landed.push({ id, value }); return new Promise((resolve, reject) => { rejectLanding = reject; });
      } }
  });
  game.cast.tick(0, ctx);
  if (hold) { game.cast.onActionDown(); game.holdCasting = true; game.castHeading = 0; game.updateCast(1.5); }
  else { game.cast.beginTargeting(); game.cast.selectTarget({ x: 0, z: 5 }); }
  return { game, ctx, cancelled, landed, errors, approve: value => approve(value), rejectLanding: () => rejectLanding(new Error("Old failure")) };
}

test("online hold release freezes power and forward target while awaiting approval", async () => {
  const original = globalThis.document; globalThis.document = {};
  try {
    const f = fixture(true), power = f.game.cast.state.charge;
    const preview = { ...f.game.cast.state.predictedLanding };
    assert.ok(f.game.endHoldCast()); await flush();
    assert.equal(f.game.holdCasting, false);
    f.game.updateCast(8);
    assert.equal(f.game.cast.state.charge, power);
    assert.deepEqual(f.game.cast.state.predictedLanding, preview);
    assert.equal(f.game.cameraMode, "third-person");
    assert.deepEqual(f.game.castApproval.target, { x: preview.x, y: preview.y, z: preview.z });
    f.approve({ castId: "held_approval_001" }); await flush();
    assert.equal(f.game.cast.state.fs, "flight");
    assert.equal(f.game.cast.state.castPower, power);
    assert.equal(f.game.cameraMode, "first-person");
  } finally { globalThis.document = original; }
});

test("online release waits for server approval; cancelled/late approval never launches or changes the camera", async () => {
  const original = globalThis.document; globalThis.document = {};
  try {
    const f = fixture();
    assert.equal(f.game.endCastAction(), true); await flush();
    assert.equal(f.game.cast.state.fs, "charge"); assert.equal(f.game.cameraMode, "third-person");
    f.game.cancelCastAction(); f.approve({ castId: "cancelled_001" }); await flush();
    assert.equal(f.game.cast.state.fs, "idle"); assert.deepEqual(f.cancelled, ["cancelled_001"]);
    assert.equal(f.game.cameraMode, "third-person"); assert.deepEqual(f.landed, []);
    const accepted = fixture(); accepted.game.endCastAction(); await flush();
    accepted.approve({ castId: "accepted_001" }); await flush();
    assert.equal(accepted.game.cast.state.fs, "flight"); assert.equal(accepted.game.cameraMode, "first-person");
    assert.equal(accepted.game.activeServerCast.castId, "accepted_001");
  } finally { globalThis.document = original; }
});

test("actual landing travels to server once; an older failed response cannot retrieve a newer cast", async () => {
  const original = globalThis.window; globalThis.window = {};
  try {
    const f = fixture(); f.game.endCastAction(); await flush(); f.approve({ castId: "landing_0001" }); await flush();
    for (let frame = 0; frame < 600 && f.game.cast.state.fs === "flight"; frame += 1) Game.prototype.updateCast.call(f.game, 1 / 60);
    assert.equal(f.game.cast.state.fs, "wait"); assert.equal(f.landed.length, 1);
    assert.equal(f.landed[0].id, "landing_0001");
    assert.ok(Math.hypot(f.landed[0].value.x, f.landed[0].value.z - 5) < 0.00001);
    Game.prototype.updateCast.call(f.game, 1 / 60); assert.equal(f.landed.length, 1);
    const sameState = f.game.cast.state; f.game.cast.reset(); f.game.cast.state.fs = "wait"; f.game.castEpoch += 1;
    assert.equal(f.game.cast.state, sameState, "Reset really reuses the state object.");
    f.rejectLanding(); await flush();
    assert.equal(f.game.cast.state.fs, "wait"); assert.equal(f.game.cast.state.retrieving, false);
    assert.equal(f.errors.length, 1);
  } finally { globalThis.window = original; }
});
