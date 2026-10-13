import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { createApp } from "../app.mjs";
import { GameStore } from "../store.mjs";
import { releaseRoot } from "../paths.mjs";
import { SnejServerClient, editableProfile } from "../../src/serverClient.js";
import { SnejInventory } from "../../src/gear/inventory.js";

let WebSocket, WebSocketServer;
try { ({ WebSocket, WebSocketServer } = await import("ws")); }
catch (error) {
  if (!process.env.SNEJ_TEST_WS_BUNDLE) throw error;
  const bundled = createRequire(import.meta.url)(process.env.SNEJ_TEST_WS_BUNDLE);
  WebSocket = bundled.ws; WebSocketServer = bundled.wsServer;
}
function peer(url, cookie, origin) {
  const socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
  const messages = [], pending = [];
  socket.on("message", (raw) => {
    const value = JSON.parse(String(raw));
    const index = pending.findIndex((entry) => entry.match(value));
    if (index < 0) messages.push(value);
    else { const [entry] = pending.splice(index, 1); clearTimeout(entry.timeout); entry.resolve(value); }
  });
  return { socket, wait(match) {
    const index = messages.findIndex(match);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const entry = { match, resolve, timeout: setTimeout(() => { pending.splice(pending.indexOf(entry), 1); reject(new Error("Presence missing")); }, 3000) };
      pending.push(entry);
    });
  } };
}

for (const guestOnly of [false, true]) test(`actual adapter API (${guestOnly ? "guest nicknames" : "internal accounts"}): shared presence, gear, reconnect and restart`, { timeout: 15000 }, async () => {
  const folder = mkdtempSync(join(tmpdir(), "snej-client-integration-"));
  const database = join(folder, "fixture.sqlite");
  let store, app, origin;
  const start = async (port = 0) => {
    store = new GameStore(database);
    app = createApp({ store, WebSocketServer, staticRoot: releaseRoot, publicOrigin: "http://127.0.0.1", secure: false, guestOnly });
    app.http.listen(port, "127.0.0.1"); await once(app.http, "listening");
    origin = `http://127.0.0.1:${app.http.address().port}`; app.config.publicOrigin = origin;
  };
  const account = (initialCookie = "") => {
    let cookie = initialCookie;
    const client = new SnejServerClient({ fetcher: async (path, options = {}) => {
      // The durability fixture restarts on the same port; do not reuse a closed keep-alive socket.
      const response = await fetch(origin + path, { ...options,
        headers: { ...options.headers, Cookie: cookie, Origin: origin, Connection: "close" } });
      const next = response.headers.get("set-cookie");
      if (next) cookie = next.split(";")[0];
      return response;
    } });
    return { client, cookie: () => cookie };
  };
  try {
    await start();
    const first = account(), second = account();
    await first.client.probe(); await second.client.probe();
    if (guestOnly) {
      await first.client.enterGuest("LakeGuest");
      await second.client.enterGuest("LakeGuest");
      assert.equal(first.client.profile.user.name, second.client.profile.user.name, "A nickname is cosmetic, not a unique account claim");
      assert.equal(first.client.profile.user.role, "player");
      assert.equal(store.userByName("LakeGuest"), null);
      await assert.rejects(first.client.request("/api/guest", "POST", { name: "Snejkov" }), { status: 409 });
      await assert.rejects(first.client.request("/api/guest", "POST", { name: "OtherNick", id: 1, rank: "developer", coins: 10000 }), { status: 400 });
      await assert.rejects(first.client.request("/api/login", "POST", { name: "Snejkov", password: "Must never be read" }), { status: 404 });
      await assert.rejects(first.client.request("/api/register", "POST", { name: "OtherNick", password: "Must never be read" }), { status: 404 });
      const normal = store.createUser("NormalAccount", "unused-normal-password-hash");
      const normalClient = account(`snej_session=${store.newSession(normal.id)}`);
      await normalClient.client.probe();
      assert.equal(normalClient.client.profile, null, "Guest-only HTTP cannot restore a normal account");
    } else {
      await first.client.authenticate("BrowserOne", "Local fixture password one 2026", true);
      await second.client.authenticate("BrowserTwo", "Local fixture password two 2026", true);
    }
    assert.equal(first.client.profile.user.id, 2); assert.equal(second.client.profile.user.id, 3);
    const url = origin.replace("http:", "ws:") + "/ws?room=snej-1";
    const a = peer(url, first.cookie(), origin), b = peer(url, second.cookie(), origin);
    const wa = await a.wait((v) => v.t === "welcome"), wb = await b.wait((v) => v.t === "welcome");
    assert.equal(wa.room, wb.room);
    await a.wait((v) => v.t === "presence" && v.presence.id === 3);
    await b.wait((v) => v.t === "presence" && v.presence.id === 2);
    if (guestOnly) {
      await new Promise((done) => setTimeout(done, 6000));
      assert.equal((await first.client.request("/healthz")).peers, 2, "Paused/idle sockets stay connected without movement packets");
    }
    a.socket.send(JSON.stringify({ t: "presence", presence: { ...wa.profile.state.position, x: 0.25, moving: 1 } }));
    assert.equal((await b.wait((v) => v.t === "presence" && v.presence.x === 0.25)).presence.id, 2);
    await first.client.command("buy", "rod.fiberglass.5m");
    await first.client.command("equip", "rod.fiberglass.5m");
    const inv = new SnejInventory({ ...first.client.profile.state.inventory, coins: first.client.profile.coins });
    inv.saveLoadout("My Lakeside Set");
    assert.equal(first.client.profile.state.settings.autoSprint, false);
    await assert.rejects(first.client.save({ ...editableProfile({ inventory: inv, settings: first.client.profile.state.settings }),
      settings: { ...first.client.profile.state.settings, autoSprint: "true" } }), { status: 400 });
    const desired = editableProfile({ inventory: inv, settings: { ...first.client.profile.state.settings, lang: "en", floatDepth: 0.75, autoSprint: true } });
    await first.client.save(desired);
    await first.client.command("consume-bait", "bait.earthworm");
    const coins = first.client.profile.coins;
    assert.equal(first.client.profile.state.inventory.owned["bait.earthworm"], 9);
    const ended = once(a.socket, "close"); a.socket.close(); await ended;
    await b.wait((v) => v.t === "leave" && v.clientId === wa.clientId);
    const reconnect = peer(url, first.cookie(), origin);
    const restored = await reconnect.wait((v) => v.t === "welcome");
    assert.equal(restored.user.id, 2); assert.equal(restored.profile.state.position.x, 0.25);
    assert.equal(restored.profile.coins, coins);
    const port = app.http.address().port;
    await app.close(); store.close(); app = null; store = null;
    await start(port);
    const unfamiliar = account();
    await unfamiliar.client.probe();
    assert.equal(unfamiliar.client.profile, null, "An unfamiliar browser has no signed-in profile");
    const returned = account(guestOnly ? first.cookie() : "");
    await returned.client.probe();
    if (!guestOnly) await returned.client.authenticate("BrowserOne", "Local fixture password one 2026");
    const persisted = returned.client.profile;
    assert.equal(persisted.user.id, 2);
    assert.equal(persisted.coins, coins);
    assert.equal(persisted.state.position.x, 0.25);
    assert.equal(persisted.state.settings.lang, "en");
    assert.equal(persisted.state.settings.floatDepth, 0.75);
    assert.equal(persisted.state.settings.autoSprint, true);
    assert.equal(persisted.state.inventory.equipped.rod, "rod.fiberglass.5m");
    assert.equal(persisted.state.inventory.loadouts[0].name, "My Lakeside Set");
    const remembered = account(guestOnly ? second.cookie() : "");
    await remembered.client.probe();
    if (!guestOnly) await remembered.client.authenticate("BrowserTwo", "Local fixture password two 2026");
    await remembered.client.probe();
    assert.equal(remembered.client.profile.user.id, 3);
    assert.equal(remembered.client.profile.coins, 100);
  } finally {
    if (app) await app.close();
    store?.close();
    if (dirname(resolve(folder)) !== resolve(tmpdir()) || !basename(folder).startsWith("snej-client-integration-")) throw new Error("Unsafe fixture cleanup target");
    rmSync(folder, { recursive: true, force: true });
  }
});
