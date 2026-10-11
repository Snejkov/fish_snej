import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATALOG } from "../src/gear/catalog.js";
import { SnejAuth } from "../src/auth.js";
import { DICTIONARIES, errorMessage, formatCoins, getLanguage, normalizeLanguage, onLanguageChange, readLanguage, saveLanguage,
  setLanguage, t, translateText } from "../src/i18n.js";

const key = "snejfishing-save-v1";
const values = new Map();
const storage = { getItem: (name) => values.get(name) ?? null, setItem: (name, value) => values.set(name, value) };
assert.equal(getLanguage(), "ru");
assert.equal(readLanguage(storage), "ru");
assert.equal(saveLanguage("en", storage), true);
assert.deepEqual(JSON.parse(storage.getItem(key)), { version: 5, settings: { lang: "en" } });
values.clear();
for (const value of [undefined, null, "zh", "zh-CN", "", "RU", {}]) assert.equal(normalizeLanguage(value), "ru");
assert.deepEqual(Object.keys(DICTIONARIES.ru), Object.keys(DICTIONARIES.en));
for (const [source, target] of Object.entries(DICTIONARIES.ru)) {
  assert.ok(target.length > 0, source);
  assert.deepEqual([...source.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
    [...target.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `Preserve parameters: ${source}`);
}
for (const item of Object.values(CATALOG).flat()) {
  assert.ok(DICTIONARIES.ru[item.name], `Translate item name: ${item.id}`);
  assert.ok(DICTIONARIES.ru[item.description], `Translate item description: ${item.id}`);
}
for (const name of ["", "ab", "a".repeat(21), "1Player", "Player!", "Player"]) {
  const { message } = new SnejAuth().validateName(name);
  assert.ok(DICTIONARIES.ru[message], `Translate validation: ${message}`);
}
const progress = { version: 5, settings: { volume: 0.4, lang: "zh", custom: { value: 7 } },
  player: { identity: { name: "Player" }, inventory: { coins: 75, loadouts: [{ name: "Bread" }] },
    lastPosition: { x: 9, y: 0, z: 12 } }, world: { seed: 42 } };
storage.setItem(key, JSON.stringify(progress));
assert.equal(readLanguage(storage), "ru");
assert.equal(saveLanguage("en", storage), true);
assert.equal(readLanguage(storage), "en");
const saved = JSON.parse(storage.getItem(key));
assert.deepEqual(saved, { ...progress, settings: { ...progress.settings, lang: "en" } });
assert.equal(saveLanguage("ru", storage), true);
assert.deepEqual(JSON.parse(storage.getItem(key)).player, progress.player);
storage.setItem(key, "{broken");
assert.equal(readLanguage(storage), "ru");
assert.equal(saveLanguage("en", storage), false);
assert.equal(storage.getItem(key), "{broken", "Do not overwrite a damaged save.");
const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
assert.equal(readLanguage(blocked), "ru");
assert.equal(saveLanguage("en", blocked), false);
assert.equal(errorMessage(new SyntaxError("Unexpected token"), "Could not import this manifest."), "Could not import this manifest.");
assert.equal(errorMessage(new Error("Texture not found."), "Texture upload failed."), "Texture not found.");
Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked getter"); } });
assert.equal(readLanguage(), "ru");
assert.equal(saveLanguage("en"), false);
delete globalThis.localStorage;
let changes = [];
const unsubscribe = onLanguageChange((lang) => changes.push(lang));
setLanguage("en", { persist: false });
assert.equal(formatCoins(1), "1 coin");
assert.equal(formatCoins(2), "2 coins");
assert.equal(t("Inventory"), "Inventory");
assert.equal(t("{name} saved.", { name: "Bread" }), "Bread saved.");
setLanguage("ru", { persist: false });
assert.equal(formatCoins(1), "1 \u043c\u043e\u043d\u0435\u0442\u0430");
assert.equal(formatCoins(2), "2 \u043c\u043e\u043d\u0435\u0442\u044b");
assert.equal(formatCoins(11), "11 \u043c\u043e\u043d\u0435\u0442");
assert.equal(formatCoins(21), "21 \u043c\u043e\u043d\u0435\u0442\u0430");
assert.equal(formatCoins(112), "112 \u043c\u043e\u043d\u0435\u0442");
assert.equal(t("Inventory"), "\u0418\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u044c");
assert.ok(t("{name} saved.", { name: "Bread" }).includes("Bread"), "Never translate custom names.");
assert.ok(translateText("Bread saved.").includes("Bread"));
assert.ok(translateText("Bread applied. Missing items skipped.").includes("Bread"));
assert.ok(translateText("Earthworm purchased.").includes(t("Earthworm")));
assert.equal(translateText("Depth 0.5 m"), t("Depth {depth} m", { depth: "0.5" }));
assert.equal(translateText("Depth 0.5 m / Line 4 m"), t("Depth {depth} m / Line {length} m", { depth: "0.5", length: "4" }));
assert.equal(translateText("Ready / Water 0.50 m / Bottom contact"), t("Ready / Water {depth} m / Bottom contact", { depth: "0.50" }));
assert.equal(translateText("Bait: Earthworm x10"), t("Bait: {name} x{count}", { name: t("Earthworm"), count: 10 }));
assert.equal(translateText("[V] View: Third Person"), t("[V] View: {view}", { view: t("Third Person") }));
assert.equal(translateText("  Inventory  "), `  ${t("Inventory")}  `);
assert.equal(translateText("Online: my-room"), t("Online: {room}", { room: "my-room" }));
assert.equal(t("inventory.unknown.key"), "", "Do not expose machine keys.");
unsubscribe();
setLanguage("en", { persist: false });
assert.deepEqual(changes, ["en", "ru"]);
assert.equal(translateText("Bait: Earthworm x10"), "Bait: Earthworm x10");
assert.ok(/^[\x00-\x7f]*$/.test(readFileSync(new URL("../src/i18n.js", import.meta.url), "utf8")), "Source stays ASCII.");
console.log("RU/EN dictionaries, default, persistence, progress and names tests passed.");
