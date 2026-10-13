import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejDesktopCursor } = await import("../src/desktopCursor.js");
const { SnejUI } = await import("../src/ui.js");
const { SnejPlayerChat } = await import("../src/multiplayer/chat.js");
const { SnejCastSystem } = await import("../src/castSystem.js");
const { SnejAngler, RETRIEVE_LIFT_ANGLE } = await import("../src/angler.js");
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const node = () => ({ classList: { add() {}, remove() {}, toggle() {} }, focus() {} });

function entryFixture() {
  let requests = 0, releaseCount = 0, ready, profile;
  const listeners = {};
  const document = { hidden: false, pointerLockElement: null,
    addEventListener(name, fn) { listeners[name] = fn; },
    exitPointerLock() { this.pointerLockElement = null; releaseCount++; listeners.pointerlockchange(); } };
  const game = Object.create(Game.prototype), canvas = { focus() {}, requestPointerLock() {
    requests++; document.pointerLockElement = canvas; listeners.pointerlockchange();
  } };
  Object.assign(game, { canvas, identity: { id: 2 }, mode: "title", keys: new Set(), mouse: { dx: 0, dy: 0 },
    mobileInput: { enabled: false }, serverReady: new Promise(resolve => { ready = resolve; }),
    server: { enabled: true, profile: {}, pending: Promise.resolve(), request: () => new Promise(resolve => { profile = resolve; }), accept() {} },
    multiplayer: { connected: false, connect: () => true },
    audio: { resume() {} }, cast: { state: { fs: "idle" }, cancelCharge() {} }, castMeter: node(),
    disconnectMultiplayer() {}, buildWorld() {}, save() {}, resetSquint() {}, endRodLift() {},
    handleAccountError() { this.mode = "title"; },
    ui: { showTitle() {}, showPause() {}, showToast() {}, el: { toast: node() } } });
  game.desktopCursor = new SnejDesktopCursor({ canvas, canInteract: () => game.canDesktopCapture(),
    environment: { document, addEventListener() {} } });
  return { game, document, ready: () => ready(), profile: () => profile({}),
    counts: () => ({ requests, releaseCount }) };
}

test("New and Continue capture in the launch gesture before either online await, then preserve connecting capture", async () => {
  for (const action of ["newGame", "continueGame"]) {
    const f = entryFixture(), pending = f.game[action]();
    assert.equal(f.counts().requests, 1); assert.equal(f.game.mode, "title");
    assert.equal(f.document.pointerLockElement, f.game.canvas);
    f.ready(); await flush(); assert.equal(f.game.desktopEntryActive, true);
    f.profile(); await pending;
    assert.equal(f.game.mode, "connecting"); assert.equal(f.game.desktopEntryActive, false);
    assert.equal(f.document.pointerLockElement, f.game.canvas);
    f.game.pause(); assert.equal(f.document.pointerLockElement, null);
    f.game.resume(); assert.equal(f.counts().requests, 2);
    assert.equal(f.document.pointerLockElement, f.game.canvas);
  }
});

test("Mobile and manual-free launch/resume do not grab a mouse; failed entry invalidates a late capture", async () => {
  for (const kind of ["mobile", "manual"]) {
    const f = entryFixture();
    if (kind === "mobile") f.game.mobileInput.enabled = true;
    else f.game.desktopCursor.release({ manual: true });
    const pending = f.game.newGame(); f.ready(); await flush(); f.profile(); await pending;
    f.game.resume(); assert.equal(f.counts().requests, 0);
  }
  const f = entryFixture(); f.game.serverDetectionFailed = true;
  const pending = f.game.newGame(); f.ready(); await pending;
  assert.equal(f.document.pointerLockElement, null); assert.equal(f.game.desktopEntryActive, false);
  f.document.pointerLockElement = f.game.canvas;
  f.game.desktopCursor.changed(); assert.equal(f.document.pointerLockElement, null);
});

test("Nickname entry captures before guest authentication and a failed guest request releases it", async () => {
  for (const failure of [false, true]) {
    const f = entryFixture(); f.game.identity = null;
    f.game.server.enterGuest = async () => { if (failure) throw new Error("Offline"); f.game.identity = { id: 2 }; };
    const pending = f.game.authenticatePlayer("GuestQA");
    assert.equal(f.counts().requests, 1);
    f.ready(); await flush();
    if (!failure) f.profile();
    const result = await pending;
    assert.equal(result.ok, !failure); assert.equal(f.game.serverBusy, false);
    assert.equal(f.document.pointerLockElement, failure ? null : f.game.canvas);
  }
});

test("A touch-capable PC restores mouse capture, but a later touch gesture does not request it", async () => {
  const f = entryFixture();
  f.game.mobileInput.enabled = true; f.game.desktopMouseActive = true;
  const pending = f.game.newGame();
  assert.equal(f.counts().requests, 1);
  f.ready(); await flush(); f.profile(); await pending;
  f.game.pause(); f.game.resume(); assert.equal(f.counts().requests, 2);
  f.game.pause(); f.game.desktopMouseActive = false;
  f.game.resume(); assert.equal(f.counts().requests, 2);
  assert.equal(f.document.pointerLockElement, null);
});

test("Chat releases and restores capture once, respecting manual free cursor and paused state", () => {
  const f = entryFixture(), chat = Object.create(SnejPlayerChat.prototype);
  f.game.mode = "playing"; f.game.ui.chat = chat;
  f.game.cancelCastAction = () => {}; f.game.mobileInput.reset = () => {};
  Object.assign(chat, { game: f.game, available: () => true, root: node(), panel: {}, preview: {},
    launcher: { setAttribute() {} }, input: { focus() {}, blur() {} }, log: {}, updateUnread() {} });
  f.game.captureDesktopCursor(); assert.equal(f.counts().requests, 1);
  chat.toggle(true); assert.equal(f.document.pointerLockElement, null);
  chat.toggle(false); assert.equal(f.counts().requests, 2);
  chat.toggle(false); assert.equal(f.counts().requests, 2);
  f.game.desktopCursor.release({ manual: true }); chat.toggle(true); chat.toggle(false);
  assert.equal(f.counts().requests, 2);
  f.game.mode = "paused"; chat.toggle(true); chat.toggle(false); assert.equal(f.counts().requests, 2);
});

test("Inventory/profile/roster closing captures once and switching open menus never captures between them", async () => {
  const previous = globalThis.document;
  const f = entryFixture(), ui = Object.create(SnejUI.prototype);
  f.game.ui = ui; f.game.mode = "playing";
  Object.assign(ui, { game: f.game, hudVisible: true, inventoryOpen: true, profileOpen: false, rosterOpen: false,
    clearGearDrag() {}, updateProfile() {}, el: { inventoryPanel: node(), profilePanel: node(), hud: node(), hint: node(),
      profileTabButtons: [node()] } });
  globalThis.document = { body: node(), getElementById: node };
  f.game.refreshPeerList = () => {};
  try {
    await ui.openProfile(); assert.equal(f.counts().requests, 0);
    assert.equal(ui.inventoryOpen, false); assert.equal(ui.profileOpen, true);
    ui.closeProfile(); assert.equal(f.counts().requests, 1);
    ui.toggleRoster(true); assert.equal(f.document.pointerLockElement, null);
    ui.toggleRoster(false); assert.equal(f.counts().requests, 2);
    ui.toggleRoster(false); assert.equal(f.counts().requests, 2);
    f.game.desktopCursor.release({ manual: true });
    ui.profileOpen = true; ui.closeProfile(); assert.equal(f.counts().requests, 2);
  } finally { globalThis.document = previous; }
});

test("Retrieval is a continuous airborne return to the hand with a visible catch, not a new throw", () => {
  for (const fps of [30, 60, 144]) for (const depth of [0, 0.5, 3.75]) {
    const cast = new SnejCastSystem({ rodRange: 8, floatDepth: depth });
    const hand = { x: 0.35, y: 1.15, z: 0.5 }, tip = { x: 0.35, y: 3.5, z: 3 };
    Object.assign(cast.state, { fs: "wait", bobber: { x: 0.35, y: 0.02, z: 6 }, charge: 0 });
    const ctx = { retrieveTarget: hand, rodTip: tip, retrieveDepth: depth, retrieveClearanceY: () => 0 };
    cast.tick(0, ctx); assert.equal(cast.startRetrieve("manual"), true);
    const start = { ...cast.state.bobber }; let old = start, catching = 0, highest = 0;
    for (let i = 0; i < fps * 3 && cast.state.retrieving; i++) {
      cast.tick(1 / fps, ctx);
      const p = cast.state.bobber;
      if (i === 0) assert.ok(Math.abs(p.y - start.y) < 0.08, "Extraction must start at the float, not above a submerged hook.");
      assert.ok(p.z <= old.z + 1e-8 && p.z >= hand.z - 1e-8);
      assert.ok(Math.hypot(p.x - old.x, p.y - old.y, p.z - old.z) < 1);
      if (cast.state.retrieveProgress === 1 && cast.state.retrieving) {
        catching++; assert.ok(Math.hypot(cast.state.retrieveHook.x - hand.x,
          cast.state.retrieveHook.y - hand.y, cast.state.retrieveHook.z - hand.z) < 1e-7);
      }
      highest = Math.max(highest, p.y); old = { ...p };
      const paused = { ...p }; cast.tick(0, ctx); assert.deepEqual(cast.state.bobber, paused);
    }
    assert.ok(highest > hand.y + 0.05); assert.ok(catching >= Math.floor(fps * 0.15));
    assert.equal(cast.state.fs, "idle"); assert.equal(cast.state.charge, 0);
    assert.equal(cast.state.retrieving, false); assert.equal(cast.state.castObstruction, null);
  }
});

test("Retrieval renders a visible hook and leader to the hand, then hides them without a new cast", () => {
  const game = Object.create(Game.prototype), hand = new THREE.Vector3(0.25, 1.15, 0.1);
  const line = count => new THREE.Line(new THREE.BufferGeometry().setAttribute("position",
    new THREE.BufferAttribute(new Float32Array(count * 3), 3)));
  Object.assign(game, { mode: "playing", time: 1, castTip: new THREE.Vector3(),
    cast: { rig: { lineLength: 8 }, state: { fs: "flight", retrieving: true, retrieveDepth: 0.12,
      bobber: { x: hand.x, y: hand.y + 0.12, z: hand.z } } },
    castMesh: new THREE.Object3D(), castLine: line(33), depthLine: line(2), hookMesh: Game.prototype.createHookMesh(),
    floatRig: { actualDepth: 0.5 }, angler: { getRodTip: out => out.set(0.25, 4, 1) } });
  game.updateCastVisuals();
  assert.equal(game.hookMesh.visible, true); assert.equal(game.depthLine.visible, true);
  assert.ok(game.hookMesh.position.distanceTo(hand) < 1e-8);
  const leader = game.depthLine.geometry.attributes.position;
  assert.ok(new THREE.Vector3().fromBufferAttribute(leader, 1).distanceTo(hand) < 1e-7);
  game.cast.state.fs = "idle"; game.cast.state.retrieving = false;
  game.updateCastVisuals();
  assert.equal(game.hookMesh.visible, false); assert.equal(game.depthLine.visible, false); assert.equal(game.castMesh.visible, false);
});

test("Returning rig keeps the original grip and raises the actual rod without stretching the line", () => {
  for (const fps of [30, 60, 144]) {
    const angler = new SnejAngler(), camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
    camera.position.set(0, 1.62, 0); camera.lookAt(0, 0, 10);
    const info = { state: "playing", castState: "wait", cameraMode: "first-person", camera, castCamera: camera };
    for (let i = 0; i < fps; i++) angler.update(1 / fps, info);
    const hand = angler.getRetrieveHand().clone(), tip = angler.getRodTip().clone();
    const cast = new SnejCastSystem({ rodRange: 8, floatDepth: 0.5 });
    cast.state.fs = "wait"; cast.state.bobber = { x: tip.x, y: 0, z: tip.z + 2 };
    const ctx = { retrieveTarget: hand, rodTip: tip, retrieveDepth: 0.5 };
    cast.tick(0, ctx); cast.startRetrieve("manual");
    let angle = 0, highest = 0;
    for (let i = 0; i < fps * 3 && cast.state.retrieving; i++) {
      cast.tick(1 / fps, ctx);
      angler.update(1 / fps, { ...info, castState: cast.state.fs, castRetrieving: cast.state.retrieving,
        castBobber: cast.state.bobber, castLineLength: cast.rig.lineLength - cast.state.retrieveDepth });
      assert.ok(Math.abs(angler.rodLiftAngle - angle) < 0.2,
        `FPS ${fps}, frame ${i}: angle ${angle} -> ${angler.rodLiftAngle}, returning ${cast.state.retrieving}`);
      assert.ok(angler.rodLiftAngle <= RETRIEVE_LIFT_ANGLE + 1e-8); angle = angler.rodLiftAngle;
      highest = Math.max(highest, angle);
      const actual = angler.getRodTip();
      if (cast.state.retrieving) assert.ok(actual.distanceTo(new THREE.Vector3(...Object.values(cast.state.bobber)))
        <= cast.rig.lineLength - cast.state.retrieveDepth + 1e-5);
      ctx.rodTip.copy(actual); ctx.retrieveTarget.copy(angler.getRetrieveHand());
      assert.ok(hand.distanceTo(ctx.retrieveTarget) < 0.001, "Retrieval cannot drop or move the grip.");
    }
    assert.ok(highest > 0.9, "The rod must visibly point upward during the return.");
  }
});
