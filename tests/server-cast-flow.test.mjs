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
  let rejectLanding, resolveLanding;
  const cancelled = [], landed = [], errors = [], starts = [], recorded = [], sounds = [];
  const game = Object.create(Game.prototype);
  const ctx = { strictTarget: true, holdCast: hold, castHeading: 0, pos: { x: 0, y: 0.04, z: 0 }, yaw: 0, pitch: -0.4,
    waterSurfaceY: () => 0, terrainHeightAt: () => -3, terrainDepthAt: () => 3, isWaterAt: () => true };
  Object.assign(game, { cast: new SnejCastSystem({ rodRange: 8, floatDepth: 0.5 }), castEpoch: 1,
    cameraMode: "third-person", settings: { floatDepth: 0.5 }, keys: new Set(), mouse: { dx: 0, dy: 0 },
    inventory: { serialize: () => ({ equipped: {}, clothing: {}, loadouts: [] }),
      state: { equipped: { bait: "bait.earthworm" } }, countOf: () => 10 },
    audio: { cast() { sounds.push("cast"); }, deny() {}, splash() {} }, canCast: () => true,
    ui: { showToast() {}, refreshInventory() {}, refreshProfile() {} }, handleAccountError: error => errors.push(error),
    updateCast: (dt = 0) => game.cast.tick(dt, { ...ctx, holdPaused: Boolean(game.castApproval) }), updateCastVisuals() {}, updateCamera() {},
    toggleView() { this.cameraMode = "first-person"; }, save() {}, stats: { recordCast: value => recorded.push(value) },
    angler: { group: { position: { copy() {} }, rotation: {} }, getRodTip: () => ({ x: 0, y: 1.4, z: 0 }) },
    pos: ctx.pos, yaw: 0, pitch: -0.4, castContext: ctx, floatDepthInput: {},
    castMeter: { classList: { toggle() {} } }, aimMarker: {},
    water: { particles: { children: [] }, addSplash() {}, addRipple() {} }, castMarkerHeight: () => 0,
    server: { enabled: true, save: async () => {}, beginCast: target => new Promise((resolve, reject) => { starts.push({ target, resolve, reject }); }),
      cancelCast: async id => { cancelled.push(id); }, landCast: (id, value) => {
        landed.push({ id, value }); return new Promise((resolve, reject) => { resolveLanding = resolve; rejectLanding = reject; });
      } }
  });
  game.cast.tick(0, ctx);
  if (hold) { game.cast.onActionDown(); game.holdCasting = true; game.castHeading = 0; game.updateCast(1.5); }
  else { game.cast.beginTargeting(); game.cast.selectTarget({ x: 0, z: 5 }); }
  return { game, ctx, cancelled, landed, errors, starts, recorded, sounds,
    approve: (value, index = starts.length - 1) => starts[index].resolve(value),
    rejectStart: (index = starts.length - 1) => starts[index].reject(new Error("Server denied cast")),
    resolveLanding: () => resolveLanding({ applied: true }), rejectLanding: () => rejectLanding(new Error("Old failure")) };
}

const ageApproval = f => { f.game.predictedServerCast.receivedAt -= 100; f.game.confirmPredictedLanding(f.game.predictedServerCast); };
const flyToWater = f => {
  for (let frame = 0; frame < 600 && f.game.cast.state.fs === "flight"; frame += 1) Game.prototype.updateCast.call(f.game, 1 / 60);
  assert.equal(f.game.cast.state.fs, "wait");
};

test("online held release launches immediately and keeps frozen power and circle while approval is pending", async () => {
  const original = globalThis.document; globalThis.document = {};
  try {
    const f = fixture(true), power = f.game.cast.state.charge;
    const preview = { ...f.game.cast.state.predictedLanding };
    assert.ok(f.game.endHoldCast());
    assert.equal(f.game.cast.state.fs, "flight", "Release cannot wait for even the first network microtask.");
    await flush();
    assert.equal(f.game.holdCasting, false);
    f.game.updateCast(1 / 60);
    assert.equal(f.game.cast.state.charge, power);
    assert.deepEqual(f.game.cast.state.predictedLanding, preview);
    assert.equal(f.game.cameraMode, "first-person");
    assert.deepEqual(f.game.castApproval.target, { x: preview.x, y: preview.y, z: preview.z });
    f.approve({ castId: "held_approval_001" }); await flush();
    assert.equal(f.game.cast.state.fs, "flight");
    assert.equal(f.game.cast.state.castPower, power);
    assert.equal(f.game.cameraMode, "first-person");
    assert.deepEqual(f.sounds, ["cast"]);
    assert.deepEqual(f.recorded, []);
    f.game.cancelCastAction();
  } finally { globalThis.document = original; }
});

test("online direct release starts immediately; cancelled late approval never revives or relaunches the cast", async () => {
  const original = globalThis.document; globalThis.document = {};
  try {
    const f = fixture();
    assert.equal(f.game.endCastAction(), true);
    assert.equal(f.game.cast.state.fs, "flight"); assert.equal(f.game.cameraMode, "first-person");
    await flush();
    f.game.cancelCastAction(); f.approve({ castId: "cancelled_001" }); await flush();
    assert.equal(f.game.cast.state.fs, "idle"); assert.deepEqual(f.cancelled, ["cancelled_001"]);
    assert.equal(f.game.cameraMode, "first-person"); assert.deepEqual(f.landed, []);
    const accepted = fixture(); accepted.game.endCastAction(); await flush();
    accepted.approve({ castId: "accepted_001" }); await flush();
    assert.equal(accepted.game.cast.state.fs, "flight"); assert.equal(accepted.game.cameraMode, "first-person");
    assert.equal(accepted.game.activeServerCast.castId, "accepted_001");
    assert.deepEqual(accepted.sounds, ["cast"]);
    accepted.game.cancelCastAction();
  } finally { globalThis.document = original; }
});

test("actual landing travels to server once; an older failed response cannot retrieve a newer cast", async () => {
  const original = globalThis.window; globalThis.window = {};
  try {
    const f = fixture(); f.game.endCastAction(); await flush(); f.approve({ castId: "landing_0001" }); await flush(); ageApproval(f);
    flyToWater(f);
    assert.equal(f.game.cast.state.fs, "wait"); assert.equal(f.landed.length, 1);
    assert.equal(f.game.retrieveCast(), false, "Retrieval waits for the authoritative landing result.");
    assert.equal(f.landed[0].id, "landing_0001");
    assert.ok(Math.hypot(f.landed[0].value.x, f.landed[0].value.z - 5) < 0.00001);
    Game.prototype.updateCast.call(f.game, 1 / 60); assert.equal(f.landed.length, 1);
    const sameState = f.game.cast.state; f.game.cast.reset(); f.game.cast.state.fs = "wait"; f.game.castEpoch += 1;
    assert.equal(f.game.cast.state, sameState, "Reset really reuses the state object.");
    f.rejectLanding(); await flush();
    assert.equal(f.game.cast.state.fs, "wait"); assert.equal(f.game.cast.state.retrieving, false);
    assert.equal(f.errors.length, 0, "An obsolete failure cannot disrupt a newer cast or session.");
    assert.equal(f.game.castLanding, null);
  } finally { globalThis.window = original; }
});

test("a visual landing before approval waits for the minimum server age and reports the captured point once", async () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    const f = fixture(); f.game.endCastAction(); await flush(); flyToWater(f);
    const point = { ...f.game.cast.state.bobber };
    assert.equal(f.landed.length, 0); assert.deepEqual(f.recorded, []);
    assert.equal(f.game.retrieveCast(), false); assert.equal(f.game.beginRodLift(), false); assert.equal(f.game.canSquint(), false);
    assert.equal(f.game.selectFloatDepth(0.25), false);
    assert.equal(f.game.equipGear("rod.bamboo.4m").ok, false);
    f.approve({ castId: "early_landing_001" }); await flush();
    assert.equal(f.landed.length, 0, "Approval receipt is not old enough to report an already landed short flight.");
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(f.landed.length, 1); assert.deepEqual(f.landed[0].value, point);
    assert.deepEqual(f.recorded, []); assert.equal(f.game.retrieveCast(), false);
    f.resolveLanding(); await flush();
    assert.deepEqual(f.recorded, [true]); assert.equal(f.game.castLanding, null); assert.equal(f.game.predictedServerCast, null);
    assert.equal(f.game.retrieveCast(), true);
  } finally { globalThis.window = previousWindow; }
});

test("start rejection during flight or after visual landing clears only prediction without progress changes", async () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    for (const earlyLanding of [false, true]) {
      const f = fixture(), before = structuredClone(f.game.inventory.state);
      f.game.endCastAction(); await flush();
      if (earlyLanding) flyToWater(f);
      f.rejectStart(); await flush();
      assert.equal(f.game.cast.state.fs, "idle"); assert.equal(f.game.castApproval, null);
      assert.equal(f.game.predictedServerCast, null); assert.equal(Boolean(f.game.castLanding), false);
      assert.deepEqual(f.landed, []); assert.deepEqual(f.recorded, []); assert.deepEqual(f.game.inventory.state, before);
      assert.equal(f.errors.length, 1); assert.deepEqual(f.sounds, ["cast"]);
    }
  } finally { globalThis.window = previousWindow; }
});

test("landing rejection rolls back an approved prediction without granting bait or counting success", async () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    const f = fixture(), before = structuredClone(f.game.inventory.state);
    f.game.endCastAction(); await flush(); f.approve({ castId: "denied_landing_001" }); await flush(); ageApproval(f);
    flyToWater(f); f.rejectLanding(); await flush();
    assert.equal(f.game.cast.state.fs, "idle"); assert.equal(f.game.castLanding, null);
    assert.deepEqual(f.recorded, []); assert.deepEqual(f.game.inventory.state, before);
    assert.equal(f.errors.length, 1); assert.deepEqual(f.cancelled, ["denied_landing_001"]);
  } finally { globalThis.window = previousWindow; }
});

test("a delayed save cannot hold up visual release, start an obsolete request, or swallow its rejection", async () => {
  for (const outcome of ["cancel", "reject"]) {
    const f = fixture(); let completeSave, rejectSave;
    f.game.server.save = () => new Promise((resolve, reject) => { completeSave = resolve; rejectSave = reject; });
    f.game.endCastAction(); assert.equal(f.game.cast.state.fs, "flight"); assert.equal(f.starts.length, 0);
    if (outcome === "cancel") { f.game.cancelCastAction(); completeSave(); }
    else rejectSave(new Error("Save unavailable"));
    await flush(); assert.equal(f.game.cast.state.fs, "idle"); assert.equal(f.starts.length, 0);
    assert.equal(f.errors.length, outcome === "reject" ? 1 : 0); assert.deepEqual(f.recorded, []);
  }
});

test("a stale start approval or denial cannot cancel a newer throw or report old errors", async () => {
  for (const outcome of ["approve", "reject"]) {
    const f = fixture(); f.game.endCastAction(); await flush(); f.game.cancelCastAction();
    f.game.cast.beginTargeting(); f.game.cast.selectTarget({ x: 0, z: 4 }); f.game.castEpoch += 1;
    f.game.endCastAction(); await flush(); const current = f.game.predictedServerCast;
    if (outcome === "approve") f.approve({ castId: "obsolete_start_001" }, 0);
    else f.rejectStart(0);
    await flush(); assert.equal(f.game.cast.state.fs, "flight"); assert.equal(f.game.predictedServerCast, current);
    assert.deepEqual(f.errors, []); assert.deepEqual(f.cancelled, outcome === "approve" ? ["obsolete_start_001"] : []);
    f.game.cancelCastAction(); f.approve({ castId: "cleanup_001" }, 1); await flush();
  }
});

test("cancelling an early landing clears its confirmation timer and cannot report a success later", async () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    const f = fixture(); f.game.endCastAction(); await flush(); flyToWater(f);
    f.approve({ castId: "timer_cancel_001" }); await flush(); assert.ok(f.game.predictedServerCast.timer);
    f.game.cancelCastAction(); await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(f.game.cast.state.fs, "idle"); assert.deepEqual(f.landed, []); assert.deepEqual(f.recorded, []);
    assert.deepEqual(f.cancelled, ["timer_cancel_001"]);
  } finally { globalThis.window = previousWindow; }
});
