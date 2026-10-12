import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { GameStore, OWNER_GRANT_KEY } from "../store.mjs";
import { initialState } from "../validation.mjs";
import { hashPassword, verifyPassword } from "../auth.mjs";

const trusted = () => ({ coins: 137, state: initialState() });
const failure = (code) => (error) => error.code === code;
function disk(t) {
  const root = mkdtempSync(join(tmpdir(), "snej-server-"));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir(), "snej-server-"))); rmSync(root, { recursive: true }); });
  return { root, db: join(root, "game.sqlite") };
}

test("reserved identity, registration, expiry, logout and durable sessions", async (t) => {
  const { db } = disk(t);
  let now = 100000;
  let store = new GameStore(db, { now: () => now });
  const first = store.createUser("FriendOne", "fixture-hash");
  assert.equal(first.id, 2);
  for (const name of ["Snejkov", "SNEJKOV", "Snej_kov", "Snej-kov"]) assert.throws(() => store.createUser(name, "fixture-hash"), failure("reserved_name"));
  const token = store.newSession(first.id);
  assert.equal(store.authenticate(token).id, 2);
  assert.equal(store.db.prepare("SELECT token_hash FROM sessions").get().token_hash.includes(token), false);
  store.close();
  store = new GameStore(db, { now: () => now });
  assert.equal(store.authenticate(token).id, 2);
  now += 8 * 24 * 60 * 60 * 1000;
  assert.throws(() => store.authenticate(token), failure("login_required"));
  const fresh = store.newSession(first.id);
  store.logout(fresh);
  assert.throws(() => store.authenticate(fresh), failure("login_required"));
  store.close();
});

test("password KDF, salt, bounds, malformed hash and constant comparison", async () => {
  const password = "Fixture password only 2026";
  const a = await hashPassword(password), b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword("Different fixture password", a), false);
  assert.equal(await verifyPassword(password, "scrypt.broken"), false);
  await assert.rejects(hashPassword("short"));
});

test("trusted owner baseline and grant preserve all non-currency state", (t) => {
  const { db } = disk(t);
  let store = new GameStore(db);
  const input = trusted();
  input.state.inventory.owned["rod.fiberglass.5m"] = 1;
  input.state.inventory.equipped.rod = "rod.fiberglass.5m";
  input.state.inventory.loadouts = [{ id: "set.saved", name: "Lake set", equipped: input.state.inventory.equipped, clothing: input.state.inventory.clothing }];
  input.state.settings.lang = "en";
  input.state.stats = { playtime: 540 };
  const provision = store.provisionOwner("trusted-owner-fixture", input);
  assert.equal(provision.profile.coins, 137);
  const before = store.profile(1);
  const second = store.createUser("FriendTwo", "fixture-hash");
  const otherBefore = store.profile(second.id);
  assert.equal(store.grantOwner().applied, true);
  const after = store.profile(1);
  assert.equal(after.coins, 10137);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(store.profile(second.id), otherBefore);
  assert.throws(() => store.patch(1, { expectedRevision: before.revision, patch: { settings: { lang: "ru" } } }), failure("revision_conflict"));
  assert.equal(store.provisionOwner("changed-fixture-password", trusted()).created, false);
  assert.equal(store.userByName("Snejkov").credential_hash, "trusted-owner-fixture");
  const purchased = store.command(1, { requestId: "purchase0001", expectedRevision: after.revision, action: "buy", itemId: "bait.corn" });
  assert.equal(purchased.profile.coins, 10133);
  store.close();
  store = new GameStore(db);
  assert.deepEqual(store.grantOwner(), { applied: false, originalBalanceAfter: 10137, currentBalance: 10133 });
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM economy_operations WHERE operation_id=?").get(OWNER_GRANT_KEY).n, 1);
  store.close();
});

test("missing owner, injected ledger failure, overflow and conflicting ledger do not credit", () => {
  const store = new GameStore(":memory:");
  assert.throws(() => store.grantOwner(), failure("verified_owner_required"));
  store.provisionOwner("fixture-hash", trusted());
  store.db.exec("CREATE TRIGGER fail_ledger BEFORE INSERT ON economy_operations BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(() => store.grantOwner());
  assert.equal(store.profile(1).coins, 137);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM economy_operations").get().n, 0);
  store.db.exec("DROP TRIGGER fail_ledger");
  store.db.prepare("UPDATE profiles SET coins=? WHERE user_id=1").run(Number.MAX_SAFE_INTEGER);
  assert.throws(() => store.grantOwner(), failure("invalid_request"));
  assert.equal(store.profile(1).coins, Number.MAX_SAFE_INTEGER);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM economy_operations").get().n, 0);
  store.db.prepare("INSERT INTO economy_operations VALUES (?,1,1,0,1,0)").run(OWNER_GRANT_KEY);
  assert.throws(() => store.grantOwner(), failure("operation_conflict"));
  store.close();
});

test("trusted depleted bait and recorded loadouts migrate without refilling or permitting consumption", () => {
  const store = new GameStore(":memory:"), input = trusted();
  input.state.inventory.owned["bait.earthworm"] = 0;
  input.state.inventory.loadouts = [{ id: "depleted.saved", name: "Empty bait set", equipped: input.state.inventory.equipped, clothing: {} }];
  const before = store.provisionOwner("fixture-hash", input).profile;
  assert.equal(before.state.inventory.owned["bait.earthworm"], 0);
  assert.equal(before.state.inventory.loadouts[0].equipped.bait, "bait.earthworm");
  store.grantOwner();
  assert.deepEqual(store.profile(1).state, before.state);
  assert.throws(() => store.command(1, { requestId: "depleted0001", expectedRevision: 1, action: "consume-bait", itemId: "bait.earthworm" }), failure("bait_unavailable"));
  assert.equal(store.profile(1).state.inventory.owned["bait.earthworm"], 0);
  store.close();
});

test("profile and command allowlists prevent nested balance, ownership, role and identity forgery", () => {
  const store = new GameStore(":memory:"), user = store.createUser("FriendSafe", "fixture-hash");
  const before = store.profile(user.id);
  for (const patch of [{ coins: 10000 }, { inventory: { owned: { "rod.carbon.6m": 1 } } }, { settings: { coins: 5 } },
    { settings: { role: "developer" } }, { position: { ...before.state.position, id: 1 } }, { clothing: { torso: "free-shirt" } },
    { loadouts: [{ id: "forged", name: "Forged", equipped: { rod: "rod.carbon.6m" }, clothing: {} }] }]) {
    assert.throws(() => store.patch(user.id, { expectedRevision: 0, patch }));
    assert.deepEqual(store.profile(user.id), before);
  }
  const command = { requestId: "request00001", expectedRevision: 0, action: "buy", itemId: "rod.fiberglass.5m" };
  assert.throws(() => store.command(user.id, { ...command, price: 0 }));
  const bought = store.command(user.id, command);
  assert.equal(bought.profile.coins, 50);
  assert.equal(bought.profile.state.inventory.owned[command.itemId], 1);
  assert.equal(store.command(user.id, command).applied, false);
  assert.throws(() => store.command(user.id, { ...command, itemId: "bait.corn" }), failure("operation_conflict"));
  const result = store.command(user.id, { requestId: "equip0000001", expectedRevision: 1, action: "equip", itemId: command.itemId });
  assert.equal(result.profile.state.inventory.equipped.rod, command.itemId);
  assert.throws(() => store.command(user.id, { requestId: "buy000000002", expectedRevision: 2, action: "buy", itemId: "rod.carbon.6m" }), failure("insufficient_coins"));
  assert.equal(store.profile(user.id).coins, 50);
  const loadout = { id: "my.saved", name: "Saved", equipped: result.profile.state.inventory.equipped, clothing: {} };
  const saved = store.patch(user.id, { expectedRevision: 2, patch: { loadouts: [loadout], settings: { lang: "en" }, position: { ...before.state.position, x: 10 } } });
  assert.equal(saved.state.inventory.loadouts.length, 1);
  assert.equal(saved.state.settings.lang, "en");
  assert.equal(saved.coins, 50);
  store.close();
});

test("three independent CLI processes apply the one owner grant only once", async (t) => {
  const { db, root } = disk(t), store = new GameStore(db);
  store.provisionOwner("fixture-hash", trusted());
  store.close();
  const launch = () => new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [new URL("../admin.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "grant-owner"],
      { env: { ...process.env, SNEJ_DATA_DIR: root }, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", rejectResult);
    child.on("close", (code) => code === 0 ? resolveResult(JSON.parse(stdout)) : rejectResult(new Error(stderr)));
  });
  const outcomes = await Promise.all([launch(), launch(), launch()]);
  assert.equal(outcomes.filter((item) => item.applied).length, 1);
  const reopened = new GameStore(db);
  assert.equal(reopened.profile(1).coins, 10137);
  assert.equal(reopened.db.prepare("SELECT count(*) AS n FROM economy_operations").get().n, 1);
  reopened.close();
});
