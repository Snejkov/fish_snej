import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { moscowHour, SnejWorldClock } from "../src/game/clock.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});
const THREE = await import("three");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { SnejSky } = await import("../src/sky.js");
const { SnejStats } = await import("../src/game/stats.js");
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const noop = () => {};

const originalZone = process.env.TZ;
try {
  for (const zone of ["UTC", "America/Los_Angeles", "Europe/Moscow", "Asia/Novosibirsk", "Pacific/Auckland"]) {
    process.env.TZ = zone;
    for (const month of ["01", "07", "10"]) {
      const noon = Date.parse(`2026-${month}-12T09:00:00Z`);
      near(moscowHour(noon), 12);
      near(moscowHour(noon + 60000), 12 + 1 / 60);
      near(moscowHour(noon + 61500), 12 + 1 / 60 + 1.5 / 3600);
      near(moscowHour(noon + 86400000), 12);
    }
    near(moscowHour(Date.parse("2026-10-12T20:59:59.999Z")), 24 - 0.001 / 3600);
    near(moscowHour(Date.parse("2026-10-12T21:00:00Z")), 0);
    near(moscowHour(Date.parse("2026-10-12T21:01:00Z")), 1 / 60);
  }
} finally {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
}

function makeGame(mode, drawer) {
  const game = {
    mode, state: { clock: 6 }, time: 0, pos: { x: 0, z: 0 }, stats: new SnejStats(),
    worldClock: { refresh: noop, hour: () => moscowHour() },
    sky: new SnejSky(new THREE.Scene()),
    ui: { buildOpen: false, profileOpen: false, inventoryOpen: false, modalOpen: false, updateHUD: noop },
    updateLook: noop, updateMove: noop, updateCamera: noop,
    updateCast(dt) { this.castDt = dt; }, canCast: Game.prototype.canCast,
    updateFloatRig: noop, updateCastVisuals: noop, remoteRoom: { update: noop },
    updateMultiplayer: noop, lastSave: 0, save: noop
  };
  if (drawer) game.ui[drawer] = true;
  return game;
}

const originalNow = Date.now;
let now = Date.parse("2026-10-12T09:00:00Z");
Date.now = () => now;
try {
  for (const mode of ["playing", "paused", "title"]) {
    for (const drawer of [null, "inventoryOpen", "profileOpen", "buildOpen", "modalOpen"]) {
      now = Date.parse("2026-10-12T09:00:00Z");
      const game = makeGame(mode, drawer);
      Game.prototype.update.call(game, 0.1);
      near(game.state.clock, 12);
      const sceneTime = game.time;
      const animationTime = game.sky.mesh.material.uniforms.uTime.value;
      now += 9 * 3600000;
      Game.prototype.update.call(game, 0);
      near(game.state.clock, 21);
      near(game.time, sceneTime);
      near(game.sky.mesh.material.uniforms.uTime.value, animationTime);
      assert.ok(game.sky.sunDir.y < 0, "Sky must use the current clock after inactivity.");
      now += 3 * 3600000;
      Game.prototype.update.call(game, 0.1);
      near(game.state.clock, 0);
      near(game.time, mode === "playing" ? 0.2 : 0);
      near(game.castDt, mode === "playing" && !drawer ? 0.1 : 0);
      assert.equal(game.stats.state.playtimeSec, 0, "Wall-clock gaps must not increase playtime.");
      game.mode = "playing";
      now += 7 * 3600000;
      Game.prototype.update.call(game, 1 / 60);
      near(game.state.clock, 7);
      assert.ok(game.sky.sunDir.y > 0, "Resume must immediately show the current daytime.");
      near(game.sky.mesh.material.uniforms.uTime.value - animationTime, mode === "playing" ? 0.1 + 1 / 60 : 1 / 60);
    }
  }
  const game = makeGame("playing");
  for (let hour = 0; hour <= 24; hour += 1) {
    now = Date.parse("2026-10-12T21:00:00Z") + hour * 3600000;
    Game.prototype.update.call(game, 1 / 60);
    near(game.state.clock, hour % 24);
  }
  now = Date.parse("2026-10-12T03:00:00Z");
  Game.prototype.update.call(game, 0);
  near(game.state.clock, 6);
  near(game.sky.sunDir.y, 0);
  now += 12 * 3600000;
  Game.prototype.update.call(game, 0);
  near(game.state.clock, 18);
  near(game.sky.sunDir.y, 0);
  now -= 3600000;
  Game.prototype.update.call(game, 0);
  near(game.state.clock, 17);
} finally {
  Date.now = originalNow;
}

let elapsed = 1000;
let deviceTime = Date.parse("2026-10-13T16:00:00Z");
let requests = 0;
const clockOptions = { mode: "moscow", deviceNow: () => deviceTime, elapsedNow: () => elapsed };
const serverNow = Date.parse("2026-10-12T09:00:00Z");
const clock = new SnejWorldClock({ ...clockOptions, fetchTime: async (url, options) => {
  requests += 1;
  assert.equal(options.method, "HEAD");
  assert.equal(options.cache, "no-store");
  assert.ok(new URL(url).searchParams.has("clock-sync"));
  elapsed += 100;
  return { ok: true, headers: new Headers({ Date: new Date(serverNow).toUTCString() }) };
} });
near(clock.hour(), 19);
assert.equal(clock.source, "device");
const pending = clock.refresh();
assert.equal(clock.refresh(true), pending, "Concurrent refreshes must share one request.");
assert.equal(await pending, true);
assert.equal(clock.source, "http-date");
near(clock.hour(), 12 + 0.05 / 3600);
clock.refresh();
assert.equal(requests, 1, "Normal frames must not keep requesting server time.");
deviceTime += 7 * 86400000;
elapsed += 60000;
near(clock.hour(), 12 + 60.05 / 3600);
elapsed += 9 * 3600000;
near(clock.hour(), 21 + 60.05 / 3600);
clock.fetchTime = async () => { throw new Error("offline"); };
assert.equal(await clock.refresh(), false);
assert.equal(clock.source, "http-date");
near(clock.hour(), 21 + 60.05 / 3600);
clock.fetchTime = async () => ({ ok: true, headers: new Headers({ Date: "Mon, 12 Oct 2026 21:00:00 GMT" }) });
assert.equal(await clock.refresh(true), true);
near(clock.hour(), 0);
const nextRefresh = elapsed;
clock.fetchTime = async () => { requests += 1; return { ok: true, headers: new Headers({ Date: "Tue, 13 Oct 2026 03:00:00 GMT" }) }; };
elapsed = nextRefresh + 5 * 60000;
assert.equal(await clock.refresh(), true);
near(clock.hour(), 6);

for (const headers of [{}, { Date: "invalid" }, { Date: new Date(serverNow).toUTCString(), Age: "60" },
  { Date: new Date(serverNow).toUTCString(), Age: "invalid" },
  { Date: new Date(serverNow).toUTCString(), "X-Cache": "HIT" },
  { Date: new Date(serverNow).toUTCString(), "CF-Cache-Status": "STALE" }]) {
  const fallback = new SnejWorldClock({ ...clockOptions, fetchTime: async () => ({ ok: true, headers: new Headers(headers) }) });
  assert.equal(await fallback.refresh(), false);
  assert.equal(fallback.source, "device");
  near(fallback.hour(), moscowHour(deviceTime));
}
const offline = new SnejWorldClock({ ...clockOptions, fetchTime: async () => { throw new Error("offline"); } });
assert.equal(await offline.refresh(), false);
assert.equal(offline.source, "device");
near(offline.hour(), moscowHour(deviceTime));

let developmentRequests = 0;
const developmentClock = new SnejWorldClock({ deviceNow: () => deviceTime, elapsedNow: () => elapsed,
  fetchTime: async () => { developmentRequests += 1; return { ok: true, headers: new Headers({ Date: "Mon, 12 Oct 2026 21:00:00 GMT" }) }; }
});
for (const date of ["1990-01-01T21:00:00Z", "2026-10-12T21:00:00Z", "2050-07-12T23:59:59Z"]) {
  deviceTime = Date.parse(date);
  elapsed += 86400000;
  for (const mode of ["playing", "paused", "title"]) {
    const game = makeGame(mode);
    game.worldClock = developmentClock;
    Game.prototype.update.call(game, 0.1);
    near(game.state.clock, 12);
    assert.ok(game.sky.sunDir.y > 0.9);
    near(game.sky.nightAmount, 0);
  }
  developmentClock.refresh(true);
  assert.equal(await developmentClock.sync(), false);
  assert.equal(developmentClock.source, "development-day");
}
assert.equal(developmentRequests, 0, "Development noon must not request server time.");
developmentClock.setMode("moscow");
assert.equal(await developmentClock.refresh(true), true);
near(developmentClock.hour(), 0);
developmentClock.setMode("development-day");
near(developmentClock.hour(), 12);
assert.equal(developmentClock.source, "development-day");
assert.throws(() => developmentClock.setMode("unknown"), RangeError);

let finishClockRequest;
const switchingClock = new SnejWorldClock({ mode: "moscow", deviceNow: () => deviceTime,
  fetchTime: () => new Promise((resolve) => { finishClockRequest = resolve; }) });
const delayedRefresh = switchingClock.refresh();
switchingClock.setMode("development-day");
finishClockRequest({ ok: true, headers: new Headers({ Date: "Mon, 12 Oct 2026 21:00:00 GMT" }) });
await delayedRefresh;
near(switchingClock.hour(), 12);
assert.equal(switchingClock.source, "development-day", "A late server reply must not restore night in development mode.");

console.log("Clock tests passed: fixed development noon, explicit Moscow mode, time zones, midnight, pause/resume, HTTP Date sync, cache rejection, fallback, and independent animation timing.");
