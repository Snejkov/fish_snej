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
const { makePresence } = await import("../src/multiplayer/presence.js");
const { SnejDesktopCursor } = await import("../src/desktopCursor.js");
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
      ["idle", "aim", "charge"].includes(game.cast.state.fs) ? game.cast.state.aimYaw : undefined) });
  return { game, cancelled, landed, approve: ticket => approval(ticket) };
}

test("camera ray, not the character, drives both views; turn and exact release are frame-rate independent", () => {
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
      assert.ok(game.endHoldCast()); assert.equal(game.cast.state.fs, "charge"); assert.equal(game.cameraMode, view);
      game.updateCast(1 / fps);
      assert.ok(Math.abs(game.castFacing - facing) > 0 && Math.abs(game.castFacing - facing) < 1);
      assert.equal(makePresence(game, 1).yaw, game.castFacing, "Peers receive the visual turning direction, not the orbit camera.");
      game.camera.lookAt(new THREE.Vector3(-20, 5, -20)); game.pitch = 1.2;
      for (let i = 0; i < fps && game.cast.state.fs === "charge"; i += 1) {
        game.updateCast(1 / fps);
        assert.deepEqual(game.cast.state.aimPoint, target, "Post-release camera movement cannot retarget.");
      }
      assert.equal(game.cast.state.fs, "flight"); assert.equal(game.cast.state.castPower, power);
      assert.equal(game.cameraMode, "first-person");
      for (let i = 0; i < fps * 10 && game.cast.state.fs === "flight"; i += 1) game.updateCast(1 / fps);
      assert.equal(game.cast.state.fs, "wait");
      assert.ok(Math.hypot(game.cast.state.bobber.x - target.x, game.cast.state.bobber.z - target.z) < 0.00001);
    }
  } finally { globalThis.window = previousWindow; }
});

test("approved turning cast can be paused; reset cannot revive it and delayed saves cannot start an obsolete intent", async () => {
  const previousDocument = globalThis.document; globalThis.document = {};
  try {
    const f = fixture("third-person", true), game = f.game;
    game.beginHoldCast(); game.updateCast(1); game.endHoldCast(); await flush();
    f.approve({ castId: "approved_cancel_001" }); await flush();
    assert.equal(game.cast.state.fs, "charge"); game.pause(); await flush();
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

test("delayed approval cannot change frozen camera target/power; launch waits for both turn and approval", async () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    for (const view of ["third-person", "first-person"]) {
      const f = fixture(view, true), game = f.game; game.beginHoldCast(); game.updateCast(1.5);
      const target = { ...game.cast.state.aimPoint }, power = game.cast.state.charge;
      game.endHoldCast(); await flush(); game.updateCast(2);
      assert.equal(game.cast.state.fs, "charge"); assert.equal(game.cameraMode, view);
      game.camera.lookAt(new THREE.Vector3(-10, 0, -10)); game.updateCast(2);
      assert.deepEqual(game.cast.state.aimPoint, target); assert.equal(game.cast.state.charge, power);
      f.approve({ castId: "camera_approved_001" }); await flush(); game.updateCast(1 / 60);
      assert.equal(game.cast.state.fs, "flight");
      for (let i = 0; i < 600 && game.cast.state.fs === "flight"; i += 1) game.updateCast(1 / 60);
      await flush(); assert.equal(f.landed.length, 1);
      assert.ok(Math.hypot(f.landed[0].value.x - target.x, f.landed[0].value.z - target.z) < 0.00001);
    }
  } finally { globalThis.window = previousWindow; }
});

test("cancel, disconnect and changed origin invalidate a turning cast and late approval", async () => {
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
  const mouse = (extra = {}) => ({ button: 0, preventDefault() {}, sourceCapabilities: { firesTouchEvents: false }, ...extra });
  try { callback({ game, win, doc, mouse, counts: () => ({ captures, releases }) }); }
  finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
}

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

test("first mouse hold captures before release and a real mouse remains usable on a touch-capable PC", () => {
  withDesktopInput("third-person", ({ game, win, doc, mouse, counts }) => {
    game.mobileInput.enabled = true; game.lastTouchCanvas = performance.now();
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
    game.desktopCursor.release();
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
    assert.equal(game.cast.state.fs, "charge"); assert.equal(counts().captures, 1);
  });
});
