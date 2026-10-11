import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const { SnejFishingGame } = await import("../src/game.js");
const { SnejUI } = await import("../src/ui.js");
const { SnejAuth } = await import("../src/auth.js");
const { SnejInventory } = await import("../src/gear/inventory.js");
const { setLanguage, getLanguage, t } = await import("../src/i18n.js");
const game = Object.create(SnejFishingGame.prototype);
game.auth = new SnejAuth();
const inventory = new SnejInventory();
inventory.buy("bait.bread");
inventory.equip("bait.bread");
inventory.saveLoadout("Bread");
const player = { identity: game.auth.createIdentity("Player"), inventory: inventory.serialize(),
  lastPosition: { x: 7, y: 2, z: 9, yaw: 0.3, pitch: -0.2 } };
for (const [stored, expected] of [[undefined, "ru"], ["zh", "ru"], ["en", "en"], ["ru", "ru"]]) {
  const save = game.migrateSave({ version: 5, settings: { lang: stored }, player });
  assert.equal(save.settings.lang, expected);
  assert.deepEqual(save.player.inventory, player.inventory, "Language migration preserves gear and custom sets.");
  assert.deepEqual(save.player.lastPosition, player.lastPosition, "Language migration preserves position.");
  assert.equal(save.player.identity.name, "Player");
}
const languageOnly = game.migrateSave({ version: 5, settings: { lang: "en" } });
assert.equal(languageOnly.player.identity, undefined, "Selecting language before registration cannot create a profile.");
assert.equal(languageOnly.player.lastPosition, null);
game.settings = { lang: "ru" };
game.save = () => {};
game.setSetting("lang", "en");
assert.equal(game.settings.lang, "en");
assert.equal(getLanguage(), "en");
game.setSetting("lang", "zh");
assert.equal(game.settings.lang, "ru");
assert.equal(getLanguage(), "ru");
const validation = { textContent: "", classList: { toggle() {} } };
const button = {};
SnejUI.prototype.validateNameField.call({ game }, { value: "Player" }, validation, button);
assert.equal(validation.textContent, t("Name available."));
assert.equal(button.disabled, false);
setLanguage("en", { persist: false });
SnejUI.prototype.validateNameField.call({ game }, { value: "!" }, validation, button);
assert.equal(validation.textContent, "Use at least 3 characters.");
assert.equal(button.disabled, true);
console.log("Language migration, game settings and localized validation tests passed.");
