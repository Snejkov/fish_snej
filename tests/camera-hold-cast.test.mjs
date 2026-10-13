import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejAngler } = await import("../src/angler.js");
const { SnejCastSystem } = await import("../src/castSystem.js");
const { SnejFloatRig } = await import("../src/floatRig.js");
const { makePresence } = await import("../src/multiplayer/presence.js");
const { SnejDesktopCursor } = await import("../src/desktopCursor.js");
const { AccountError } = await import("../src/serverClient.js");
const flush = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };
const classes = () => ({ toggle() {}, add() {}, contains() { return false; } });

function fixture(view, online = false) {
  const game = Object.create(Game.prototype), cancelled = [], landed = [];
  let approval;
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 1800);
  camera.position.set(view === "third-person" ? 3 : 0.25, view === "third-person" ? 4 : 1.66, view === "third-person" ? -4 : 0.1);
  camera.lookAt(new THREE.Vector3(3, 0, 6));
  const angler = new SnejAngler(); angler.group.rotation.y = -1.5; angler.heading = -0.6;
  angler.group.updateMatrixWorld(true);
  Object.assign(game, { camera, castCamera: camera.clone(), cameraMode: view, yaw: 0, pitch: -0.4,
    angler, pos: new THREE.Vector3(0, 0.04, 0), castOrigin: new THREE.Vector3(), castTip: new THREE.Vector3(),
    castAimDirection: new THREE.Vector3(), keys: new Set(), mouse: { dx: 0, dy: 0 }, allowed: true,
    canCast: () => game.allowed, castWaterNearby: () => true, castMarkerHeight: () => 0,
    placeCastMarker(marker, point) { marker.position.set(point.x, point.y, point.z); },
    updateCastControls() {}, updateCastVisuals() {}, updateCamera() {}, save() {},
    toggleView() { this.cameraMode = "first-person"; },
    floatRig: { reset() {} }, floatDepthInput: {},
    settings: { rodLength: 4, floatDepth: 0.5, sens: 1 },
    castMeter: { classList: classes(), setAttribute() {} }, castMeterFill: { classList: classes(), style: {} },
    castMeterTarget: { style: {} }, castMeterTol: { style: {} }, castMeterCursor: { style: {} },
    castMeterDistance: {}, castMeterStatus: {},
    aimMarker: new THREE.Mesh(new THREE.RingGeometry(0.3, 0.35), new THREE.MeshBasicMaterial()),
    inventory: { serialize: () => ({ equipped: {}, clothing: {}, loadouts: [] }),
      equippedRod: () => ({ length: 4 }), state: { equipped: { bait: "bait.earthworm" } }, countOf: () => 10, consumeBait: () => true },
    stats: { recordCast() {} }, audio: { resume() {}, cast() {}, deny() {}, splash() {} },
    ui: { showToast() {}, refreshInventory() {}, refreshProfile() {}, showPause() {}, el: { toast: { classList: classes() } } }, handleAccountError() {},
    water: { particles: { children: [] }, addSplash() {}, addRipple() {} },
    server: { enabled: online, save: async () => {}, beginCast: () => new Promise(resolve => { approval = resolve; }),
      cancelCast: async id => { cancelled.push(id); }, landCast: async (id, value) => { landed.push({ id, value }); } },
    castContext: { holdCast: true, cameraAim: true, strictTarget: true, waterSurfaceY: () => 0,
      terrainHeightAt: () => -3, terrainDepthAt: () => 3, isWaterAt: () => true }
  });
  game.cast = new SnejCastSystem({ rodRange: 8, floatDepth: 0.5,
    getCastOrigin: () => angler.getCastOrigin(game.castOrigin,
      game.castRelease?.yaw ?? (["idle", "aim", "charge"].includes(game.cast.state.fs) ? game.cast.state.aimYaw : undefined)) });
  return { game, cancelled, landed, approve: ticket => approval(ticket) };
}

test("camera ray drives both views; launch precedes the smooth turn and exact landing at every frame rate", () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    for (const view of ["third-person", "first-person"]) for (const fps of [30, 60, 144]) {
      const { game } = fixture(view); assert.ok(game.beginHoldCast());
      const facing = game.castFacing;
      for (let i = 0; i < fps; i += 1) game.updateCast(1 / fps);
      const cameraHitYaw = Math.atan2(3, 6);
      assert.ok(Math.abs(game.cast.state.aimYaw - cameraHitYaw) < 1e-8);
      assert.ok(Math.abs(game.cast.state.aimYaw - facing) > 1);
      const beforeLook = game.yaw; game.mouse.dx = 60; game.updateLook();
      assert.notEqual(game.yaw, beforeLook, "Hold must allow actual mouse camera input.");
      game.camera.lookAt(new THREE.Vector3(5, 0, 5)); game.updateCast(0);
      assert.ok(Math.abs(game.cast.state.aimYaw - Math.PI / 4) < 1e-8);
      assert.equal(game.castFacing, facing, "Aiming must not instantly rotate the visible model.");
      const target = { ...game.cast.state.aimPoint }, power = game.cast.state.charge;
      const tip = game.castTipForFacing(game.cast.state.aimYaw).clone();
      const groupRotation = game.angler.group.rotation.y, bones = game.angler.bones.RightHand.quaternion.clone();
      game.angler.group.rotation.y = game.cast.state.aimYaw;
      const alignedTip = game.angler.getCastHoldTip(game.castCamera);
      assert.ok(tip.distanceTo(alignedTip) < 0.00001, "Prediction must use the future aligned physical rod tip.");
      game.angler.group.rotation.y = groupRotation;
      assert.ok(game.angler.bones.RightHand.quaternion.equals(bones), "Prediction cannot pose live bones.");
      const origin = game.cast.getCastOriginLocal();
      const launchOrigin = { ...origin };
      assert.ok(game.endHoldCast()); assert.equal(game.cast.state.fs, "flight");
      assert.equal(game.cameraMode, "first-person");
      assert.equal(game.castFacing, facing, "Release cannot turn the visible model before the float starts flying.");
      assert.equal(game.castTurn.elapsed, 0);
      assert.ok(Math.hypot(...["x", "y", "z"].map(axis => game.cast.state.castOrigin[axis] - launchOrigin[axis])) < 1e-10,
        "Post-launch turning cannot change the predicted release grip.");
      game.updateCast(1 / fps);
      assert.ok(Math.abs(game.castFacing - facing) > 0 && Math.abs(game.castFacing - facing) < 1);
      assert.equal(makePresence(game, 1).yaw, game.castFacing, "Peers receive the visual turning direction, not the orbit camera.");
      game.camera.lookAt(new THREE.Vector3(-20, 5, -20)); game.pitch = 1.2;
      for (let i = 0; i < fps && game.castTurn; i += 1) {
        game.updateCast(1 / fps);
        assert.deepEqual(game.cast.state.aimPoint, target, "Post-release camera movement cannot retarget.");
      }
      assert.equal(game.castTurn, null); assert.equal(game.castFacing, null);
      assert.equal(game.cast.state.castPower, power);
      assert.equal(game.cameraMode, "first-person");
      for (let i = 0; i < fps * 10 && game.cast.state.fs === "flight"; i += 1) game.updateCast(1 / fps);
      assert.equal(game.cast.state.fs, "wait");
      assert.ok(Math.hypot(game.cast.state.bobber.x - target.x, game.cast.state.bobber.z - target.z) < 0.00001);
    }
  } finally { globalThis.window = previousWindow; }
});

test("pending cast can be paused; reset cannot revive it and delayed saves cannot start an obsolete intent", async () => {
  const previousDocument = globalThis.document; globalThis.document = {};
  try {
    const f = fixture("third-person", true), game = f.game;
    game.beginHoldCast(); game.updateCast(1); game.endHoldCast(); await flush();
    assert.equal(game.cast.state.fs, "charge"); game.pause(); await flush();
    f.approve({ castId: "approved_cancel_001" }); await flush();
    assert.equal(game.cast.state.fs, "idle"); assert.equal(game.castRelease, null);
    assert.deepEqual(f.cancelled, ["approved_cancel_001"]); assert.equal(game.cameraMode, "third-person");
    const delayed = fixture("first-person", true), next = delayed.game;
    let saveDone, starts = 0;
    next.server.save = () => new Promise(resolve => { saveDone = resolve; });
    next.server.beginCast = () => { starts += 1; return Promise.resolve({ castId: "obsolete_001" }); };
    next.beginHoldCast(); next.updateCast(1); next.endHoldCast();
    next.cast.reset(); next.updateCast(0); saveDone(); await flush();
    assert.equal(starts, 0); assert.equal(next.castTurn, null); assert.equal(next.cast.state.fs, "idle");
  } finally { globalThis.document = previousDocument; }
});

test("turning across the -PI/PI boundary follows the short arc without a snap", () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    const { game } = fixture("third-person"); game.camera.lookAt(new THREE.Vector3(-0.03, 0, -6));
    game.beginHoldCast(); game.castFacing = Math.PI - 0.02; game.updateCast(1);
    const start = game.castFacing; game.endHoldCast();
    assert.ok(Math.abs(game.castTurn.delta) < 0.04);
    game.updateCast(0.08); assert.ok(game.castFacing > start && game.castFacing - start < 0.04);
    game.updateCast(0.08); assert.equal(game.cast.state.fs, "flight");
  } finally { globalThis.window = previousWindow; }
});

test("delayed approval freezes target/power and facing; approval launches without waiting for a turn", async () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    for (const view of ["third-person", "first-person"]) {
      const f = fixture(view, true), game = f.game; game.beginHoldCast(); game.updateCast(1.5);
      const target = { ...game.cast.state.aimPoint }, power = game.cast.state.charge, facing = game.castFacing;
      game.endHoldCast(); await flush(); game.updateCast(2);
      assert.equal(game.cast.state.fs, "charge"); assert.equal(game.cameraMode, view);
      assert.equal(game.castFacing, facing); assert.equal(game.castTurn.elapsed, 0);
      game.camera.lookAt(new THREE.Vector3(-10, 0, -10)); game.updateCast(2);
      assert.deepEqual(game.cast.state.aimPoint, target); assert.equal(game.cast.state.charge, power);
      assert.equal(game.castFacing, facing); assert.equal(game.castTurn.elapsed, 0);
      f.approve({ castId: "camera_approved_001" }); await flush();
      assert.equal(game.cast.state.fs, "flight");
      assert.equal(game.castFacing, facing); assert.equal(game.castTurn.elapsed, 0);
      game.updateCast(1 / 60);
      assert.notEqual(game.castFacing, facing, "Only a launched cast starts turning.");
      for (let i = 0; i < 600 && game.cast.state.fs === "flight"; i += 1) game.updateCast(1 / 60);
      await flush(); assert.equal(f.landed.length, 1);
      assert.ok(Math.hypot(f.landed[0].value.x - target.x, f.landed[0].value.z - target.z) < 0.00001);
    }
  } finally { globalThis.window = previousWindow; }
});

test("cancel, disconnect and changed origin invalidate a pending cast and late approval", async () => {
  const previousDocument = globalThis.document; globalThis.document = {};
  try {
    for (const interruption of ["cancel", "disconnect", "origin"]) {
      const f = fixture("third-person", true), game = f.game;
      game.beginHoldCast(); game.updateCast(1); game.endHoldCast(); await flush(); game.updateCast(0.05);
      if (interruption === "cancel") game.cancelCastAction();
      if (interruption === "disconnect") { game.allowed = false; game.updateCast(0.05); }
      if (interruption === "origin") { game.pos.x += 1; game.updateCast(0.05); }
      f.approve({ castId: "late_camera_001" }); await flush();
      assert.equal(game.cast.state.fs, "idle"); assert.equal(game.castTurn, null); assert.equal(game.castRelease, null);
      assert.equal(game.cameraMode, "third-person"); assert.deepEqual(f.cancelled, ["late_camera_001"]);
      assert.deepEqual(f.landed, []);
    }
  } finally { globalThis.document = previousDocument; }
});

test("post-launch turn pauses at zero dt and cannot revive after retrieval, reset or an obsolete epoch", () => {
  for (const interruption of ["retrieve", "reset", "epoch"]) {
    const { game } = fixture("third-person");
    game.beginHoldCast(); game.updateCast(1); game.endHoldCast();
    assert.equal(game.cast.state.fs, "flight");
    game.updateCast(0.05);
    const facing = game.castFacing, elapsed = game.castTurn.elapsed;
    game.updateCast(0); assert.equal(game.castFacing, facing); assert.equal(game.castTurn.elapsed, elapsed);
    if (interruption === "retrieve") game.cast.startRetrieve("manual");
    if (interruption === "reset") game.cast.reset();
    if (interruption === "epoch") game.castEpoch += 1;
    game.updateCast(0);
    assert.equal(game.castTurn, null); assert.equal(game.castFacing, null);
    if (interruption === "epoch") assert.equal(game.cast.state.fs, "flight", "Clearing animation cannot cancel a released flight.");
    const power = game.cast.state.castPower;
    game.updateCast(0); assert.equal(game.castTurn, null); assert.equal(game.cast.state.castPower, power);
  }
});

test("a real pause and an open menu freeze the launched turn, then resume without a snap or duplicate cast", () => {
  const { game } = fixture("third-person");
  game.mode = "playing"; game.canCast = Game.prototype.canCast.bind(game);
  let launches = 0; game.audio.cast = () => { launches += 1; };
  game.beginHoldCast(); game.updateCast(1); game.endHoldCast(); game.updateCast(0.05);
  const facing = game.castFacing, elapsed = game.castTurn.elapsed, bobber = { ...game.cast.state.bobber };
  game.pause(); game.updateCast(0);
  assert.equal(game.mode, "paused"); assert.equal(game.castFacing, facing); assert.equal(game.castTurn.elapsed, elapsed);
  assert.deepEqual(game.cast.state.bobber, bobber); assert.equal(launches, 1);
  game.resume({ capture: false });
  game.ui.inventoryOpen = true; game.updateCast(0);
  assert.equal(game.castFacing, facing); assert.equal(game.castTurn.elapsed, elapsed);
  game.ui.inventoryOpen = false; game.updateCast(0.05);
  assert.notEqual(game.castFacing, facing); assert.equal(game.castTurn.elapsed, elapsed + 0.05);
  assert.equal(launches, 1);
});

test("post-launch turning completes even when a short flight lands first, with a real angler and fixed line", () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    for (const view of ["third-person", "first-person"]) for (const fps of [30, 60, 144]) {
      for (const charge of [0.3, 1]) for (const height of [0.04, -0.9]) {
        const { game } = fixture(view);
        game.pos.y = height;
        game.floatRig = new SnejFloatRig();
        game.floatContext = { surfaceY: () => 0, isWaterAt: () => true, lineObstruction: () => null, playerOrigin: game.pos };
        game.beginHoldCast(); game.castFacing = game.cast.state.aimYaw + Math.PI - 0.01;
        game.updateCast(charge / 0.48);
        const target = { ...game.cast.state.aimPoint };
        game.endHoldCast();
        const origin = { ...game.cast.state.castOrigin };
        let landedBeforeTurn = false;
        for (let i = 0; i < fps * 3; i += 1) {
          game.updateCast(1 / fps);
          game.castCamera.position.set(game.pos.x, game.pos.y + 1.62, game.pos.z);
          game.castCamera.lookAt(game.castCamera.position.clone().add(new THREE.Vector3(Math.sin(game.yaw), Math.sin(game.pitch), Math.cos(game.yaw))));
          game.angler.update(1 / fps, { state: "playing", speed: 0, camera: game.castCamera, castCamera: game.castCamera,
            viewBlend: 0, castState: game.cast.state.fs });
          if (game.cast.state.fs === "wait" && game.castTurn) landedBeforeTurn = true;
          game.updateFloatRig(1 / fps);
          assert.equal(game.cast.state.retrieving, false, "The body turn cannot retrieve a valid cast.");
          assert.deepEqual(game.cast.state.castOrigin, origin);
          if (game.cast.state.fs === "wait") {
            assert.ok(Math.hypot(game.cast.state.bobber.x - target.x, game.cast.state.bobber.z - target.z) < 1e-5,
              "The body turn cannot pull the chosen landing point.");
          }
        }
        assert.equal(game.castTurn, null); assert.equal(game.cast.state.fs, "wait");
        assert.equal(game.postCastPose, false);
        if (charge === 0.3 && height < 0) assert.equal(landedBeforeTurn, true, "The short-flight fixture must exercise turning after landing.");
        assert.ok(game.angler.getRodTip().distanceTo(new THREE.Vector3(target.x, 0, target.z)) <= game.cast.rig.upperLine + 1e-6);
        if (charge === 1) {
          const before = { ...game.cast.state.bobber };
          game.yaw += 0.02; game.updateCast(1 / fps);
          game.angler.update(1 / fps, { state: "playing", speed: 0, camera: game.castCamera, castCamera: game.castCamera,
            viewBlend: 0, castState: "wait" });
          game.castAdjusting = true; game.updateFloatRig(1 / fps);
          assert.ok(Math.hypot(game.cast.state.bobber.x - before.x, game.cast.state.bobber.z - before.z) > 1e-5,
            "After settling, an intentional rod correction must still move the float.");
        }
      }
    }
  } finally { globalThis.window = previousWindow; }
});

test("upward camera and dry/blocked preview do not get silently clamped to a valid cast", () => {
  const previousDocument = globalThis.document; globalThis.document = {};
  try {
    const { game } = fixture("third-person"); game.beginHoldCast(); game.updateCast(3);
    game.camera.lookAt(new THREE.Vector3(0, 20, 10)); game.updateCast(0);
    assert.equal(game.cast.state.canRelease, false); assert.equal(game.endHoldCast(), false);
    game.camera.lookAt(new THREE.Vector3(3, 0, 6)); game.castContext.isWaterAt = () => false;
    game.beginHoldCast(); game.updateCast(3);
    assert.equal(game.cast.state.canRelease, false); assert.equal(game.endHoldCast(), false);
    assert.equal(game.cameraMode, "third-person");
  } finally { globalThis.document = previousDocument; }
});

test("a quick release reports insufficient strength instead of blaming open water", () => {
  const previousDocument = globalThis.document; globalThis.document = {};
  try {
    const { game } = fixture("first-person"), messages = [];
    game.ui.showToast = text => messages.push(text);
    assert.ok(game.beginHoldCast()); game.updateCast(0.1);
    assert.equal(game.cast.state.canRelease, false);
    assert.equal(game.cast.state.releaseBlock, "range");
    assert.equal(game.endHoldCast(), false); assert.equal(game.cast.state.fs, "idle");
    assert.deepEqual(messages, ["Charge a longer cast."]);
    assert.ok(game.beginHoldCast()); game.updateCast(2.5);
    assert.equal(game.cast.state.canRelease, true); assert.equal(game.endHoldCast(), true);
  } finally { globalThis.document = previousDocument; }
});

test("held strength accumulates 20 percent faster without changing the range or auto-releasing", () => {
  const { game } = fixture("first-person");
  game.beginHoldCast(); game.updateCast(1);
  assert.ok(Math.abs(game.cast.state.charge - 0.48) < 1e-9);
  assert.equal(game.cast.castRange, 7.5);
  game.updateCast(2.5 / 1.2 - 1 + 1e-9);
  assert.equal(game.cast.state.charge, 1); assert.equal(game.cast.state.fs, "charge");
  game.updateCast(10); assert.equal(game.cast.state.charge, 1); assert.equal(game.cast.state.fs, "charge");
});

function eventSurface() {
  const listeners = new Map();
  return { listeners, addEventListener(type, listener, capture = false) {
    const entries = listeners.get(type) || []; entries.push({ listener, capture: Boolean(capture) }); listeners.set(type, entries);
  }, emit(type, event, captureOnly = false) {
    for (const entry of listeners.get(type) || []) if (!captureOnly || entry.capture) entry.listener(event);
  } };
}

function withDesktopInput(view, callback) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const win = eventSurface(), doc = eventSurface(), { game } = fixture(view);
  let captures = 0, releases = 0;
  Object.assign(doc, { hidden: false, pointerLockElement: null, exitPointerLock() {
    this.pointerLockElement = null; this.emit("pointerlockchange", {});
  } });
  globalThis.window = win; globalThis.document = doc;
  game.canvas = eventSurface();
  game.canvas.requestPointerLock = () => { captures += 1; doc.pointerLockElement = game.canvas; doc.emit("pointerlockchange", {}); };
  game.desktopCursor = new SnejDesktopCursor({ canvas: game.canvas, canInteract: () => game.canCast(), environment: { document: doc, addEventListener: win.addEventListener },
    onCapture: () => { game.castPointer = null; game.mouse.dx = game.mouse.dy = 0; } });
  game.castCancelButton = eventSurface(); game.floatDepthInput = eventSurface();
  game.ui.el.mobileLook = eventSurface(); game.mode = "playing";
  game.mobileInput = { enabled: false, reset() {}, takeLook: () => ({ dx: 0, dy: 0 }) };
  game.placementSystem = { handlePointerUp() {} }; game.worldClock = { refresh() {} };
  const originalRelease = game.endHoldCast.bind(game);
  game.endHoldCast = () => { releases += 1; return originalRelease(); };
  game.installEvents();
  // Normal gameplay starts with capture from the launch/resume gesture.
  doc.pointerLockElement = game.canvas;
  const mouse = (extra = {}) => ({ button: 0, preventDefault() {}, sourceCapabilities: { firesTouchEvents: false }, ...extra });
  try { callback({ game, win, doc, mouse, counts: () => ({ captures, releases }) }); }
  finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
}

test("landed LMB lifts then retrieves without recasting; held input needs a fresh press", () => {
  for (const fps of [30, 60, 144]) withDesktopInput("first-person", ({ game, win, mouse }) => {
    game.canvas.emit("mousedown", mouse()); game.updateCast(2.2); win.emit("mouseup", mouse(), true);
    for (let i = 0; i < 600 && game.cast.state.fs !== "wait"; i++) game.updateCast(1 / 60);
    const bobber = { ...game.cast.state.bobber }, epoch = game.castEpoch;
    let baitChecks = 0; game.inventory.countOf = () => { baitChecks++; return 0; };
    game.canvas.emit("mousedown", mouse());
    assert.equal(game.cast.state.fs, "wait"); assert.equal(game.rodLiftHeld, true);
    assert.equal(game.desktopCastHeld, false); assert.equal(game.beginHoldCast(), false);
    assert.equal(game.beginCastAction(), false); assert.equal(game.beginRodLift(), false);
    game.updateRodLift(0.1); win.emit("mouseup", mouse(), true);
    assert.equal(game.rodLiftHeld, true, "Releasing the click cannot cancel the one-shot empty retrieval.");
    assert.deepEqual(game.cast.state.bobber, bobber); assert.equal(game.castEpoch, epoch);
    for (let i = 0; i < fps * 3; i++) { game.updateRodLift(1 / fps); game.updateCast(1 / fps); }
    assert.equal(game.cast.state.fs, "idle"); assert.equal(game.rodLiftHeld, false);
    assert.equal(game.castEpoch, epoch); assert.equal(game.cast.state.retrieving, false);
    assert.equal(baitChecks, 0, "Returning the attached rig needs no spare bait.");
    for (let i = 0; i < fps; i++) { game.updateRodLift(1 / fps); game.updateCast(1 / fps); }
    assert.equal(game.cast.state.fs, "idle", "Neither an old release nor repeated ticks may start a cast.");
    game.inventory.countOf = () => 1;
    game.canvas.emit("mousedown", mouse()); assert.equal(game.cast.state.fs, "charge");
    assert.equal(game.castEpoch, epoch + 1);
  });
});

test("pending landing and lost interaction cancel lifting without resetting the cast", () => {
  withDesktopInput("first-person", ({ game, win, doc, mouse }) => {
    game.cast.state.fs = "wait"; game.castLanding = {};
    game.canvas.emit("mousedown", mouse()); assert.equal(game.rodLiftAction, undefined);
    game.castLanding = null;
    for (const reason of ["blur", "hidden", "blocked", "pointercancel"]) {
      game.allowed = true; doc.hidden = false;
      game.desktopCursor.captureAutomatically();
      game.canvas.emit("mousedown", mouse()); assert.equal(game.rodLiftHeld, true);
      if (reason === "hidden") { doc.hidden = true; doc.emit("visibilitychange", {}); }
      else if (reason === "blocked") { game.allowed = false; game.updateRodLift(1); }
      else win.emit(reason, {});
      assert.equal(game.rodLiftHeld, false); assert.equal(game.rodLiftAction, null);
      assert.equal(game.cast.state.fs, "wait");
    }
  });
});

test("physical Z squints only after landing and always clears on release, blur and hidden page", () => {
  withDesktopInput("first-person", ({ game, win, doc }) => {
    game.resize = () => {};
    const key = extra => ({ code: "KeyZ", preventDefault() {}, ...extra });
    win.emit("keydown", key()); assert.equal(game.keyboardSquintHeld, false);
    game.cast.state.fs = "wait";
    for (const modifier of ["ctrlKey", "altKey", "metaKey", "isComposing", "defaultPrevented"]) {
      win.emit("keydown", key({ [modifier]: true })); assert.equal(game.keyboardSquintHeld, false);
    }
    win.emit("keydown", key({ target: { tagName: "INPUT" } })); assert.equal(game.keyboardSquintHeld, false);
    win.emit("keydown", key()); assert.equal(game.keyboardSquintHeld, true);
    game.updateSquint(1); assert.ok(game.camera.fov < 70);
    win.emit("keyup", key({ target: { tagName: "INPUT" } })); assert.equal(game.keyboardSquintHeld, false);
    game.updateSquint(1); assert.equal(game.camera.fov, 70);
    for (const reason of ["blur", "resize", "hidden"]) {
      win.emit("keydown", key()); game.updateSquint(1);
      if (reason === "hidden") { doc.hidden = true; doc.emit("visibilitychange", {}); }
      else win.emit(reason, {});
      assert.equal(game.keyboardSquintHeld, false); assert.equal(game.camera.fov, 70);
      win.emit("keydown", key({ repeat: true })); assert.equal(game.keyboardSquintHeld, false);
    }
  });
});

test("captured primary pointer release launches exactly once without a bubbling mouseup in both views", () => {
  for (const view of ["first-person", "third-person"]) withDesktopInput(view, ({ game, win, mouse, counts }) => {
    game.canvas.emit("mousedown", mouse()); assert.equal(game.cast.state.fs, "charge");
    game.updateCast(2.2); assert.equal(game.cast.state.canRelease, true);
    const target = { ...game.cast.state.aimPoint };
    win.emit("pointerup", mouse({ pointerType: "mouse" }), true);
    assert.equal(game.holdCasting, false); assert.ok(game.castTurn);
    win.emit("mouseup", mouse(), true); win.emit("pointerup", mouse({ pointerType: "mouse" }), true);
    assert.equal(counts().releases, 1, "Pointer and compatibility mouse releases cannot throw twice.");
    for (let i = 0; i < 600 && game.cast.state.fs !== "wait"; i += 1) game.updateCast(1 / 60);
    assert.equal(game.cast.state.fs, "wait"); assert.equal(game.cameraMode, "first-person");
    assert.ok(Math.hypot(game.cast.state.bobber.x - target.x, game.cast.state.bobber.z - target.z) < 0.00001);
  });
});

test("a recapture click is consumed before a real mouse hold on a touch-capable PC", () => {
  withDesktopInput("third-person", ({ game, win, doc, mouse, counts }) => {
    game.desktopCursor.release();
    game.mobileInput.enabled = true; game.lastTouchCanvas = performance.now();
    game.canvas.emit("mousedown", mouse());
    assert.equal(game.cast.state.fs, "idle"); assert.equal(game.desktopCastHeld, undefined);
    assert.equal(doc.pointerLockElement, game.canvas);
    win.emit("pointerup", mouse({ pointerType: "mouse" }), true);
    assert.equal(game.cast.state.fs, "idle");
    game.canvas.emit("mousedown", mouse());
    assert.equal(game.cast.state.fs, "charge"); assert.equal(counts().captures, 1);
    assert.equal(doc.pointerLockElement, game.canvas, "The initial held gesture must already support camera look.");
    win.emit("mousemove", mouse({ movementX: 12, movementY: 0 })); assert.equal(game.mouse.dx, 12);
    game.updateCast(2.2);
    win.emit("mouseup", mouse(), true); assert.equal(counts().releases, 1); assert.ok(game.castTurn);
  });
});

test("manual free cursor is preserved and touch, pen, and non-primary releases cannot end a mouse hold", () => {
  withDesktopInput("first-person", ({ game, win, mouse, counts }) => {
    game.desktopCursor.release({ manual: true });
    game.canvas.emit("mousedown", mouse()); game.updateCast(2.2);
    for (const event of [mouse({ pointerType: "touch" }), mouse({ pointerType: "pen" }),
      mouse({ sourceCapabilities: { firesTouchEvents: true } }), mouse({ button: 2 })]) win.emit("pointerup", event, true);
    assert.equal(game.holdCasting, true); assert.equal(counts().releases, 0);
    win.emit("mouseup", mouse(), true);
    assert.equal(counts().captures, 0); assert.equal(counts().releases, 1); assert.equal(game.desktopCursor.free, true);
  });
});

test("touch compatibility down and cancelled desktop holds cannot produce a throw", () => {
  withDesktopInput("first-person", ({ game, win, mouse, counts }) => {
    game.canvas.emit("mousedown", mouse({ sourceCapabilities: { firesTouchEvents: true } }));
    assert.equal(game.cast.state.fs, "idle"); assert.equal(counts().captures, 0);
    game.canvas.emit("mousedown", mouse()); game.updateCast(2.2); win.emit("blur", {});
    assert.equal(game.cast.state.fs, "idle"); win.emit("pointerup", mouse({ pointerType: "mouse" }), true);
    assert.equal(counts().releases, 0); assert.equal(game.castTurn, null);
  });
});

test("a long touch refreshes compatibility suppression on release without disabling a known real mouse", () => {
  withDesktopInput("first-person", ({ game, doc, mouse, counts }) => {
    game.mobileInput.enabled = true; game.lastTouchCanvas = performance.now() - 10000;
    doc.emit("touchend", {});
    game.canvas.emit("mousedown", mouse({ sourceCapabilities: undefined }));
    assert.equal(game.cast.state.fs, "idle"); assert.equal(counts().captures, 0);
    game.canvas.emit("mousedown", mouse());
    assert.equal(game.cast.state.fs, "charge"); assert.equal(counts().captures, 0);
  });
});

test("missing or depleted bait stops both cast entry paths with plain feedback and no inventory changes", () => {
  for (const view of ["first-person", "third-person"]) for (const online of [false, true]) for (const bait of [null, "bait.earthworm"]) {
    const { game } = fixture(view, online), messages = [];
    game.inventory.state.equipped.bait = bait; game.inventory.countOf = () => 0;
    const before = structuredClone(game.inventory.state);
    game.ui.showToast = message => messages.push(message);
    game.server.save = () => { throw new Error("Empty bait cannot send a profile or cast request."); };
    assert.equal(game.beginHoldCast(), false); assert.equal(game.beginCastAction(), false);
    assert.deepEqual(messages, ["No bait.", "No bait."]);
    assert.equal(game.cast.state.fs, "idle"); assert.equal(game.cameraMode, view);
    assert.deepEqual(game.inventory.state, before);
  }
});

test("bait depleted during a hold cancels before flight without changing the view or requesting approval", () => {
  for (const view of ["first-person", "third-person"]) for (const online of [false, true]) {
    const { game } = fixture(view, online), messages = [];
    let quantity = 1;
    game.inventory.countOf = () => quantity; game.ui.showToast = message => messages.push(message);
    game.server.save = () => { throw new Error("Empty bait cannot request approval."); };
    assert.ok(game.beginHoldCast()); game.updateCast(2.2); quantity = 0;
    assert.equal(game.endHoldCast(), false); assert.equal(game.cast.state.fs, "idle");
    assert.equal(game.holdCasting, false); assert.equal(game.castTurn, null);
    assert.equal(game.cameraMode, view); assert.deepEqual(messages, ["No bait."]);
    assert.equal(quantity, 0);
  }
});

test("authoritative empty-bait rejection overrides a positive client count and clears the pending cast", async () => {
  const { game } = fixture("third-person", true), messages = [];
  game.ui.showToast = message => messages.push(message);
  game.handleAccountError = Game.prototype.handleAccountError.bind(game);
  game.server.beginCast = async () => { throw new AccountError("bait_unavailable", 409); };
  assert.ok(game.beginHoldCast()); game.updateCast(2.2); assert.ok(game.endHoldCast()); await flush();
  assert.deepEqual(messages, ["No bait."]);
  assert.equal(game.cast.state.fs, "idle"); assert.equal(game.cameraMode, "third-person");
  assert.equal(game.castApproval, null); assert.equal(game.castTurn, null);
  assert.equal(game.inventory.countOf("bait.earthworm"), 10, "A denial cannot invent a stock adjustment.");
});

test("the last unbitten bait survives local and online landing, repeated retrieval and another cast", async () => {
  const originalWindow = globalThis.window; globalThis.window = {};
  try {
    for (const online of [false, true]) {
      const f = fixture("third-person", online), game = f.game;
      let bait = 1;
      game.inventory.countOf = () => bait;
      game.inventory.consumeBait = () => { throw new Error("No bite can consume bait."); };
      for (let cast = 0; cast < 2; cast += 1) {
        assert.ok(game.beginHoldCast()); game.updateCast(2.2); assert.ok(game.endHoldCast());
        if (online) { await flush(); f.approve({ castId: `unbitten_000${cast}` }); await flush(); }
        for (let i = 0; i < 600 && game.cast.state.fs !== "wait"; i += 1) game.updateCast(1 / 60);
        await flush(); assert.equal(game.cast.state.fs, "wait"); assert.equal(bait, 1);
        assert.ok(game.retrieveCast()); assert.equal(game.retrieveCast(), false);
        assert.equal(game.holdCasting, false); assert.equal(game.cast.state.retrieving, true);
        for (let i = 0; i < 600 && game.cast.state.fs !== "idle"; i += 1) game.updateCast(1 / 60);
        assert.equal(game.cast.state.fs, "idle"); assert.equal(bait, 1);
      }
      game.cast.state.fs = "wait"; bait = 0;
      assert.ok(game.retrieveCast(), "Retrieval never requires spare bait or grants historical bait back.");
      assert.equal(bait, 0);
    }
  } finally { globalThis.window = originalWindow; }
});
