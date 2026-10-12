import { findItem } from "../src/gear/catalog.js";
import { SPAWNS } from "../src/spawns.js";

export class RequestError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const reject = (code = "invalid_request", status = 400) => { throw new RequestError(status, code); };
export const clone = (value) => JSON.parse(JSON.stringify(value));
export function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) reject();
  return value;
}
export function number(value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) reject();
  return value;
}
export function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value)) reject();
  return number(value, min, max);
}
export function playerName(value, owner = false) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{2,19}$/.test(value)) reject("invalid_name");
  if (!owner && value.replace(/[_-]/g, "").toLowerCase() === "snejkov") reject("reserved_name", 409);
  return value;
}
export function position(value) {
  object(value, ["x", "y", "z", "yaw", "pitch", "view"]);
  return { x: number(value.x, -500, 500), y: number(value.y, -40, 80), z: number(value.z, -500, 500),
    yaw: number(value.yaw, -10000, 10000), pitch: number(value.pitch, -Math.PI / 2, Math.PI / 2),
    view: ["first-person", "third-person"].includes(value.view) ? value.view : reject() };
}
export function settings(value, previous = {}) {
  object(value, ["volume", "bgm", "sens", "quality", "shadow", "floatDepth", "lang", "autoSprint"]);
  const next = { ...previous };
  for (const [key, item] of Object.entries(value)) {
    if (["volume", "bgm"].includes(key)) next[key] = number(item, 0, 1);
    else if (key === "sens") next[key] = number(item, 0.1, 3);
    else if (key === "floatDepth") next[key] = number(item, 0, 5.75);
    else if (["shadow", "autoSprint"].includes(key)) next[key] = typeof item === "boolean" ? item : reject();
    else if (key === "quality") next[key] = ["low", "mid", "high"].includes(item) ? item : reject();
    else if (key === "lang") next[key] = ["ru", "en"].includes(item) ? item : reject();
  }
  return next;
}
export function equipped(value, owned, previous = {}, allowEmptyBait = false) {
  object(value, ["rod", "line", "hook", "bait", "lure"]);
  const next = { ...previous };
  for (const [slot, id] of Object.entries(value)) {
    if (slot === "lure") { if (id !== null) reject("lure_casting_unavailable"); next.lure = null; continue; }
    const item = findItem(id);
    const depletedSelection = allowEmptyBait && slot === "bait" && Object.hasOwn(owned, id) && owned[id] === 0;
    if (!item || item.kind !== slot || (!(owned[id] > 0) && !depletedSelection)) reject("item_not_owned");
    next[slot] = id;
  }
  return next;
}
export function clothing(value) {
  object(value, ["head", "torso", "legs", "feet"]);
  // No clothing items exist in the current authoritative catalog.
  if (Object.values(value).some((item) => item !== null)) reject("clothing_not_owned");
  return { head: null, torso: null, legs: null, feet: null };
}
export function loadouts(value, inventory) {
  if (!Array.isArray(value) || value.length > 12) reject();
  const ids = new Set();
  return value.map((entry) => {
    object(entry, ["id", "name", "equipped", "clothing"]);
    if (typeof entry.id !== "string" || !/^[a-z0-9._-]{1,64}$/i.test(entry.id) || ids.has(entry.id)
      || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 24) reject();
    ids.add(entry.id);
    return { id: entry.id, name: entry.name.trim(), equipped: equipped(entry.equipped, inventory.owned, inventory.equipped, true),
      clothing: clothing(entry.clothing) };
  });
}
export function initialState() {
  return { position: { ...SPAWNS.initial, view: "third-person" }, settings: { volume: 0.7, bgm: 0, sens: 1, quality: "mid", shadow: true, floatDepth: 0.5, lang: "ru", autoSprint: false },
    inventory: { owned: { "rod.bamboo.4m": 1, "line.mono.0.20": 1, "hook.single.8": 1, "bait.earthworm": 10 },
      equipped: { rod: "rod.bamboo.4m", line: "line.mono.0.20", hook: "hook.single.8", bait: "bait.earthworm", lure: null },
      clothing: clothing({}), loadouts: [] }, stats: {}, catchLog: [] };
}
export function patchState(state, patch) {
  object(patch, ["position", "settings", "equipped", "clothing", "loadouts"]);
  const next = clone(state);
  if (patch.position !== undefined) next.position = position(patch.position);
  if (patch.settings !== undefined) next.settings = settings(patch.settings, next.settings);
  if (patch.equipped !== undefined) next.inventory.equipped = equipped(patch.equipped, next.inventory.owned, next.inventory.equipped);
  if (patch.clothing !== undefined) next.inventory.clothing = clothing(patch.clothing);
  if (patch.loadouts !== undefined) next.inventory.loadouts = loadouts(patch.loadouts, next.inventory);
  const rod = findItem(next.inventory.equipped.rod);
  if (next.settings.floatDepth > rod.length - 0.25) reject("depth_out_of_range");
  return next;
}
export function trustedOwnerState(input) {
  object(input, ["coins", "state"]);
  integer(input.coins);
  object(input.state, ["position", "settings", "inventory", "stats", "catchLog"]);
  const inv = object(input.state.inventory, ["owned", "equipped", "clothing", "loadouts"]);
  if (!inv.owned || typeof inv.owned !== "object" || Array.isArray(inv.owned)) reject();
  const owned = {};
  for (const [id, quantity] of Object.entries(inv.owned)) {
    const item = findItem(id);
    if (!item) reject("unknown_item");
    owned[id] = integer(quantity, 0, item.stackable ? 1000000 : 1);
  }
  const state = initialState();
  state.inventory.owned = owned;
  state.inventory.equipped = equipped(inv.equipped, owned, {}, true);
  if (!["rod", "line", "hook", "bait"].every((key) => state.inventory.equipped[key])) reject("incomplete_inventory");
  state.inventory.clothing = clothing(inv.clothing);
  state.inventory.loadouts = loadouts(inv.loadouts, state.inventory);
  state.position = position(input.state.position);
  state.settings = settings(input.state.settings);
  if (!input.state.stats || typeof input.state.stats !== "object" || Array.isArray(input.state.stats)
    || !Array.isArray(input.state.catchLog) || Buffer.byteLength(JSON.stringify(input.state)) > 65536) reject();
  state.stats = clone(input.state.stats);
  state.catchLog = clone(input.state.catchLog);
  return { coins: input.coins, state: patchState(state, {}) };
}
