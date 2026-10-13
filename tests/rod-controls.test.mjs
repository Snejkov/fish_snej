import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DEFAULT_ROD_SPEED, normalizeRodSpeed } from "../src/rodControls.js";
import { editableProfile } from "../src/serverClient.js";
import { settings as validateSettings, initialState } from "../server/validation.mjs";
import { t, setLanguage } from "../src/i18n.js";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejAngler } = await import("../src/angler.js");
const { SnejInventory } = await import("../src/gear/inventory.js");
const { SnejAuth } = await import("../src/auth.js");
const { SnejUI } = await import("../src/ui.js");
const { SnejFloatRig, rigForRod, castLimitsForTip } = await import("../src/floatRig.js");
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("rod speed scales mouse, swipe and analog input and their cap, but never walking look", () => {
  for (const fps of [30, 60, 144]) for (const source of ["mouse", "swipe", "stick"])
    for (const fs of ["idle", "charge", "flight", "wait"]) {
      let baseline;
      for (const speed of [1, 0.25, 2, 4]) {
        const game = Object.create(Game.prototype);
        Object.assign(game, { yaw: 0, pitch: 0, cameraMode: "first-person", cast: { state: { fs } },
          settings: { sens: 1, rodSpeed: speed }, mouse: { dx: source === "mouse" ? 1 : 0, dy: 0 },
          mobileInput: { enabled: true, setStickMode() {}, takeLook: () => ({ dx: source === "swipe" ? 1 : 0, dy: 0 }),
            rodLook: () => ({ dx: source === "stick" ? 0.0001 : 0, dy: 0 }) } });
        game.updateLook(1 / fps);
        if (speed === 1) baseline = game.yaw;
        near(game.yaw, baseline * (["flight", "wait"].includes(fs) ? speed : 1));
        game.mouse.dx = 10000;
        const before = game.yaw;
        game.updateLook(1 / fps);
        if (["flight", "wait"].includes(fs)) near(before - game.yaw, 0.12 * speed / fps);
        assert.equal(game.settings.sens, 1);
      }
    }
});

test("faster defaults, strict server bounds and old-save migration preserve existing progress", () => {
  assert.equal(DEFAULT_ROD_SPEED, 2);
  for (const invalid of [undefined, null, "3", NaN, Infinity, {}]) assert.equal(normalizeRodSpeed(invalid), 2);
  assert.equal(normalizeRodSpeed(-1), 0.25); assert.equal(normalizeRodSpeed(100), 4);
  assert.equal(initialState().settings.rodSpeed, 2);
  for (const value of [0.25, 1, 2, 3.25, 4]) assert.equal(validateSettings({ rodSpeed: value }).rodSpeed, value);
  for (const value of [0, 4.01, NaN, Infinity, "2", null]) assert.throws(() => validateSettings({ rodSpeed: value }));
  const game = Object.create(Game.prototype);
  Object.assign(game, { auth: new SnejAuth(), settings: { rodSpeed: 2 }, save() {} });
  for (const value of [undefined, 0.25, 1, 3.25, 4, "bad"]) {
    const inventory = new SnejInventory().serialize();
    const migrated = game.migrateSave({ version: 5, settings: { rodSpeed: value }, player: { inventory } });
    assert.equal(migrated.settings.rodSpeed, normalizeRodSpeed(value));
    assert.deepEqual(migrated.player.inventory, inventory);
  }
  game.setSetting("rodSpeed", 3.25);
  game.inventory = new SnejInventory();
  assert.equal(editableProfile(game).settings.rodSpeed, 3.25);
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), data = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } });
  try {
    Object.assign(game, { stats: { stampSeen() {}, serialize: () => ({}) }, catchLog: { serialize: () => [] },
      hasProgress: false, playerName: "LocalTester" });
    Game.prototype.save.call(game);
    assert.equal(game.loadSave().settings.rodSpeed, 3.25);
    assert.deepEqual(game.loadSave().player.inventory, game.inventory.serialize());
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  }
});

test("settings exposes a translated rod-speed slider and updates its multiplier immediately", () => {
  const originalDocument = globalThis.document, nodes = [];
  globalThis.document = { documentElement: { lang: "ru" }, createElement: tag => {
    const node = { tagName: tag.toUpperCase(), dataset: {}, children: [], listeners: {},
      append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); },
      addEventListener(type, callback) { this.listeners[type] = callback; } };
    nodes.push(node); return node;
  }, querySelectorAll: selector => nodes.filter(node => selector === "[data-setting]"
    ? Boolean(node.dataset.setting) : node.dataset.settingReadout === "rodSpeed") };
  try {
    const ui = Object.create(SnejUI.prototype), game = Object.create(Game.prototype);
    Object.assign(game, { settings: { rodSpeed: 2 }, save() {} }); ui.game = game;
    setLanguage("ru", { persist: false });
    ui.renderSettings({ innerHTML: "", appendChild() {} });
    const input = nodes.find(node => node.dataset.setting === "rodSpeed");
    assert.equal(input.type, "range"); assert.equal(input.min, 0.25); assert.equal(input.max, 4);
    assert.equal(input.value, "2"); assert.notEqual(t("Fishing rod speed"), "Fishing rod speed");
    input.value = "3.25"; input.listeners.input();
    assert.equal(game.settings.rodSpeed, 3.25);
    assert.equal(nodes.find(node => node.dataset.settingReadout === "rodSpeed").textContent, "3.25x");
    setLanguage("en", { persist: false }); assert.equal(t("Fishing rod speed"), "Fishing rod speed");
  } finally { globalThis.document = originalDocument; setLanguage("ru", { persist: false }); }
});

test("a partial empty lift pulls a taut float on the real pole without retrieval or stretching", () => {
  for (const fps of [30, 60, 144]) for (const length of [4, 6]) for (const depth of [0.5, 1]) {
    const angler = new SnejAngler(), rig = rigForRod(length, depth);
    angler.carry.setLength(length);
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
    camera.position.set(0, 1.62, 0); camera.lookAt(0, 0, 7);
    const info = { state: "playing", speed: 0, directionX: 0, directionZ: 0, depth: 0,
      castState: "wait", cameraMode: "first-person", viewBlend: 0, camera, castCamera: camera };
    for (let i = 0; i < fps * 2; i++) angler.update(1 / fps, info);
    const tip = angler.getRodTip(new THREE.Vector3());
    const reach = castLimitsForTip({ x: 0, z: 0 }, tip, rig.upperLine - 0.02, 0).max;
    const bobber = { x: 0, y: 0, z: reach }, game = Object.create(Game.prototype);
    Object.assign(game, { cast: { state: { fs: "wait", bobber, retrieving: false }, rig,
      startRetrieve() { throw new Error("An unbitten lift cannot retrieve."); } }, floatRig: new SnejFloatRig(),
      castTip: new THREE.Vector3(), angler, rodLiftHeld: true,
      floatContext: { playerOrigin: new THREE.Vector3(), surfaceY: () => 0, isWaterAt: () => true },
      audio: { deny() { throw new Error("Lift must stay reachable."); } }, ui: { showToast() {} } });
    game.updateFloatRig(1 / fps);
    for (let i = 0; i < fps; i++) {
      angler.update(1 / fps, { ...info, rodLiftHeld: true, rodLiftPullsFloat: true,
        castBobber: bobber, castLineLength: rig.upperLine, rodLiftAllowed: candidate => game.canLiftRodTo(candidate) });
      game.updateFloatRig(1 / fps);
      assert.equal(game.cast.state.fs, "wait"); assert.equal(bobber.y, 0);
      assert.ok(angler.getRodTip(tip).distanceTo(bobber) <= rig.upperLine + 1e-6);
      assert.equal(rig.lineLength, length);
    }
    assert.ok(bobber.z < reach - 0.1, `${length}m pole must pull the float: ${reach} -> ${bobber.z}`);
    game.rodLiftHeld = false;
    for (let i = 0; i < fps; i++) {
      angler.update(1 / fps, { ...info, castBobber: bobber, castLineLength: rig.upperLine });
      game.updateFloatRig(1 / fps);
    }
    assert.equal(game.cast.state.fs, "wait"); assert.equal(game.cast.state.retrieving, false);
  }
});
