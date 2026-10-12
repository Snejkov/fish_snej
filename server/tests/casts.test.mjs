import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createRequire } from "node:module";
import { GameStore } from "../store.mjs";
import { approveCast, landCast, cancelCast } from "../casts.mjs";
import { isCastWater } from "../castWorld.mjs";
import { createApp } from "../app.mjs";
import { releaseRoot } from "../paths.mjs";
import { SnejServerClient } from "../../src/serverClient.js";
import { SnejCastSystem } from "../../src/castSystem.js";

let WebSocket, WebSocketServer;
try { ({ WebSocket, WebSocketServer } = await import("ws")); }
catch (error) {
  if (!process.env.SNEJ_TEST_WS_BUNDLE) throw error;
  const bundled = createRequire(import.meta.url)(process.env.SNEJ_TEST_WS_BUNDLE);
  WebSocket = bundled.ws; WebSocketServer = bundled.wsServer;
}
const target = { x: 0, y: 0, z: 0 };
assert.ok(isCastWater(target.x, target.z, "mid"));
const origin = { x: -5, y: 0.04, z: 0, yaw: 0, pitch: -0.4, view: "third-person" };
function fixture(path = ":memory:") {
  let now = 1000;
  const store = new GameStore(path, { now: () => now });
  const user = store.createGuest("CastTester"), token = store.newSession(user.id);
  store.updatePosition(user.id, origin);
  return { store, user, token, advance: (ms) => { now += ms; },
    start: (requestId = "request_0001", extra = {}) => approveCast(store, user.id, token, "connection_1", { requestId, target, ...extra }),
    land: (castId, landing = target) => landCast(store, user.id, token, "connection_1", { castId, landing }) };
}
const rejects = (fn, code) => assert.throws(fn, error => error.code === code);

test("approved cast, exact durable landing, idempotent replay and unchanged economy", () => {
  const directory = mkdtempSync(join(tmpdir(), "snej-cast-test-")), path = join(directory, "game.sqlite");
  const f = fixture(path);
  try {
    const before = f.store.profile(f.user.id), cast = f.start();
    assert.equal(cast.userId, f.user.id); assert.equal(cast.approvedAt, 1000);
    assert.deepEqual(cast.origin, origin); assert.equal(cast.gear.lineLength, 8); assert.equal(cast.gear.floatDepth, 0.5);
    assert.equal(f.start().castId, cast.castId);
    rejects(() => f.land(cast.castId), "cast_conflict");
    f.advance(1000);
    const landed = f.land(cast.castId);
    assert.ok(landed.applied); assert.equal(landed.cast.state, "landed"); assert.equal(landed.cast.landedAt, 2000);
    assert.deepEqual(landed.cast.landing, target);
    assert.equal(landed.profile.coins, before.coins);
    assert.equal(landed.profile.state.inventory.owned[cast.gear.bait], before.state.inventory.owned[cast.gear.bait] - 1);
    assert.equal(f.land(cast.castId).applied, false);
    rejects(() => f.land(cast.castId, { ...target, x: 0.01 }), "operation_conflict");
    f.store.close();
    const reopened = new GameStore(path);
    try {
      const row = reopened.db.prepare("SELECT * FROM casts WHERE cast_id=?").get(cast.castId);
      assert.equal(row.status, "landed"); assert.deepEqual(JSON.parse(row.landing_json), target);
      assert.equal(reopened.profile(f.user.id).coins, before.coins);
      assert.equal(reopened.profile(f.user.id).state.inventory.owned[cast.gear.bait], 9);
    } finally { reopened.close(); }
  } finally { if (f.store.db.isOpen) f.store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("no blind landing, identity/session/connection, equipment, range, land, replay and cancellation protection", () => {
  const f = fixture();
  try {
    rejects(() => f.start("request_spoof", { userId: 1 }), "invalid_request");
    rejects(() => f.start("request_time", { time: 100 }), "invalid_request");
    for (const bad of [{ x: 20, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: NaN, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }]) {
      assert.throws(() => f.start("request_invalid", { target: bad }));
    }
    rejects(() => f.land("unknown_0001"), "cast_conflict");
    const cast = f.start(); f.advance(500);
    rejects(() => landCast(f.store, 1, f.token, "connection_1", { castId: cast.castId, landing: target }), "cast_conflict");
    rejects(() => landCast(f.store, f.user.id, "another_session", "connection_1", { castId: cast.castId, landing: target }), "cast_conflict");
    rejects(() => landCast(f.store, f.user.id, f.token, "connection_2", { castId: cast.castId, landing: target }), "cast_conflict");
    rejects(() => f.land(cast.castId, { ...target, x: 1 }), "cast_invalid_target");
    rejects(() => f.start("request_0001", { target: { ...target, x: 1 } }), "operation_conflict");
    f.store.patch(f.user.id, { expectedRevision: f.store.profile(f.user.id).revision, patch: { settings: { floatDepth: 1 } } });
    rejects(() => f.land(cast.castId), "cast_conflict");
    cancelCast(f.store, f.user.id, f.token, "connection_1", { castId: cast.castId });
    rejects(() => f.land(cast.castId), "cast_expired");
    const expired = f.start("request_0002"); f.advance(30001);
    rejects(() => f.land(expired.castId), "cast_expired");
    const replaced = f.start("request_0003"); f.start("request_0004"); f.advance(1000);
    rejects(() => f.land(replaced.castId), "cast_expired");
    assert.equal(f.store.profile(f.user.id).state.inventory.owned["bait.earthworm"], 10);
    assert.equal(f.store.profile(f.user.id).coins, 100);
  } finally { f.store.close(); }
});

test("real authenticated HTTP cast lifecycle requires the live lake session and rechecks logout", { timeout: 10000 }, async () => {
  const f = fixture();
  const app = createApp({ store: f.store, WebSocketServer, staticRoot: releaseRoot, publicOrigin: "http://127.0.0.1", secure: false, guestOnly: true });
  app.http.listen(0, "127.0.0.1"); await once(app.http, "listening");
  const url = `http://127.0.0.1:${app.http.address().port}`; app.config.publicOrigin = url;
  const headers = { Cookie: `snej_session=${f.token}`, Origin: url, "Content-Type": "application/json" };
  const request = (path, value) => fetch(url + path, { method: "POST", headers, body: JSON.stringify(value) });
  const input = { requestId: "http_cast_0001", target };
  try {
    assert.equal((await request("/api/cast/start", input)).status, 409);
    const socket = new WebSocket(url.replace("http:", "ws:") + "/ws", { headers });
    await once(socket, "message");
    const adapter = new SnejServerClient({ fetcher: (path, options) => fetch(url + path, {
      ...options, headers: { ...headers, ...options.headers } }), requestId: () => input.requestId });
    adapter.enabled = true; adapter.accept(f.store.profile(f.user.id), "restore");
    const cast = await adapter.beginCast(target);
    const physics = new SnejCastSystem({ rodRange: 8, floatDepth: 0.5, getCastOrigin: () => ({ x: -5, y: 1.4, z: 0 }) });
    const ctx = { strictTarget: true, pos: origin, yaw: Math.PI / 2, pitch: -0.4,
      terrainHeightAt: () => -3, terrainDepthAt: () => 3, waterSurfaceY: () => 0,
      isWaterAt: (x, z) => isCastWater(x, z, "mid") };
    physics.tick(0, ctx); physics.beginTargeting(); assert.ok(physics.selectTarget(target));
    physics.state.charge = physics.state.targetPower; assert.ok(physics.onActionUp());
    for (let i = 0; i < 600 && physics.state.fs === "flight"; i += 1) physics.tick(1 / 60, ctx);
    assert.equal(physics.state.fs, "wait"); f.advance(1000);
    const landed = await adapter.landCast(cast.castId, { ...physics.state.bobber });
    assert.equal(landed.cast.userId, f.user.id); assert.ok(landed.applied);
    assert.ok(Math.hypot(landed.cast.landing.x, landed.cast.landing.z) < 0.00001);
    assert.equal(adapter.profile.state.inventory.owned["bait.earthworm"], 9);
    assert.equal((await request("/api/cast/land", { castId: cast.castId, landing: target, reward: 100000 })).status, 400);
    assert.equal((await request("/api/logout", {})).status, 200);
    assert.equal((await request("/api/cast/start", { ...input, requestId: "http_cast_0002" })).status, 401);
  } finally { await app.close(); f.store.close(); }
});
