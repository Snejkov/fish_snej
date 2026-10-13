import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appleHomeScreenState, configureAppleHomeScreen } from "../src/appleHomeScreen.js";
import { setLanguage, t } from "../src/i18n.js";
const env = (userAgent, platform = "", maxTouchPoints = 0, standalone = false) => ({
  navigator: { userAgent, platform, maxTouchPoints, standalone }, matchMedia: () => ({ matches: false })
});
const devices = [
  [env("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5), true],
  [env("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", "iPad", 5), true],
  [env("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", "MacIntel", 5), true],
  [env("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15", "MacIntel", 0), false],
  [env("Mozilla/5.0 (Linux; Android 15) Chrome/140.0", "Linux armv8l", 5), false],
  [env("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 10), false]
];
test("Apple mobile detection includes desktop-style iPads, not touch PCs, Macs or Android", () => {
  for (const [environment, appleMobile] of devices) {
    assert.deepEqual(appleHomeScreenState(environment), { appleMobile, standalone: false });
  }
  assert.deepEqual(appleHomeScreenState({}), { appleMobile: false, standalone: false });
});

test("Standalone mode is gated by Apple mobile identity for either supported browser signal", () => {
  for (const [environment, appleMobile] of devices) {
    environment.navigator.standalone = true;
    assert.equal(appleHomeScreenState(environment).standalone, appleMobile);
    environment.navigator.standalone = false;
    environment.matchMedia = query => ({ matches: query === "(display-mode: standalone)" });
    assert.equal(appleHomeScreenState(environment).standalone, appleMobile);
    environment.matchMedia = () => ({ matches: false });
  }
});

test("Manual guide is shown only in Apple launchers and is hidden in installed or other-device sessions", () => {
  for (const [environment, appleMobile] of devices) {
    const guides = [{ hidden: true }, { hidden: true }], classes = new Map();
    environment.document = { documentElement: { classList: { toggle: (name, value) => classes.set(name, value) } },
      querySelectorAll: selector => { assert.equal(selector, ".apple-home-guide"); return guides; } };
    configureAppleHomeScreen(environment);
    assert.ok(guides.every(guide => guide.hidden === !appleMobile));
    assert.equal(classes.get("apple-home-screen"), false);
    environment.navigator.standalone = true;
    configureAppleHomeScreen(environment);
    assert.ok(guides.every(guide => guide.hidden));
    assert.equal(classes.get("apple-home-screen"), appleMobile);
    environment.navigator.standalone = false;
  }
});

test("The Apple-only shell supplies metadata and a real PNG without shared install or offline hooks", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const module = readFileSync(new URL("../src/appleHomeScreen.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/mobile.css", import.meta.url), "utf8");
  const icon = readFileSync(new URL("../icons/apple-touch-icon.png", import.meta.url));
  for (const [name, content] of [["apple-mobile-web-app-capable", "yes"], ["apple-mobile-web-app-title", "SnejFishing"],
    ["apple-mobile-web-app-status-bar-style", "black-translucent"]]) {
    assert.ok(html.includes(`<meta name="${name}" content="${content}">`));
  }
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\.\/icons\/apple-touch-icon\.png\?v=apple-home-1"/);
  assert.match(html, /configureAppleHomeScreen\(\)/);
  assert.doesNotMatch(html + module, /rel="manifest"|beforeinstallprompt|serviceWorker|caches\.|localStorage|fetch\(|requestFullscreen/);
  assert.match(css, /html\.apple-home-screen \{ height: 100dvh; \}/);
  assert.match(css, /html\.apple-home-screen \.screen/);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.toString("ascii", 12, 16), "IHDR");
  assert.equal(icon.readUInt32BE(16), 180); assert.equal(icon.readUInt32BE(20), 180);
  assert.ok(icon.length > 1000, "The app icon cannot be the old one-pixel favicon.");
  for (const source of [html, module, css]) assert.doesNotMatch(source, /[^\x00-\x7f]/);
});

test("Manual install and separate-session cautions translate in both supported game languages", () => {
  for (const lang of ["en", "ru"]) {
    setLanguage(lang, { persist: false });
    for (const key of ["Play from your Home Screen",
      "In Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if shown.",
      "Internet is required. If your saved profile is missing after adding the app, return to Safari instead of creating a new profile."]) {
      const text = t(key); assert.ok(text);
      if (lang === "ru") assert.notEqual(text, key); else assert.equal(text, key);
    }
  }
  setLanguage("ru", { persist: false });
});
