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
      assert.equal(mobile.hidden, state === "wait");
      assert.equal(mobile.disabled, !enabled || state === "flight");
      assert.equal(Boolean(game.castInstruction.textContent), session);
    }
  } finally { globalThis.document = originalDocument; }
});

test("Mobile landed and retrieving states expose one Retrieve action and restore Run/Cast only on idle", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { documentElement: { classList: classes() } };
  const mobile = { dataset: {} }, run = {}, retrieve = {}, view = {}, squint = {};
  const controls = { querySelector: selector => ({ "[data-mobile-cast]": mobile, "[data-mobile-run]": run,
    "[data-mobile-retrieve]": retrieve, "[data-mobile-action='view']": view, "[data-mobile-squint]": squint })[selector] };
  const game = { cast: { state: {} }, castActions: { classList: classes() }, castCancelButton: { classList: classes() },
    castInstruction: {}, ui: { el: { mobileControls: controls } } };
  try {
    for (const enabled of [true, false]) for (const [fs, retrieving, pending] of [
      ["idle", false, false], ["charge", false, false], ["flight", false, false],
      ["wait", false, true], ["wait", false, false], ["flight", true, false], ["idle", false, false]
    ]) {
      game.cast.state = { fs, retrieving }; game.castLanding = pending;
      Game.prototype.updateCastControls.call(game, enabled);
      const retrieval = fs === "wait" || retrieving;
      assert.equal(mobile.hidden, retrieval); assert.equal(run.hidden, retrieval);
      assert.equal(retrieve.hidden, !retrieval);
      assert.equal(retrieve.disabled, !enabled || fs !== "wait" || pending);
      assert.equal(squint.hidden, !enabled || fs !== "wait" || retrieving);
      assert.equal(squint.disabled, pending);
    }
    for (const lang of ["ru", "en"]) {
      setLanguage(lang, { persist: false });
      assert.equal(t("Retrieve"), lang === "en" ? "Retrieve" : "\u0412\u044b\u0442\u0430\u0449\u0438\u0442\u044c");
      assert.equal(t("Squint"), lang === "en" ? "Squint" : "\u041f\u0440\u0438\u0449\u0443\u0440\u0438\u0442\u044c\u0441\u044f");
    }
  } finally { globalThis.document = originalDocument; setLanguage("ru", { persist: false }); }
});

test("Pending release reports server latency, never a pre-launch turn; flight hides the cast banner", () => {
  const originalDocument = globalThis.document;
  globalThis.document = { documentElement: { classList: classes() } };
  const game = { cast: { state: { fs: "charge" } }, castActions: { classList: classes() },
    castCancelButton: { classList: classes() }, castInstruction: {}, ui: { el: {} },
    castRelease: { approved: false }, castTurn: { duration: 0.65, elapsed: 0 } };
  try {
    setLanguage("en", { persist: false });
    Game.prototype.updateCastControls.call(game, true);
    assert.equal(game.castInstruction.textContent, "Waiting for server...");
    game.castTurn.elapsed = 0.65;
    Game.prototype.updateCastControls.call(game, true);
    assert.equal(game.castInstruction.textContent, "Waiting for server...");
    game.castTurn.elapsed = 60;
    Game.prototype.updateCastControls.call(game, true);
    assert.equal(game.castInstruction.textContent, "Waiting for server...");
    game.castRelease.approved = true;
    Game.prototype.updateCastControls.call(game, true);
    assert.equal(game.castInstruction.textContent, "");
    game.cast.state.fs = "flight";
    game.castTurn.elapsed = 0;
    Game.prototype.updateCastControls.call(game, true);
    assert.equal(game.castInstruction.textContent, "");
    game.castRelease = game.castTurn = null; game.cast.state.fs = "idle";
    Game.prototype.updateCastControls.call(game, true);
    assert.equal(game.castInstruction.textContent, "");
  } finally { globalThis.document = originalDocument; setLanguage("ru", { persist: false }); }
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
