import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createApp } from "../app.mjs";
import { GameStore } from "../store.mjs";
import { releaseRoot } from "../paths.mjs";
import { sessionCookie } from "../auth.mjs";

let WebSocket, WebSocketServer;
try { ({ WebSocket, WebSocketServer } = await import("ws")); }
catch (error) {
  if (!process.env.SNEJ_TEST_WS_BUNDLE) throw error;
  const bundled = createRequire(import.meta.url)(process.env.SNEJ_TEST_WS_BUNDLE);
  WebSocket = bundled.ws; WebSocketServer = bundled.wsServer;
  console.info("Transport tests use the explicitly selected, already installed Playwright ws bundle; deployed ws pin still needs Linux smoke verification.");
}

function client(url, cookie, origin) {
  const socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
  const queued = [], pending = [];
  socket.on("message", (raw) => {
    const data = JSON.parse(String(raw));
    const index = pending.findIndex((entry) => entry.match(data));
    if (index >= 0) { const [entry] = pending.splice(index, 1); clearTimeout(entry.timer); entry.resolve(data); }
    else queued.push(data);
  });
  return { socket, async ready() { if (socket.readyState !== 1) await once(socket, "open"); },
    wait(match) {
      const index = queued.findIndex(match);
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const entry = { match, resolve, timer: setTimeout(() => { pending.splice(pending.indexOf(entry), 1); reject(new Error("Missing WebSocket message")); }, 3000) };
        pending.push(entry);
      });
    }, send(data) { socket.send(JSON.stringify(data)); } };
}
const rejectedUpgrade = (url, cookie, origin) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
  socket.on("unexpected-response", (req, res) => { res.resume(); req.destroy(); resolve(res.statusCode); });
  socket.on("open", () => { socket.terminate(); reject(new Error("Unexpected authenticated upgrade")); });
  socket.on("error", () => {});
});

test("real same-origin HTTP and WebSocket: two identities, movement, persistence, forging and logout", { timeout: 15000 }, async () => {
  let now = Date.now();
  const store = new GameStore(":memory:", { now: () => now });
  const app = createApp({ store, WebSocketServer, staticRoot: releaseRoot, publicOrigin: "http://127.0.0.1", secure: false });
  app.http.listen(0, "127.0.0.1"); await once(app.http, "listening");
  const origin = `http://127.0.0.1:${app.http.address().port}`;
  app.config.publicOrigin = origin;
  const url = origin.replace("http:", "ws:") + "/ws?room=snej-1";
  const request = async (path, method = "GET", value, cookie = "", suppliedOrigin = origin) => {
    const res = await fetch(origin + path, { method, headers: { Origin: suppliedOrigin, Cookie: cookie, "Content-Type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value) });
    return { status: res.status, data: await res.json(), cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
  };
  try {
    assert.equal((await request("/api/profile")).status, 401);
    assert.equal((await request("/api/register", "POST", { name: "FriendOne", password: "Fixture password one 2026" }, "", "https://malicious.invalid")).status, 403);
    const a = await request("/api/register", "POST", { name: "FriendOne", password: "Fixture password one 2026" });
    const b = await request("/api/register", "POST", { name: "FriendTwo", password: "Fixture password two 2026" });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(a.data.user.id, 2); assert.equal(b.data.user.id, 3);
    assert.equal((await request("/api/register", "POST", { name: "Snejkov", password: "Fixture password owner 2026" })).status, 409);
    assert.equal(await rejectedUpgrade(url, "", origin), 401);
    assert.equal(await rejectedUpgrade(url, a.cookie, "https://malicious.invalid"), 403);
    assert.equal(await rejectedUpgrade(url.replace("snej-1", "other-room"), a.cookie, origin), 404);
    const ca = client(url, a.cookie, origin), cb = client(url, b.cookie, origin);
    await ca.ready(); await cb.ready();
    const wa = await ca.wait((message) => message.t === "welcome");
    const wb = await cb.wait((message) => message.t === "welcome");
    assert.notEqual(wa.clientId, wb.clientId);
    assert.equal(wa.user.id, 2); assert.equal(wb.user.id, 3);
    assert.equal((await ca.wait((message) => message.t === "presence" && message.presence.id === 3)).presence.name, "FriendTwo");
    assert.equal((await cb.wait((message) => message.t === "presence" && message.presence.id === 2)).presence.name, "FriendOne");
    await cb.wait((message) => message.t === "peer.id.assigned");
    cb.send({ t: "hello", claimedId: 1, rank: "developer", name: "Snejkov" });
    assert.equal((await cb.wait((message) => message.t === "peer.id.assigned")).id, 3);
    cb.send({ t: "presence", presence: { ...b.data.state.position, x: 0.25, id: 1, name: "Snejkov", rank: "developer", moving: 1, skinId: "elise" } });
    const moved = await ca.wait((message) => message.t === "presence" && message.presence.x === 0.25);
    assert.equal(moved.presence.id, 3); assert.equal(moved.presence.rank, "player");
    assert.equal(moved.presence.skinId, "man", "Archived cosmetic IDs resolve to the new active model.");
    cb.send({ t: "presence", presence: { ...b.data.state.position, x: 0.35, skinId: "zubenko" } });
    assert.equal((await ca.wait((message) => message.t === "presence" && message.presence.x === 0.35 && message.presence.skinId === "man")).presence.id, 3);
    cb.send({ t: "presence", presence: { ...b.data.state.position, x: 0.25, skinId: "https://untrusted.invalid/model.js" } });
    const fallback = await ca.wait((message) => message.t === "presence" && message.presence.x === 0.25 && message.presence.skinId === "man");
    assert.equal(fallback.presence.id, 3, "Unknown cosmetic IDs cannot change identity or supply asset URLs.");
    cb.send({ t: "presence", presence: { ...b.data.state.position, x: 500 } });
    assert.equal((await cb.wait((message) => message.t === "error")).error, "movement_too_fast");
    const ended = once(cb.socket, "close"); cb.socket.close(); await ended;
    await ca.wait((message) => message.t === "leave" && message.clientId === wb.clientId);
    const durable = await request("/api/profile", "GET", undefined, b.cookie);
    assert.equal(durable.data.state.position.x, 0.25);
    assert.equal(durable.data.user.id, 3);
    const reconnect = client(url, b.cookie, origin); await reconnect.ready();
    const restored = await reconnect.wait((message) => message.t === "welcome");
    assert.equal(restored.user.id, 3); assert.equal(restored.profile.state.position.x, 0.25);
    const closed = once(reconnect.socket, "close");
    assert.equal((await request("/api/logout", "POST", {}, b.cookie)).status, 200);
    await closed;
    assert.equal((await request("/api/profile", "GET", undefined, b.cookie)).status, 401);
    const relogin = await request("/api/login", "POST", { name: "FriendTwo", password: "Fixture password two 2026" });
    assert.equal(relogin.data.user.id, 3);
    assert.equal(relogin.data.state.position.x, 0.25);
    assert.notEqual(relogin.cookie, b.cookie);
    const profile = await request("/api/profile", "GET", undefined, a.cookie);
    assert.equal((await request("/api/profile", "PATCH", { expectedRevision: profile.data.revision, patch: { settings: { coins: 10000 } } }, a.cookie)).status, 400);
    assert.equal((await request("/api/command", "POST", { requestId: "purchase1234", expectedRevision: profile.data.revision, action: "buy", itemId: "rod.fiberglass.5m", coins: 0 }, a.cookie)).status, 400);
    assert.equal((await request("/api/grant-owner", "POST", {}, a.cookie)).status, 404);
    now += 8 * 24 * 60 * 60 * 1000;
    const expired = once(ca.socket, "close"); ca.send({ t: "hello" }); await expired;
    assert.equal((await request("/api/profile", "GET", undefined, a.cookie)).status, 401);
    for (const path of ["/.env", "/.git/config", "/server/admin.mjs", "/src/%2e%2e/server/admin.mjs"]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 404);
    }
    assert.equal((await fetch(origin + "/")).status, 200);
    assert.ok(sessionCookie("fixture", true).includes("HttpOnly; SameSite=Strict"));
    assert.ok(sessionCookie("fixture", true).endsWith("; Secure"));
  } finally { await app.close(); store.close(); }
});
