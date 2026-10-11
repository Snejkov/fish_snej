import { CATALOG, defaultItemId, findItem, RODS } from "./catalog.js";

const DEFAULT_STATE = Object.freeze({
  coins: 100,
  equipped: Object.freeze({ rod: RODS[0].id, line: defaultItemId("line"), hook: defaultItemId("hook"),
    bait: defaultItemId("bait"), lure: null }),
  owned: Object.freeze({ [RODS[0].id]: 1, [defaultItemId("line")]: 1,
    [defaultItemId("hook")]: 1, [defaultItemId("bait")]: CATALOG.bait[0].startingCount })
});
const clone = (value) => JSON.parse(JSON.stringify(value));

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
    return next;
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

  consumeBait() {
    const id = this.state.equipped.bait;
    if (!id || this.countOf(id) <= 0) return false;
    this.state.owned[id] -= 1;
    return true;
  }
}
