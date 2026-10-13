import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { SnejAudio, DEFAULT_AMBIENT_VOLUME, AMBIENT_DEFAULTS_VERSION, migrateAmbientSettings } from "../src/audio.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejAuth } = await import("../src/auth.js");
const { SnejInventory } = await import("../src/gear/inventory.js");
const { SnejCatchLog } = await import("../src/game/catchLog.js");
const { SnejStats } = await import("../src/game/stats.js");

assert.equal(DEFAULT_AMBIENT_VOLUME, 0);
assert.deepEqual(migrateAmbientSettings(), { bgm: 0, ambientDefaultsVersion: AMBIENT_DEFAULTS_VERSION });
assert.deepEqual(migrateAmbientSettings(null), { bgm: 0, ambientDefaultsVersion: AMBIENT_DEFAULTS_VERSION });
for (const bgm of [0, 0.4, 0.7, 1]) {
  const legacy = { volume: 0.63, bgm, sens: 1.4, quality: "high", shadow: false, floatDepth: 1.2 };
  const snapshot = structuredClone(legacy);
  const migrated = migrateAmbientSettings(legacy);
  assert.deepEqual(legacy, snapshot, "Migration must not mutate its input.");
  assert.deepEqual(migrated, { ...legacy, bgm: 0, ambientDefaultsVersion: AMBIENT_DEFAULTS_VERSION });
  const explicit = { ...migrated, bgm: 0.38 };
  assert.deepEqual(migrateAmbientSettings(JSON.parse(JSON.stringify(explicit))), explicit,
    "An explicit post-migration ambient setting must survive restart.");
}

const parameter = (value = 0) => ({ value, targets: [], setTargetAtTime(target) { this.targets.push(target); this.value = target; },
  setValueAtTime(target) { this.value = target; }, exponentialRampToValueAtTime(target) { this.value = target; } });
const connections = [];
const node = () => ({ gain: parameter(1), frequency: parameter(), Q: parameter(),
  connect(target) { connections.push([this, target]); }, start() {}, stop() {} });
class TestAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 64; this.state = "running"; this.destination = node(); }
  createGain() { return node(); }
  createBiquadFilter() { return node(); }
  createDynamicsCompressor() { return node(); }
  createOscillator() { return node(); }
  createBufferSource() { return node(); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
}

const originalWindow = globalThis.window;
globalThis.window = { AudioContext: TestAudioContext };
try {
  for (const settings of [{ volume: 0.63 }, migrateAmbientSettings({ volume: 0.63, bgm: 0.7 })]) {
    const audio = new SnejAudio(settings);
    audio.init();
    assert.equal(audio.bgmBus.gain.value, 0, "Ambient must start at zero without an audible fade from default gain.");
    assert.equal(audio.seBus.gain.value, 0.63, "Event sounds must retain the player's volume.");
    assert.ok(connections.some(([from, to]) => from === audio.ambientWater.bus && to === audio.bgmBus));
    assert.ok(connections.some(([from, to]) => from === audio.ambientWind.bus && to === audio.bgmBus));
    const before = connections.length;
    audio.click(); audio.charge(); audio.cast(0.5); audio.splash(); audio.waterSplash();
    assert.ok(connections.slice(before).some(([, to]) => to === audio.seBus), "Event sounds must still use the active event bus.");
    audio.setBgm(0.38);
    assert.equal(audio.bgmBus.gain.value, 0.38);
    const restored = new SnejAudio(migrateAmbientSettings(JSON.parse(JSON.stringify(settings))));
    restored.init();
    assert.equal(restored.bgmBus.gain.value, 0.38);
    assert.equal(restored.seBus.gain.value, 0.63);
  }
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}

const inventory = new SnejInventory();
inventory.buy("rod.fiberglass.5m");
inventory.equip("rod.fiberglass.5m");
inventory.saveLoadout("AudioTestSet");
inventory.state.clothing.head = "future.hat";
const catchLog = new SnejCatchLog();
catchLog.addCatch({ species: "TestFish", length: 30, weight: 0.8, location: "TestLake", time: 1000 });
const stats = new SnejStats({ castCount: 8, successfulCasts: 6, fishCaught: 1, playtimeSec: 120, lastSeenAt: 1000 });
const auth = new SnejAuth();
const identity = auth.createIdentity("AudioTester", 3);
const legacySave = {
  version: 5, settings: { volume: 0.63, bgm: 0.7, sens: 1.4, quality: "high", shadow: false, floatDepth: 1.2, lang: "en" },
  player: { name: identity.name, identity, nextLocalId: identity.nextLocalId, inventory: inventory.serialize(),
    catchLog: catchLog.serialize(), stats: stats.serialize(), spawn: "alpha",
    lastPosition: { x: 20, y: 2, z: 40, yaw: 0.3, pitch: -0.15 }, view: { mode: "first-person", pitch: -0.15 } },
  placements: [{ textureId: "test-texture", x: 10, y: 2, z: 30 }], multiplayer: { lastRoom: "audio-test" }
};
const memory = new Map([["snejfishing-save-v1", JSON.stringify(legacySave)], ["unrelated-key", "preserve"]]);
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value)
} });
try {
  const game = Object.create(Game.prototype);
  game.auth = auth;
  const migrated = game.loadSave();
  assert.equal(migrated.settings.bgm, 0);
  assert.equal(migrated.settings.ambientDefaultsVersion, AMBIENT_DEFAULTS_VERSION);
  assert.equal(migrated.settings.floatDepth, legacySave.settings.floatDepth / 2);
  assert.equal(migrated.settings.fishingUnitsVersion, 2);
  assert.equal(game.loadSave().settings.floatDepth, migrated.settings.floatDepth, "Reload cannot convert depth twice.");
  for (const key of ["volume", "sens", "quality", "shadow", "lang"]) {
    assert.equal(migrated.settings[key], legacySave.settings[key]);
  }
  for (const key of ["inventory", "catchLog", "stats", "lastPosition", "identity"]) {
    assert.deepEqual(migrated.player[key], legacySave.player[key], `Migration must preserve ${key}.`);
  }
  assert.deepEqual(migrated.placements, legacySave.placements);
  assert.deepEqual(migrated.multiplayer, legacySave.multiplayer);
  assert.equal(memory.get("unrelated-key"), "preserve");
  assert.equal(JSON.parse(memory.get("snejfishing-save-v1")).settings.ambientDefaultsVersion, AMBIENT_DEFAULTS_VERSION);
  Object.assign(game, { settings: migrated.settings, identity: migrated.player.identity,
    nextLocalId: migrated.player.nextLocalId, hasProgress: true,
    inventory: new SnejInventory(migrated.player.inventory), catchLog: new SnejCatchLog(migrated.player.catchLog),
    stats: new SnejStats(migrated.player.stats), pos: migrated.player.lastPosition,
    yaw: 0.3, pitch: -0.15, currentSpawn: "alpha", cameraMode: "first-person", lastRoom: "audio-test",
    placementSystem: { serializeCommitted: () => migrated.placements } });
  game.audio = new SnejAudio(game.settings);
  game.setSetting("bgm", 0.38);
  const restarted = Object.create(Game.prototype);
  restarted.auth = auth;
  const restored = restarted.loadSave();
  assert.equal(restored.settings.bgm, 0.38, "Game save/load must preserve an explicit post-migration choice.");
  assert.equal(restored.settings.volume, 0.63);
  assert.equal(restored.settings.ambientDefaultsVersion, AMBIENT_DEFAULTS_VERSION);
  assert.deepEqual(restored.player.inventory, legacySave.player.inventory);
  assert.deepEqual(restored.player.catchLog, legacySave.player.catchLog);
  assert.equal(restored.player.stats.playtimeSec, 120);
  assert.deepEqual(restored.player.lastPosition, legacySave.player.lastPosition);
  assert.deepEqual(restored.placements, legacySave.placements);
} finally {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
}

console.log("Ambient defaults tests passed: silent startup, one-time game-save migration, preserved progress/loadouts, explicit-setting persistence, wind/water routing, and preserved event sounds.");
