import test from "node:test";
import assert from "node:assert/strict";
import { SnejServerClient, AccountError, editableProfile, profileDifference, createOperationId } from "../src/serverClient.js";
import { setLanguage, t } from "../src/i18n.js";

const profile = (revision = 1) => ({ user: { id: 2, name: "LakeTester", role: "player" }, revision, coins: 100,
  state: { settings: { lang: "ru", volume: 0.7, bgm: 0, sens: 1, quality: "mid", shadow: true, floatDepth: 0.5, fishingUnitsVersion: 2, autoSprint: false },
    inventory: { owned: { bait: 0 }, equipped: { bait: "bait" }, clothing: {}, loadouts: [] } } });
const response = (value, status = 200) => ({ ok: status === 200, status, json: async () => value });

test("bait, gear and lake-connection errors have distinct RU/EN feedback without retrying or altering inventory", async () => {
  const cases = [
    ["bait_unavailable", "No bait.", "\u041d\u0435\u0442 \u043d\u0430\u0436\u0438\u0432\u043a\u0438."],
    ["out_of_bait", "No bait.", "\u041d\u0435\u0442 \u043d\u0430\u0436\u0438\u0432\u043a\u0438."],
    ["cast_gear_unavailable", "Check your equipped fishing gear.", "\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u0443\u044e \u043e\u0441\u043d\u0430\u0441\u0442\u043a\u0443."],
    ["cast_unavailable", "Reconnect to the lake before casting.", "\u041f\u0435\u0440\u0435\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u0435\u0441\u044c \u043a \u043e\u0437\u0435\u0440\u0443 \u043f\u0435\u0440\u0435\u0434 \u0437\u0430\u0431\u0440\u043e\u0441\u043e\u043c."]
  ];
  try {
    for (const [code, english, russian] of cases) {
      let requests = 0;
      const client = new SnejServerClient({ fetcher: async () => { requests += 1; return response({ error: code }, 409); } });
      client.accept(profile(), "restore"); const before = structuredClone(client.profile);
      await assert.rejects(client.beginCast({ x: 1, y: 0, z: 2 }), error => {
        assert.ok(error instanceof AccountError); assert.equal(error.code, code); assert.equal(error.message, english);
        setLanguage("en", { persist: false }); assert.equal(t(error.message), english);
        setLanguage("ru", { persist: false }); assert.equal(t(error.message), russian);
        return true;
      });
      assert.equal(requests, 1); assert.deepEqual(client.profile, before);
    }
  } finally { setLanguage("ru", { persist: false }); }
});

test("cast adapter retries the same intent and landing IDs after a lost response", async () => {
  const calls = []; let lostStart = true, lostLand = true;
  const client = new SnejServerClient({ requestId: () => "stable_cast_0001", fetcher: async (path, options) => {
    const value = JSON.parse(options.body); calls.push({ path, value });
    if (path === "/api/cast/start") {
      if (lostStart) { lostStart = false; throw new Error("Lost response"); }
      return response({ castId: "server_cast_0001" });
    }
    if (lostLand) { lostLand = false; throw new Error("Lost landing response"); }
    return response({ applied: false, profile: profile(2) });
  } });
  client.accept(profile(), "restore");
  const target = { x: 1, y: 0, z: 2 }, ticket = await client.beginCast(target);
  assert.deepEqual(calls[0], calls[1]);
  await client.landCast(ticket.castId, target);
  assert.deepEqual(calls[2], calls[3]); assert.equal(client.profile.revision, 2);
  assert.deepEqual(Object.keys(calls[0].value), ["requestId", "target"]);
  assert.deepEqual(Object.keys(calls[2].value), ["castId", "landing"]);
});

test("HTTP-compatible operation IDs do not require secure-context randomUUID", () => {
  const random = { getRandomValues(bytes) { bytes.fill(171); return bytes; } };
  assert.equal(createOperationId(random), "ab".repeat(16));
  assert.match(createOperationId(), /^[a-f0-9]{32}$/);
  assert.notEqual(createOperationId(), createOperationId());
});

test("static hosting remains local, authenticated hosting restores a server profile", async () => {
  const staticClient = new SnejServerClient({ fetcher: async () => response({}, 404) });
  assert.equal(await staticClient.probe(), false);
  assert.equal(staticClient.profile, null);
  const events = [];
  const online = new SnejServerClient({ fetcher: async (path) => response(path === "/healthz"
    ? { mode: "authenticated-game" } : profile()), onProfile: (p, kind) => events.push(kind) });
  assert.equal(await online.probe(), true);
  assert.deepEqual(events, ["restore"]);
  assert.equal(online.profile.user.id, 2);
  const unavailable = new SnejServerClient({ fetcher: async () => { throw new Error("Offline"); } });
  await assert.rejects(unavailable.probe(), { code: "network_error" });
});

test("editable snapshots never upload balances, ownership, rank, statistics or password", () => {
  const source = profile();
  const game = { settings: { ...source.state.settings, password: "must-not-travel" }, inventory: {
    serialize: () => ({ ...source.state.inventory, coins: 999999, role: "developer" }) } };
  const desired = editableProfile(game);
  assert.deepEqual(Object.keys(desired), ["settings", "equipped", "clothing", "loadouts"]);
  assert.ok(!JSON.stringify(desired).includes("password"));
  assert.ok(!JSON.stringify(desired).includes("999999"));
  assert.deepEqual(profileDifference(desired, source), {});
  desired.settings.lang = "en";
  const diff = profileDifference(desired, source);
  assert.deepEqual(Object.keys(diff), ["settings"]);
  assert.equal(diff.equipped, undefined, "Unchanged depleted bait is not submitted as a new equipment claim");
});

test("queued save merges a movement revision conflict and command retries keep their operation ID", async () => {
  const calls = [];
  let conflict = true;
  const client = new SnejServerClient({ requestId: () => "fixture-operation", fetcher: async (path, options) => {
    const value = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, value, credentials: options.credentials });
    if (path === "/api/profile" && options.method === "GET") return response(profile(3));
    if (conflict) { conflict = false; return response({ error: "revision_conflict" }, 409); }
    if (path === "/api/command") return response({ applied: true, profile: profile(value.expectedRevision + 1) });
    return response({ ...profile(value.expectedRevision + 1), state: { ...profile().state, settings: value.patch.settings } });
  } });
  client.enabled = true; client.accept(profile(), "restore");
  const desired = { settings: { ...profile().state.settings, lang: "en" }, ...profile().state.inventory };
  await client.save(desired);
  assert.equal(client.profile.state.settings.lang, "en");
  assert.equal(calls[2].value.expectedRevision, 3);
  conflict = true;
  await client.command("buy", "rod.bamboo.4m");
  const commands = calls.filter((call) => call.path === "/api/command");
  assert.equal(commands.length, 2);
  assert.equal(commands[0].value.requestId, commands[1].value.requestId);
  assert.ok(calls.every((call) => call.credentials === "same-origin"));
  assert.ok(calls.every((call) => !JSON.stringify(call.value).includes("coins")));
});

test("session expiry stops writes and logout clears browser account state", async () => {
  let expired = true;
  const client = new SnejServerClient({ fetcher: async (path) => path === "/api/logout"
    ? response({ ok: true }) : expired ? response({ error: "authentication_required" }, 401) : response(profile()) });
  client.accept(profile(), "restore");
  await assert.rejects(client.command("buy", "rod.bamboo.4m"), { status: 401 });
  expired = false;
  await client.logout();
  assert.equal(client.profile, null);
  assert.equal(client.revision, 0);
});
