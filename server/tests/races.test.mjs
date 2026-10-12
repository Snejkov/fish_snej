import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { request } from "node:http";
import { createHook } from "node:async_hooks";
import { createApp } from "../app.mjs";
import { GameStore } from "../store.mjs";
import { releaseRoot } from "../paths.mjs";

class ControlledServer extends EventEmitter {
  close(done) { done(); }
}
class ControlledSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close() { this.readyState = 2; }
  finish() { this.readyState = 3; this.emit("close"); }
  terminate() { this.finish(); }
  ping() {}
  presence(value) { this.emit("message", JSON.stringify({ t: "presence", presence: value }), false); }
}
async function fixture() {
  const store = new GameStore(":memory:");
  const app = createApp({ store, WebSocketServer: ControlledServer, staticRoot: releaseRoot,
    publicOrigin: "http://127.0.0.1", secure: false });
  app.http.listen(0, "127.0.0.1");
  await once(app.http, "listening");
  app.config.publicOrigin = `http://127.0.0.1:${app.http.address().port}`;
  return { app, store, async close() { await app.close(); store.close(); } };
}

test("delayed authentication bodies cannot exceed four simultaneous password KDFs", { timeout: 15000 }, async () => {
  const f = await fixture();
  const active = new Set();
  let peak = 0, started = 0, received = 0;
  const hook = createHook({ init(id, type) {
    if (type === "SCRYPTREQUEST") { active.add(id); started += 1; peak = Math.max(peak, active.size); }
  }, destroy(id) { active.delete(id); } });
  const waiting = new Promise((resolve) => f.app.http.on("request", () => { if (++received === 8) resolve(); }));
  const requests = [], completed = [];
  const payload = JSON.stringify({ name: "UnknownPlayer", password: "Fixture password concurrent 2026" });
  try {
    hook.enable();
    for (let index = 0; index < 8; index += 1) {
      completed.push(new Promise((resolve, reject) => {
        const req = request(f.app.config.publicOrigin + "/api/login", { method: "POST", headers: {
          Origin: f.app.config.publicOrigin, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload)
        } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
        req.on("error", reject); requests.push(req); req.flushHeaders();
      }));
    }
    await waiting;
    for (const req of requests) req.end(payload);
    const statuses = await Promise.all(completed);
    assert.equal(statuses.filter((status) => status === 429).length, 4);
    assert.equal(statuses.filter((status) => status === 401).length, 4);
    assert.equal(started, 4);
    assert.equal(peak, 4);
  } finally {
    hook.disable();
    for (const req of requests) req.destroy();
    await f.close();
  }
});

test("replacement owns position even when it closes before its predecessor", async () => {
  const f = await fixture();
  try {
    const user = f.store.createUser("ReplacePlayer", "unused-fixture-hash");
    const token = f.store.newSession(user.id);
    const initial = f.store.profile(user.id).state.position;
    const old = new ControlledSocket();
    f.app.ws.emit("connection", old, { token, user });
    old.presence({ ...initial, x: 0.25 });
    assert.equal(f.store.profile(user.id).state.position.x, initial.x);
    const next = new ControlledSocket();
    f.app.ws.emit("connection", next, { token, user });
    assert.equal(old.readyState, 2);
    assert.equal(next.messages.find((message) => message.t === "welcome").profile.state.position.x, 0.25);
    assert.equal(f.store.profile(user.id).state.position.x, 0.25);
    old.presence({ ...initial, x: -0.25 });
    next.presence({ ...initial, x: 0.5 });
    next.finish();
    assert.equal(f.store.profile(user.id).state.position.x, 0.5);
    old.finish();
    assert.equal(f.store.profile(user.id).state.position.x, 0.5);
    const reconnect = new ControlledSocket();
    f.app.ws.emit("connection", reconnect, { token, user });
    assert.equal(reconnect.messages.find((message) => message.t === "welcome").profile.state.position.x, 0.5);
  } finally { await f.close(); }
});
