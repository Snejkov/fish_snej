import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire, registerHooks } from "node:module";
import { createApp } from "../app.mjs";
import { GameStore } from "../store.mjs";
import { releaseRoot } from "../paths.mjs";
import { SnejServerClient } from "../../src/serverClient.js";
import { SnejCastSystem } from "../../src/castSystem.js";
import { SnejInventory } from "../../src/gear/inventory.js";
import { SnejStats } from "../../src/game/stats.js";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../../src/game.js");
let WebSocket, WebSocketServer;
try { ({ WebSocket, WebSocketServer } = await import("ws")); }
catch (error) {
  if (!process.env.SNEJ_TEST_WS_BUNDLE) throw error;
  const bundled = createRequire(import.meta.url)(process.env.SNEJ_TEST_WS_BUNDLE);
  WebSocket = bundled.ws; WebSocketServer = bundled.wsServer;
}
const waitUntil = async predicate => {
  const end = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Predicted cast did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

for (const outcome of ["accepted", "bait-denied", "range-denied"]) {
  test(`real HTTP/WebSocket prediction: ${outcome}, instant flight, delayed authority and unchanged profile`, { timeout: 10000 }, async () => {
    const previousWindow = globalThis.window; globalThis.window = {};
    const store = new GameStore(":memory:");
    const user = store.createGuest("PredictionTester"), token = store.newSession(user.id);
    const pos = { x: -2.5, y: 0.04, z: 0, yaw: 0, pitch: -0.4, view: "first-person" };
    store.updatePosition(user.id, pos);
    const app = createApp({ store, WebSocketServer, staticRoot: releaseRoot,
      publicOrigin: "http://127.0.0.1", secure: false, guestOnly: true });
    let releaseRequest, game;
    const requestBarrier = new Promise(resolve => { releaseRequest = resolve; });
    try {
      app.http.listen(0, "127.0.0.1"); await once(app.http, "listening");
      const url = `http://127.0.0.1:${app.http.address().port}`; app.config.publicOrigin = url;
      const headers = { Cookie: `snej_session=${token}`, Origin: url };
      const socket = new WebSocket(url.replace("http:", "ws:") + "/ws", { headers });
      await once(socket, "message");
      const profile = store.profile(user.id), errors = [], requests = [];
      const client = new SnejServerClient({ fetcher: async (path, options) => {
        requests.push(path);
        if (path === "/api/cast/start") await requestBarrier;
        return fetch(url + path, { ...options, headers: { ...headers, ...options.headers } });
      } });
      client.enabled = true; client.accept(profile, "restore");
      if (outcome === "bait-denied") {
        const depleted = structuredClone(profile); depleted.state.inventory.owned["bait.earthworm"] = 0;
        store.write(user.id, depleted.state, depleted.coins, depleted.revision + 1);
      }
      const before = store.profile(user.id);
      const range = outcome === "range-denied" ? 40 : 8;
      const target = { x: outcome === "range-denied" ? 10 : 0, y: 0, z: 0 };
      const context = { strictTarget: true, holdCast: false, pos, yaw: Math.PI / 2, pitch: -0.4,
        terrainHeightAt: () => -3, terrainDepthAt: () => 3, waterSurfaceY: () => 0, isWaterAt: () => true };
      game = Object.create(Game.prototype);
      Object.assign(game, { server: client, multiplayer: { connected: true }, castEpoch: 1, cameraMode: "first-person",
        pos: new THREE.Vector3(pos.x, pos.y, pos.z), yaw: context.yaw, pitch: context.pitch,
        settings: { ...profile.state.settings, rodLength: range / 2 }, keys: new Set(), mouse: { dx: 0, dy: 0 },
        inventory: new SnejInventory({ ...profile.state.inventory, coins: profile.coins }), stats: new SnejStats(),
        cast: new SnejCastSystem({ rodRange: range, floatDepth: profile.state.settings.floatDepth, getCastOrigin: () => ({ x: pos.x, y: 1.4, z: 0 }) }),
        castContext: context, canCast: () => true, updateCamera() {}, updateCastVisuals() {}, updateCastControls() {}, save() {},
        handleAccountError: error => errors.push(error), ui: { showToast() {}, refreshInventory() {}, refreshProfile() {} },
        audio: { cast() {}, deny() {}, splash() {} }, castMarkerHeight: () => 0,
        angler: { group: { position: { copy() {} }, rotation: {} }, getRodTip: () => ({ x: pos.x, y: 1.4, z: 0 }) },
        floatDepthInput: {}, castMeter: { classList: { toggle() {} } }, aimMarker: {},
        water: { particles: { children: [] }, addSplash() {}, addRipple() {} },
        updateCast: dt => game.cast.tick(dt, context) });
      game.cast.tick(0, context); game.cast.beginTargeting(); assert.ok(game.cast.selectTarget(target));
      assert.ok(game.endCastAction());
      assert.equal(game.cast.state.fs, "flight", "Actual game release cannot await HTTP, a save or a microtask.");
      for (let frame = 0; frame < 600 && game.cast.state.fs === "flight"; frame += 1) Game.prototype.updateCast.call(game, 1 / 60);
      assert.equal(game.cast.state.fs, "wait");
      await waitUntil(() => requests.includes("/api/cast/start"));
      assert.equal(store.db.prepare("SELECT count(*) AS total FROM casts").get().total, 0);
      assert.equal(game.stats.state.successfulCasts, 0); assert.equal(game.retrieveCast(), false);
      const landing = { ...game.cast.state.bobber };
      const requestedTarget = { ...game.predictedServerCast.target };
      releaseRequest();
      await waitUntil(() => game.predictedServerCast === null);
      if (outcome === "accepted") {
        assert.equal(game.cast.state.fs, "wait"); assert.equal(game.stats.state.successfulCasts, 1);
        const row = store.db.prepare("SELECT * FROM casts WHERE user_id=?").get(user.id);
        assert.equal(row.status, "landed"); assert.deepEqual(JSON.parse(row.target_json), requestedTarget);
        assert.ok(Math.hypot(requestedTarget.x - target.x, requestedTarget.z - target.z) < 1e-9);
        assert.deepEqual(JSON.parse(row.landing_json), landing);
        assert.ok(row.landed_at - row.approved_at >= 50);
        assert.equal(requests.filter(path => path === "/api/cast/land").length, 1); assert.deepEqual(errors, []);
      } else {
        assert.equal(game.cast.state.fs, "idle"); assert.equal(game.stats.state.successfulCasts, 0);
        assert.equal(errors.length, 1); assert.equal(errors[0].code, outcome === "bait-denied" ? "bait_unavailable" : "cast_invalid_target");
        assert.equal(requests.includes("/api/cast/land"), false);
      }
      const after = store.profile(user.id);
      // The existing presence flush increments revision even for an unchanged position.
      assert.equal(after.revision, before.revision + 1);
      assert.deepEqual({ ...after, revision: before.revision }, before,
        "Prediction cannot alter coins, owned gear, bait, settings or progress.");
    } finally {
      releaseRequest();
      game?.cancelServerCast();
      await app.close(); store.close(); globalThis.window = previousWindow;
    }
  });
}
