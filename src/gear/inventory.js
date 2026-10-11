import { CATALOG, defaultItemId, findItem, RODS } from "./catalog.js";

export const CLOTHING_SLOTS = Object.freeze([
  Object.freeze({ id: "head", label: "Head" }),
  Object.freeze({ id: "torso", label: "Upper Body" }),
  Object.freeze({ id: "legs", label: "Legs" }),
  Object.freeze({ id: "feet", label: "Footwear" })
]);
const GEAR_SLOTS = Object.freeze(["rod", "line", "hook", "bait", "lure"]);
const NAMED_GEAR_SLOTS = Object.freeze(["rod", "line", "hook", "bait"]);
const DEFAULT_CLOTHING = Object.freeze(Object.fromEntries(CLOTHING_SLOTS.map((slot) => [slot.id, null])));
const DEFAULT_STATE = Object.freeze({
  coins: 100,
  equipped: Object.freeze({ rod: RODS[0].id, line: defaultItemId("line"), hook: defaultItemId("hook"),
    bait: defaultItemId("bait"), lure: null }),
  clothing: DEFAULT_CLOTHING,
  loadouts: Object.freeze([]),
  owned: Object.freeze({ [RODS[0].id]: 1, [defaultItemId("line")]: 1,
    [defaultItemId("hook")]: 1, [defaultItemId("bait")]: CATALOG.bait[0].startingCount })
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const loadoutId = () => `loadout.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
const cleanName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
const validClothingSlot = (slot) => CLOTHING_SLOTS.some((item) => item.id === slot);
const cleanClothingValue = (value) => typeof value === "string" && /^[a-z0-9._-]{1,48}$/i.test(value) ? value : null;

export class SnejInventory {
  constructor(initial = null) {
    this.state = this._migrate(initial?.state || initial);
  }

  _migrate(raw) {
    const next = clone(DEFAULT_STATE);
    if (!raw || typeof raw !== "object") return next;
    if (Number.isFinite(raw.coins)) next.coins = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(raw.coins)));
    if (raw.owned && typeof raw.owned === "object") {
      for (const [id, count] of Object.entries(raw.owned)) {
        const item = findItem(id);
        if (!item || !Number.isSafeInteger(count) || count < 0) continue;
        // Zero bait is real saved progress, not a missing default to refill.
        next.owned[id] = item.stackable ? count : Math.min(1, count);
      }
    }
    for (const kind of ["rod", "line", "hook"]) next.owned[defaultItemId(kind)] = 1;
    for (const kind of ["rod", "line", "hook", "bait"]) {
      const item = findItem(raw.equipped?.[kind]);
      if (item?.kind === kind && (next.owned[item.id] > 0 || kind === "bait")) next.equipped[kind] = item.id;
    }
    // Lure-only casting is reserved for Stage 5B; purchases can already be stored.
    next.equipped.lure = null;
    next.clothing = this._migrateClothing(raw.clothing);
    next.loadouts = this._migrateLoadouts(raw.loadouts, next);
    return next;
  }

  _migrateClothing(raw) {
    const clothing = clone(DEFAULT_CLOTHING);
    if (!raw || typeof raw !== "object") return clothing;
    for (const slot of CLOTHING_SLOTS) clothing[slot.id] = cleanClothingValue(raw[slot.id]);
    return clothing;
  }

  _migrateLoadouts(raw, state) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const loadouts = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const name = cleanName(entry.name);
      if (!name) continue;
      const id = cleanName(entry.id).replace(/[^a-z0-9._-]/gi, "") || loadoutId();
      if (seen.has(id)) continue;
      const equipped = {};
      for (const kind of NAMED_GEAR_SLOTS) {
        const item = findItem(entry.equipped?.[kind]);
        equipped[kind] = item?.kind === kind ? item.id : state.equipped[kind];
      }
      equipped.lure = null;
      loadouts.push({ id, name, equipped, clothing: this._migrateClothing(entry.clothing) });
      seen.add(id);
      if (loadouts.length >= 12) break;
    }
    return loadouts;
  }

  serialize() { return clone(this.state); }
  coins() { return this.state.coins; }
  owns(id) { return this.countOf(id) > 0; }
  countOf(id) { return this.state.owned[id] || 0; }
  equippedRod() { return findItem(this.state.equipped.rod) || RODS[0]; }
  equippedBait() { return findItem(this.state.equipped.bait); }
  equippedLure() { return this.state.equipped.lure ? findItem(this.state.equipped.lure) : null; }
  equippedLine() { return findItem(this.state.equipped.line); }
  equippedHook() { return findItem(this.state.equipped.hook); }

  addCoins(delta) {
    if (!Number.isFinite(delta)) return false;
    const value = Math.floor(delta);
    if (!value || !Number.isSafeInteger(this.state.coins + value)) return false;
    this.state.coins = Math.max(0, this.state.coins + value);
    return true;
  }

  buy(itemId) {
    const item = findItem(itemId);
    if (!item) return { ok: false, message: "Unknown item." };
    if (item.unlocked === false) return { ok: false, message: "Item is locked." };
    if (this.owns(itemId) && !item.stackable) return { ok: false, message: "Already owned." };
    if (this.state.coins < item.price) return { ok: false, message: "Not enough coins." };
    this.state.coins -= item.price;
    this.state.owned[itemId] = item.stackable ? this.countOf(itemId) + 1 : 1;
    return { ok: true, message: `${item.name} purchased.` };
  }

  equip(itemId) {
    const item = findItem(itemId);
    if (!item) return { ok: false, message: "Unknown item." };
    if (!this.owns(itemId)) return { ok: false, message: "Item is not owned." };
    if (item.kind === "lure") return { ok: false, message: "Lure casting arrives in Stage 5B." };
    this.state.equipped[item.kind] = itemId;
    return { ok: true, message: `${item.name} equipped.` };
  }

  saveLoadout(name) {
    const clean = cleanName(name);
    if (!clean) return { ok: false, message: "Name the set first." };
    const snapshot = {
      rod: this.state.equipped.rod,
      line: this.state.equipped.line,
      hook: this.state.equipped.hook,
      bait: this.state.equipped.bait,
      lure: null
    };
    const existing = this.state.loadouts.find((item) => item.name.toLowerCase() === clean.toLowerCase());
    const record = { id: existing?.id || loadoutId(), name: clean, equipped: snapshot, clothing: clone(this.state.clothing) };
    this.state.loadouts = existing
      ? this.state.loadouts.map((item) => item.id === existing.id ? record : item)
      : [...this.state.loadouts, record].slice(-12);
    return { ok: true, message: existing ? `${clean} updated.` : `${clean} saved.` };
  }

  applyLoadout(id) {
    const loadout = this.state.loadouts.find((item) => item.id === id);
    if (!loadout) return { ok: false, message: "Set not found." };
    const missing = [];
    for (const kind of GEAR_SLOTS) {
      const item = findItem(loadout.equipped?.[kind]);
      if (!item || item.kind !== kind || kind === "lure") continue;
      if (!this.owns(item.id)) {
        missing.push(item.name);
        continue;
      }
      this.state.equipped[kind] = item.id;
    }
    this.state.equipped.lure = null;
    for (const [slot, value] of Object.entries(loadout.clothing || {})) {
      if (validClothingSlot(slot)) this.state.clothing[slot] = cleanClothingValue(value);
    }
    return {
      ok: true,
      message: missing.length ? `${loadout.name} applied. Missing items skipped.` : `${loadout.name} applied.`,
      missing
    };
  }

  deleteLoadout(id) {
    const before = this.state.loadouts.length;
    this.state.loadouts = this.state.loadouts.filter((item) => item.id !== id);
    return before !== this.state.loadouts.length
      ? { ok: true, message: "Set deleted." }
      : { ok: false, message: "Set not found." };
  }

  consumeBait() {
    const id = this.state.equipped.bait;
    if (!id || this.countOf(id) <= 0) return false;
    this.state.owned[id] -= 1;
    return true;
  }
}
