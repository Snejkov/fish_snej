import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const { SnejUI } = await import("../src/ui.js");
const { SnejMultiplayerClient } = await import("../src/multiplayer/client.js");
const { SnejFishingGame } = await import("../src/game.js");
const { SnejRemotePlayerRoom } = await import("../src/multiplayer/room.js");

test("a connected paused player stays visible after five seconds until authoritative leave", () => {
  const original = globalThis.performance;
  let now = 0;
  globalThis.performance = { now: () => now };
  try {
    const room = new SnejRemotePlayerRoom();
    room.applyPresence({ clientId: "real-peer-3", presence: { id: 3, name: "PausedPlayer", rank: "player", x: 2, y: 1, z: 3 } });
    now = 6000;
    room.update(0.1);
    assert.equal(room.listPeers().length, 1);
    assert.equal(room.listPeers()[0].id, 3);
    assert.ok(room.players.get("real-peer-3").model.userData.materials.every((material) => material.opacity === 1));
    room.remove("real-peer-3");
    assert.equal(room.listPeers().length, 0);
  } finally { globalThis.performance = original; }
});

class Element {
  children = [];
  dataset = {};
  hidden = true;
  classList = { toggle: (name, value) => { if (name === "hidden") this.hidden = value; } };
  replaceChildren() { this.children = []; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  cloneNode() { const clone = new Element(); clone.children = this.children.map((child) => child.cloneNode()); clone.textContent = this.textContent; return clone; }
}
test("Tab roster opens/closes and updates genuine peer rows without translating nicknames", () => {
  const elements = Object.fromEntries(["online-roster", "roster-players", "roster-count", "roster-status"].map((id) => [id, new Element()]));
  const previous = globalThis.document;
  globalThis.document = { getElementById: (id) => elements[id], createElement: () => new Element() };
  try {
    const ui = Object.create(SnejUI.prototype);
    ui.rosterOpen = false;
    ui.el = { peerSection: new Element(), peerList: new Element() };
    ui.game = { multiplayer: { connected: true }, refreshPeerList() { ui.updatePeerList([{ id: 2, name: "Player", rank: "player" }, { id: 3, name: "LakeGuest", rank: "player" }]); } };
    ui.toggleRoster();
    assert.equal(ui.rosterOpen, true);
    assert.equal(elements["online-roster"].hidden, false);
    assert.equal(elements["roster-count"].textContent, "2");
    assert.equal(elements["roster-players"].children[0].children[0].textContent, "[#2] Player");
    assert.equal(ui.el.peerList.children[0].children[0].dataset.i18nSkip, "true");
    ui.updatePeerList([{ id: 2, name: "Player", rank: "player" }]);
    assert.equal(elements["roster-count"].textContent, "1");
    ui.toggleRoster();
    assert.equal(elements["online-roster"].hidden, true);
  } finally { globalThis.document = previous; }
});

test("authenticated connect waits for welcome, revisions reach adapter, and reconnect does not emit false Offline", () => {
  const previousLocation = globalThis.location, previousWebSocket = globalThis.WebSocket;
  const statuses = [], revisions = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    handlers = {};
    addEventListener(type, fn) { this.handlers[type] = fn; }
    close() {}
    send() {}
  }
  globalThis.location = { protocol: "http:", hostname: "localhost", host: "localhost:8000", search: "" };
  globalThis.WebSocket = Socket;
  try {
    const client = new SnejMultiplayerClient({ authenticated: true, onStatus: (status) => statuses.push(status), onRevision: (revision) => revisions.push(revision) });
    assert.equal(client.connect("snej-1", { id: 2, name: "Player" }, "player"), true);
    client.socket.handlers.open();
    assert.equal(client.connected, false);
    client.handleMessage(JSON.stringify({ t: "welcome", clientId: "server-client", profile: {} }));
    assert.equal(client.connected, true);
    client.handleMessage(JSON.stringify({ t: "profile.revision", revision: 5 }));
    assert.deepEqual(revisions, [5]);
    client.reconnect({ id: 2, name: "Player" }, "player");
    assert.equal(statuses.includes("Offline"), false);
  } finally { globalThis.location = previousLocation; globalThis.WebSocket = previousWebSocket; }
});

test("server restore preserves exact owned items, depleted bait, named sets and server role without local starter grants", () => {
  const game = Object.create(SnejFishingGame.prototype);
  const inventory = { owned: { "rod.fiberglass.5m": 1, "line.mono.0.30": 1, "hook.single.8": 1, "bait.bread": 0 },
    equipped: { rod: "rod.fiberglass.5m", line: "line.mono.0.30", hook: "hook.single.8", bait: "bait.bread", lure: null },
    clothing: { head: null, torso: null, legs: null, feet: null }, loadouts: [{ id: "long-original-set-id-123456789012345", name: "My Favorite Set", equipped: {}, clothing: {} }] };
  const profile = { user: { id: 2, name: "LakeGuest", role: "player" }, coins: 77, state: { inventory, stats: {}, catchLog: [], settings: { lang: "ru" } } };
  game.applyServerProfile(profile, "restore");
  assert.deepEqual(game.inventory.state.owned, inventory.owned);
  assert.equal(game.inventory.state.owned["rod.bamboo.4m"], undefined);
  assert.equal(game.inventory.state.owned["bait.bread"], 0);
  assert.equal(game.inventory.state.loadouts[0].id, inventory.loadouts[0].id);
  assert.equal(game.inventory.coins(), 77);
  assert.equal(game.currentRank, "player");
  assert.equal(game.identity.id, 2);
});
