import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { SnejFishingGame: Game } = await import("../src/game.js");
const { setLanguage, t } = await import("../src/i18n.js");

function classes() {
  const values = new Set();
  return { toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); }, contains: name => values.has(name) };
}

test("The screen Cast button belongs only to the native mobile controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ui = await readFile(new URL("../src/ui.js", import.meta.url), "utf8");
  const game = await readFile(new URL("../src/game.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="cast-start"/);
  assert.doesNotMatch(game, /castStartButton/);
  assert.match(ui, /class="mobile-control-button mobile-cast" data-mobile-cast/);
});

test("Cast instructions and cancellation show only during an active cast session", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { documentElement: { classList: classes() } };
  const mobile = { dataset: {}, textContent: "", disabled: false };
  const game = { cast: { state: {} }, castActions: { classList: classes() },
    castCancelButton: { classList: classes() }, castInstruction: {},
    ui: { el: { mobileControls: { querySelector: selector => selector === "[data-mobile-cast]" ? mobile : null } } } };
  try {
    setLanguage("en", { persist: false });
    for (const enabled of [true, false]) for (const state of ["idle", "aim", "charge", "flight", "wait"]) {
      game.cast.state.fs = state;
      Game.prototype.updateCastControls.call(game, enabled);
      const session = ["aim", "charge"].includes(state);
      assert.equal(game.castActions.classList.contains("hidden"), !enabled || !session);
      assert.equal(game.castCancelButton.classList.contains("hidden"), !session);
      assert.equal(document.documentElement.classList.contains("cast-session"), enabled && session);
      assert.equal(mobile.dataset.i18n, "Cast");
      assert.equal(mobile.textContent, t(mobile.dataset.i18n));
      assert.equal(mobile.disabled, state === "flight");
      assert.equal(Boolean(game.castInstruction.textContent), session);
    }
  } finally { globalThis.document = originalDocument; }
});

test("Desktop casting updates without requiring a mobile button", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { documentElement: { classList: classes() } };
  try {
    const game = { cast: { state: { fs: "aim" } }, castActions: { classList: classes() },
      castCancelButton: { classList: classes() }, castInstruction: {}, ui: { el: {} } };
    Game.prototype.updateCastControls.call(game, true);
    assert.equal(game.castActions.classList.contains("hidden"), false);
    assert.equal(game.castInstruction.textContent, t("Move the circle, then click or lift your finger to cast."));
  } finally { globalThis.document = originalDocument; }
});
