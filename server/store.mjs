import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { tokenHash, newToken, SESSION_SECONDS } from "./auth.mjs";
import { RequestError, reject, integer, object, playerName, initialState, patchState, trustedOwnerState, position } from "./validation.mjs";
import { findItem } from "../src/gear/catalog.js";

export const OWNER_GRANT_KEY = "owner-id1-gold-10000-2026-10-12";
export class GameStore {
  constructor(path, { now = () => Date.now() } = {}) {
    this.now = now;
    this.db = new DatabaseSync(path, { timeout: 3000 });
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (![0, 1].includes(version) || (version === 0 && tables.length)) {
      this.db.close();
      throw new Error("Unsupported database schema; explicit reviewed migration is required.");
    }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('player','developer')), credential_hash TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS profiles(user_id INTEGER PRIMARY KEY REFERENCES users(id), schema_version INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL CHECK(coins BETWEEN 0 AND 9007199254740991),
        state_json TEXT NOT NULL, owner_import_verified INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS economy_operations(operation_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        delta INTEGER NOT NULL, balance_before INTEGER NOT NULL, balance_after INTEGER NOT NULL, created_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS commands(user_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(user_id, request_id)) STRICT;
      CREATE TABLE IF NOT EXISTS guest_users(user_id INTEGER PRIMARY KEY REFERENCES users(id), nickname TEXT NOT NULL) STRICT;
      INSERT INTO sqlite_sequence(name,seq) SELECT 'users',1 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='users');
      UPDATE sqlite_sequence SET seq=MAX(seq,1) WHERE name='users'; PRAGMA user_version=1;`);
  }
  close() { this.db.close(); }
  transaction(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
  createUser(name, passwordHash) {
    playerName(name);
    return this.transaction(() => {
      if (this.userByName(name)) reject("name_unavailable", 409);
      const { lastInsertRowid } = this.db.prepare("INSERT INTO users(name,role,credential_hash,created_at) VALUES (?,'player',?,?)").run(name, passwordHash, this.now());
      const id = Number(lastInsertRowid);
      this.db.prepare("INSERT INTO profiles(user_id,coins,state_json,updated_at) VALUES (?,100,?,?)").run(id, JSON.stringify(initialState()), this.now());
      return this.user(id);
    });
  }
  provisionOwner(passwordHash, trustedInput) {
    const baseline = trustedOwnerState(trustedInput);
    return this.transaction(() => {
      const existing = this.user(1);
      if (existing) {
        if (existing.name !== "Snejkov" || existing.role !== "developer" || !this.db.prepare("SELECT owner_import_verified FROM profiles WHERE user_id=1").get()?.owner_import_verified) reject("owner_provision_conflict", 409);
        return { created: false, profile: this.profile(1) };
      }
      if (this.userByName("Snejkov")) reject("owner_provision_conflict", 409);
      this.db.prepare("INSERT INTO users(id,name,role,credential_hash,created_at) VALUES (1,'Snejkov','developer',?,?)").run(passwordHash, this.now());
      this.db.prepare("INSERT INTO profiles(user_id,coins,state_json,owner_import_verified,updated_at) VALUES (1,?,?,1,?)").run(baseline.coins, JSON.stringify(baseline.state), this.now());
      return { created: true, profile: this.profile(1) };
    });
  }
  user(id) { return this.db.prepare("SELECT u.id,COALESCE(g.nickname,u.name) AS name,u.role FROM users u LEFT JOIN guest_users g ON g.user_id=u.id WHERE u.id=?").get(id) || null; }
  createGuest(nickname) {
    playerName(nickname);
    return this.transaction(() => {
      const name = `Guest_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
      const { lastInsertRowid } = this.db.prepare("INSERT INTO users(name,role,credential_hash,created_at) VALUES (?,'player','guest-no-password',?)").run(name, this.now());
      const id = Number(lastInsertRowid);
      this.db.prepare("INSERT INTO guest_users VALUES (?,?)").run(id, nickname);
      this.db.prepare("INSERT INTO profiles(user_id,coins,state_json,updated_at) VALUES (?,100,?,?)").run(id, JSON.stringify(initialState()), this.now());
      return this.user(id);
    });
  }
  userByName(name) { return this.db.prepare("SELECT * FROM users WHERE name=?").get(name) || null; }
  isGuest(id) { return Boolean(this.db.prepare("SELECT 1 FROM guest_users WHERE user_id=?").get(id)); }
  newSession(id) {
    const token = newToken();
    this.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(this.now());
    this.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)").run(tokenHash(token), id, this.now() + SESSION_SECONDS * 1000);
    return token;
  }
  authenticate(token) {
    if (!token) throw new RequestError(401, "login_required");
    const user = this.db.prepare("SELECT u.id,COALESCE(g.nickname,u.name) AS name,u.role FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN guest_users g ON g.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?").get(tokenHash(token), this.now());
    if (!user) throw new RequestError(401, "login_required");
    return user;
  }
  logout(token) { if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token)); }
  profile(id) {
    const row = this.db.prepare("SELECT * FROM profiles WHERE user_id=?").get(id);
    if (!row) reject("profile_not_found", 404);
    return { user: this.user(id), revision: row.revision, schemaVersion: row.schema_version, coins: row.coins, state: JSON.parse(row.state_json) };
  }
  write(id, state, coins, revision) {
    this.db.prepare("UPDATE profiles SET state_json=?,coins=?,revision=?,updated_at=? WHERE user_id=?").run(JSON.stringify(state), coins, revision, this.now(), id);
  }
  patch(id, input) {
    object(input, ["expectedRevision", "patch"]);
    integer(input.expectedRevision);
    return this.transaction(() => {
      const current = this.profile(id);
      if (current.revision !== input.expectedRevision) reject("revision_conflict", 409);
      const next = patchState(current.state, input.patch);
      this.write(id, next, current.coins, current.revision + 1);
      return this.profile(id);
    });
  }
  updatePosition(id, value) {
    const nextPosition = position(value);
    return this.transaction(() => {
      const profile = this.profile(id);
      profile.state.position = nextPosition;
      this.write(id, profile.state, profile.coins, profile.revision + 1);
      return profile.revision + 1;
    });
  }
  command(id, input) {
    object(input, ["requestId", "expectedRevision", "action", "itemId"]);
    if (typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(input.requestId)
      || !["buy", "equip", "consume-bait"].includes(input.action) || typeof input.itemId !== "string") reject();
    integer(input.expectedRevision);
    const payload = JSON.stringify({ action: input.action, itemId: input.itemId });
    return this.transaction(() => {
      const replay = this.db.prepare("SELECT payload FROM commands WHERE user_id=? AND request_id=?").get(id, input.requestId);
      if (replay) {
        if (replay.payload !== payload) reject("operation_conflict", 409);
        return { applied: false, profile: this.profile(id) };
      }
      const current = this.profile(id);
      if (current.revision !== input.expectedRevision) reject("revision_conflict", 409);
      const item = findItem(input.itemId);
      if (!item || item.unlocked === false) reject("unknown_item");
      const inv = current.state.inventory;
      let delta = 0;
      if (input.action === "buy") {
        if (!Number.isSafeInteger(item.price) || item.price < 0) reject("invalid_price");
        if (!item.stackable && inv.owned[item.id] > 0) reject("already_owned", 409);
        if (current.coins < item.price) reject("insufficient_coins", 409);
        const count = inv.owned[item.id] || 0;
        integer(count + 1, 1, 1000000);
        inv.owned[item.id] = item.stackable ? count + 1 : 1;
        delta = -item.price;
      } else if (input.action === "equip") {
        current.state = patchState(current.state, { equipped: { [item.kind]: item.id } });
      } else {
        if (item.kind !== "bait" || inv.equipped.bait !== item.id || !(inv.owned[item.id] > 0)) reject("bait_unavailable", 409);
        inv.owned[item.id] -= 1;
      }
      this.write(id, current.state, current.coins + delta, current.revision + 1);
      if (input.action === "buy") this.db.prepare("INSERT INTO economy_operations VALUES (?,?,?,?,?,?)").run(`purchase:${id}:${input.requestId}`, id, delta, current.coins, current.coins + delta, this.now());
      this.db.prepare("INSERT INTO commands VALUES (?,?,?)").run(id, input.requestId, payload);
      return { applied: true, profile: this.profile(id) };
    });
  }
  grantOwner() {
    return this.transaction(() => {
      const prior = this.db.prepare("SELECT * FROM economy_operations WHERE operation_id=?").get(OWNER_GRANT_KEY);
      if (prior) {
        if (prior.user_id !== 1 || prior.delta !== 10000) reject("operation_conflict", 409);
        return { applied: false, originalBalanceAfter: prior.balance_after, currentBalance: this.profile(1).coins };
      }
      const user = this.user(1);
      const row = this.db.prepare("SELECT owner_import_verified FROM profiles WHERE user_id=1").get();
      if (!user || user.name !== "Snejkov" || user.role !== "developer" || !row?.owner_import_verified) reject("verified_owner_required", 409);
      const before = this.profile(1);
      integer(before.coins + 10000);
      this.write(1, before.state, before.coins + 10000, before.revision + 1);
      this.db.prepare("INSERT INTO economy_operations VALUES (?,?,?,?,?,?)").run(OWNER_GRANT_KEY, 1, 10000, before.coins, before.coins + 10000, this.now());
      return { applied: true, originalBalanceAfter: before.coins + 10000, currentBalance: before.coins + 10000 };
    });
  }
  clientId() { return randomUUID(); }
}
