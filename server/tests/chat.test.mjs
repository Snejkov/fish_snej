import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createApp } from "../app.mjs";
import { GameStore } from "../store.mjs";
import { releaseRoot } from "../paths.mjs";

let WebSocket, WebSocketServer;
try { ({ WebSocket, WebSocketServer } = await import("ws")); }
catch (error) {
  if (!process.env.SNEJ_TEST_WS_BUNDLE) throw error;
  const bundled = createRequire(import.meta.url)(process.env.SNEJ_TEST_WS_BUNDLE);
  WebSocket = bundled.ws; WebSocketServer = bundled.wsServer;
}

function client(url, cookie, origin) {
  const socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
  const messages = [], pending = [];
  socket.on("message", (raw) => {
    const value = JSON.parse(String(raw)); messages.push(value);
    const entry = pending.find((v) => v.match(value));
    if (entry) { pending.splice(pending.indexOf(entry), 1); clearTimeout(entry.timer); entry.resolve(value); }
  });
  return { socket, messages, send(value) { socket.send(JSON.stringify(value)); }, wait(match) {
    const existing = messages.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entry = { match, resolve, timer: setTimeout(() => {
        pending.splice(pending.indexOf(entry), 1); reject(new Error("Missing chat message"));
      }, 3000) }; pending.push(entry);
    });
  } };
}

test("four real guests: local radius, all-map global, identity protection, live movement and flood errors", { timeout: 10000 }, async () => {
  const store = new GameStore(":memory:");
  const app = createApp({ store, WebSocketServer, staticRoot: releaseRoot, publicOrigin: "http://127.0.0.1", secure: false, guestOnly: true });
  app.http.listen(0, "127.0.0.1"); await once(app.http, "listening");
  const origin = `http://127.0.0.1:${app.http.address().port}`; app.config.publicOrigin = origin;
  const peers = [];
  try {
    for (const [name, x, z] of [["ChatSender", 0, 0], ["ChatBoundary", 60, 80], ["ChatOutside", 100.01, 0], ["ChatDistant", -300, 200]]) {
      const user = store.createGuest(name);
      store.updatePosition(user.id, { x, y: 0, z, yaw: 0, pitch: 0, view: "third-person" });
      const peer = client(origin.replace("http:", "ws:") + "/ws?room=snej-1", `snej_session=${store.newSession(user.id)}`, origin);
      const welcome = await peer.wait((v) => v.t === "welcome");
      peers.push({ ...peer, welcome });
    }
    const [sender, boundary, outside, distant] = peers;
    sender.send({ t: "chat", channel: "local", text: "  Nearby only  ", id: 1, name: "Forged", rank: "developer", x: 500, radius: 10000 });
    const local = await boundary.wait((v) => v.t === "chat" && v.text === "Nearby only");
    assert.equal(local.channel, "local"); assert.equal(local.id, sender.welcome.user.id);
    assert.equal(local.name, "ChatSender"); assert.equal(local.rank, "player");
    await sender.wait((v) => v.t === "chat" && v.text === "Nearby only");
    sender.send({ t: "chat", channel: "global", text: "All map one" });
    for (const peer of peers) await peer.wait((v) => v.t === "chat" && v.text === "All map one");
    for (const peer of [outside, distant]) assert.equal(peer.messages.some((v) => v.text === "Nearby only"), false);
    outside.send({ t: "presence", presence: { ...outside.welcome.profile.state.position, x: 100, moving: 1 } });
    await sender.wait((v) => v.t === "presence" && v.clientId === outside.welcome.clientId && v.presence.x === 100);
    sender.send({ t: "chat", channel: "local", text: "New boundary" });
    await outside.wait((v) => v.t === "chat" && v.text === "New boundary");
    sender.send({ t: "chat", channel: "global", text: "All map two" });
    for (const peer of peers) await peer.wait((v) => v.t === "chat" && v.text === "All map two");
    assert.equal(distant.messages.some((v) => v.text === "New boundary"), false);
    sender.send({ t: "chat", channel: "team", text: "Bad channel" });
    assert.equal((await sender.wait((v) => v.t === "chat.error" && v.error === "invalid_chat")).error, "invalid_chat");
    sender.send({ t: "chat", channel: "global", text: "Too much" });
    await sender.wait((v) => v.t === "chat.error" && v.error === "chat_rate_limited");
    assert.equal(sender.socket.readyState, 1, "Chat throttling must not end the game connection");
    sender.send({ t: "presence", presence: { ...sender.welcome.profile.state.position, x: 0.1, moving: 1 } });
    await boundary.wait((v) => v.t === "presence" && v.clientId === sender.welcome.clientId && v.presence.x === 0.1);
    boundary.send({ t: "chat", text: "Legacy global" });
    await distant.wait((v) => v.t === "chat" && v.channel === "global" && v.text === "Legacy global");
    for (const text of [" ", "x".repeat(241), 123]) {
      boundary.send({ t: "chat", channel: "global", text });
    }
    await boundary.wait((v) => v.t === "chat.error" && v.error === "invalid_chat");
  } finally { await app.close(); store.close(); }
});
