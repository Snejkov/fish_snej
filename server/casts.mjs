import { randomUUID } from "node:crypto";
import { tokenHash } from "./auth.mjs";
import { object, number, reject } from "./validation.mjs";
import { findItem } from "../src/gear/catalog.js";
import { rigForRod } from "../src/floatRig.js";
import { isCastWater } from "./castWorld.mjs";

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_AGE = 30000;
function point(value) {
  object(value, ["x", "y", "z"]);
  return { x: number(value.x, -220, 220), y: number(value.y, -0.03, 0.03), z: number(value.z, -220, 220) };
}
function gear(profile) {
  const { inventory, settings } = profile.state;
  const bait = findItem(inventory.equipped.bait);
  if (!bait || bait.kind !== "bait" || !(inventory.owned[bait.id] > 0)) reject("bait_unavailable", 409);
  for (const slot of ["rod", "line", "hook"]) {
    const item = findItem(inventory.equipped[slot]);
    if (!item || item.kind !== slot || !(inventory.owned[item.id] > 0)) reject("cast_gear_unavailable", 409);
  }
  if (inventory.equipped.lure !== null) reject("cast_gear_unavailable", 409);
  const rod = findItem(inventory.equipped.rod), rig = rigForRod(rod.length, settings.floatDepth);
  if (rig.floatDepth !== settings.floatDepth) reject("depth_out_of_range");
  return { ...inventory.equipped, rodLength: rod.length, lineLength: rig.lineLength,
    floatDepth: rig.floatDepth, castRange: rig.castRange, quality: settings.quality };
}
function publicCast(row) {
  return { castId: row.cast_id, userId: row.user_id, state: row.status, approvedAt: row.approved_at,
    landedAt: row.landed_at, origin: JSON.parse(row.origin_json), target: JSON.parse(row.target_json),
    landing: row.landing_json ? JSON.parse(row.landing_json) : null, gear: JSON.parse(row.gear_json) };
}
function ownedCast(store, userId, token, connectionId, castId) {
  if (typeof castId !== "string" || !ID.test(castId)) reject();
  const row = store.db.prepare("SELECT * FROM casts WHERE cast_id=? AND user_id=? AND session_hash=? AND connection_id=?")
    .get(castId, userId, tokenHash(token), connectionId);
  if (!row) reject("cast_conflict", 409);
  return row;
}

export function approveCast(store, userId, token, connectionId, input) {
  object(input, ["requestId", "target"]);
  if (typeof input.requestId !== "string" || !ID.test(input.requestId)) reject();
  const target = point(input.target); target.y = 0;
  return store.transaction(() => {
    const previous = store.db.prepare("SELECT * FROM casts WHERE user_id=? AND request_id=?").get(userId, input.requestId);
    if (previous) {
      const row = ownedCast(store, userId, token, connectionId, previous.cast_id);
      if (row.target_json !== JSON.stringify(target)) reject("operation_conflict", 409);
      if (row.status !== "approved" || store.now() - row.approved_at > MAX_AGE) reject("cast_expired", 409);
      return publicCast(row);
    }
    const profile = store.profile(userId), equipment = gear(profile), origin = profile.state.position;
    const range = Math.hypot(target.x - origin.x, target.z - origin.z);
    if (range < 1 || range > equipment.castRange + 1e-6 || !isCastWater(target.x, target.z, equipment.quality)) reject("cast_invalid_target");
    store.db.prepare("UPDATE casts SET status='cancelled' WHERE user_id=? AND status='approved'").run(userId);
    const castId = randomUUID(), now = store.now();
    store.db.prepare(`INSERT INTO casts(cast_id,user_id,request_id,session_hash,connection_id,status,approved_at,origin_json,target_json,gear_json)
      VALUES (?,?,?,?,?,'approved',?,?,?,?)`).run(castId, userId, input.requestId, tokenHash(token), connectionId, now,
      JSON.stringify(origin), JSON.stringify(target), JSON.stringify(equipment));
    return publicCast(ownedCast(store, userId, token, connectionId, castId));
  });
}

export function landCast(store, userId, token, connectionId, input) {
  object(input, ["castId", "landing"]);
  const landing = point(input.landing);
  return store.transaction(() => {
    const row = ownedCast(store, userId, token, connectionId, input.castId);
    if (row.status === "landed") {
      if (row.landing_json !== JSON.stringify(landing)) reject("operation_conflict", 409);
      return { applied: false, cast: publicCast(row), profile: store.profile(userId) };
    }
    if (row.status !== "approved" || store.now() - row.approved_at > MAX_AGE) reject("cast_expired", 409);
    if (store.now() - row.approved_at < 50) reject("cast_conflict", 409);
    const profile = store.profile(userId), equipment = gear(profile), target = JSON.parse(row.target_json);
    const origin = JSON.parse(row.origin_json);
    if (row.gear_json !== JSON.stringify(equipment)) reject("cast_conflict", 409);
    if (Math.hypot(landing.x - target.x, landing.z - target.z) > 0.03
      || Math.hypot(landing.x - origin.x, landing.z - origin.z) > equipment.castRange + 1e-6
      || !isCastWater(landing.x, landing.z, equipment.quality)) reject("cast_invalid_target");
    // Bait is consumed atomically once with the successful landing, never on a replay.
    profile.state.inventory.owned[equipment.bait] -= 1;
    store.write(userId, profile.state, profile.coins, profile.revision + 1);
    store.db.prepare("UPDATE casts SET status='landed',landed_at=?,landing_json=? WHERE cast_id=?")
      .run(store.now(), JSON.stringify(landing), row.cast_id);
    return { applied: true, cast: publicCast(ownedCast(store, userId, token, connectionId, row.cast_id)), profile: store.profile(userId) };
  });
}

export function cancelCast(store, userId, token, connectionId, input) {
  object(input, ["castId"]);
  const row = ownedCast(store, userId, token, connectionId, input.castId);
  if (row.status === "approved") store.db.prepare("UPDATE casts SET status='cancelled' WHERE cast_id=?").run(row.cast_id);
  return { ok: true };
}
