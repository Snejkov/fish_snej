import assert from "node:assert/strict";
import { SnejInventory } from "../src/gear/inventory.js";
import { findItem } from "../src/gear/catalog.js";
import { SnejUI } from "../src/ui.js";

const inventory = new SnejInventory();
const ui = { inventoryOpen: true, game: { inventory, cast: { state: { fs: "idle" } } } };
const canDrop = (id, kind) => SnejUI.prototype.canDropGear.call(ui, findItem(id), kind);
assert.equal(canDrop("rod.bamboo.4m", "rod"), true);
assert.equal(canDrop("rod.bamboo.4m", "hook"), false, "A rod cannot be dropped into a hook slot.");
assert.equal(canDrop("rod.fiberglass.5m", "rod"), false, "Unowned items cannot be equipped by dragging.");
assert.equal(canDrop("unknown", "rod"), false);
for (const state of ["charge", "flight"]) {
  ui.game.cast.state.fs = state;
  assert.equal(canDrop("rod.bamboo.4m", "rod"), false, "Flight/charge equipment lock applies to drag-and-drop.");
}
ui.game.cast.state.fs = "idle";
assert.equal(inventory.buy("rod.fiberglass.5m").ok, true);
assert.equal(canDrop("rod.fiberglass.5m", "rod"), true);
assert.equal(inventory.equip("rod.fiberglass.5m").ok, true);
assert.equal(new SnejInventory(inventory.serialize()).equippedRod().length, 5);
assert.equal(inventory.buy("lure.spinner.5g").ok, true);
assert.equal(canDrop("lure.spinner.5g", "lure"), false, "Stored lures do not unlock Stage 5B casting.");
assert.equal(inventory.equippedLure(), null);
ui.inventoryOpen = false;
assert.equal(canDrop("rod.fiberglass.5m", "rod"), false);
console.log("Equipment slot validation tests passed.");
