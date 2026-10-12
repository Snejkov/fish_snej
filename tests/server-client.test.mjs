import test from "node:test";
import assert from "node:assert/strict";
import { SnejServerClient, editableProfile, profileDifference, createOperationId } from "../src/serverClient.js";

const profile = (revision = 1) => ({ user: { id: 2, name: "LakeTester", role: "player" }, revision, coins: 100,
  state: { settings: { lang: "ru", volume: 0.7, bgm: 0, sens: 1, quality: "mid", shadow: true, floatDepth: 0.5, autoSprint: false },
    inventory: { owned: { bait: 0 }, equipped: { bait: "bait" }, clothing: {}, loadouts: [] } } });
const response = (value, status = 200) => ({ ok: status === 200, status, json: async () => value });

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
