import test from "node:test";
import assert from "node:assert/strict";
import { SnejDesktopCursor } from "../src/desktopCursor.js";

function fixture() {
  const listeners = {}, docListeners = {};
  let allowed = true, requests = 0, captures = 0, releases = 0, reject;
  const canvas = { requestPointerLock() { requests += 1; return new Promise((resolve, fail) => { reject = fail; }); } };
  const document = { hidden: false, pointerLockElement: null,
    addEventListener: (key, fn) => { docListeners[key] = fn; },
    exitPointerLock() { this.pointerLockElement = null; docListeners.pointerlockchange(); } };
  const cursor = new SnejDesktopCursor({ canvas, canInteract: () => allowed,
    onCapture: () => { captures += 1; }, onRelease: () => { releases += 1; },
    environment: { document, addEventListener: (key, fn) => { listeners[key] = fn; } } });
  const key = (extra = {}) => cursor.handleKey({ code: "Backquote", preventDefault() {}, ...extra });
  return { cursor, canvas, document, key, listeners, docListeners,
    allowed: (value) => { allowed = value; }, reject: () => reject(new Error("denied")),
    counts: () => ({ requests, captures, releases }),
    grant() { document.pointerLockElement = canvas; docListeners.pointerlockchange(); } };
}

test("Physical Backquote toggles actual lock, preserves manual free mode, and ignores text/repeat/menus", () => {
  const f = fixture();
  for (const extra of [{ repeat: true }, { isComposing: true }, { ctrlKey: true },
    { target: { isContentEditable: true } }, { target: { closest: () => ({}) } }]) assert.equal(f.key(extra), false);
  f.allowed(false); assert.equal(f.key(), false); f.allowed(true);
  assert.equal(f.key(), true); f.grant();
  assert.equal(f.document.pointerLockElement, f.canvas);
  assert.equal(f.counts().captures, 1);
  f.key(); assert.equal(f.cursor.free, true); assert.equal(f.document.pointerLockElement, null);
  assert.equal(f.cursor.pending, false);
  assert.equal(f.cursor.captureAutomatically(), false);
  assert.equal(f.counts().requests, 1);
  f.key(); f.grant(); assert.equal(f.counts().requests, 2);
});

test("Rejected lock restores a free cursor and allows a new keyboard retry", async () => {
  const f = fixture(); f.key(); f.reject(); await Promise.resolve();
  assert.equal(f.cursor.free, true); assert.equal(f.cursor.pending, false);
  f.key(); assert.equal(f.counts().requests, 2);
  f.docListeners.pointerlockerror(); assert.equal(f.cursor.pending, false);
  f.canvas.requestPointerLock = () => { throw new Error("unavailable"); };
  assert.equal(f.cursor.capture(), false); assert.equal(f.cursor.free, true);
});

test("Blur, hidden page, Escape, cancelled pending request and a late menu grant never leave capture active", () => {
  for (const action of [f => f.listeners.blur(), f => { f.document.hidden = true; f.docListeners.visibilitychange(); },
    f => f.key(), f => f.allowed(false)]) {
    const f = fixture(); f.key(); action(f); f.grant();
    assert.equal(f.document.pointerLockElement, null);
    assert.equal(f.cursor.pending, false); assert.equal(f.cursor.free, true);
  }
  const f = fixture(); f.key(); f.grant(); f.document.pointerLockElement = null; f.docListeners.pointerlockchange();
  assert.equal(f.cursor.free, true);
});

test("Automatic unlocks can recapture, but manual Backquote free mode survives menus", () => {
  const f = fixture(); f.cursor.captureAutomatically(); f.grant();
  f.cursor.release();
  assert.equal(f.cursor.free, true); assert.equal(f.cursor.manualFree, false);
  assert.equal(f.cursor.captureAutomatically(), true); f.grant();
  assert.equal(f.counts().requests, 2);
  f.key(); assert.equal(f.cursor.manualFree, true);
  f.cursor.release();
  assert.equal(f.cursor.captureAutomatically(), false);
  assert.equal(f.counts().requests, 2);
  f.key(); f.grant(); assert.equal(f.cursor.manualFree, false);
});

test("An obsolete promise rejection cannot release a newer granted capture", async () => {
  const f = fixture(), failures = [];
  f.canvas.requestPointerLock = () => new Promise((resolve, reject) => failures.push(reject));
  f.cursor.captureAutomatically(); f.cursor.release(); f.cursor.captureAutomatically(); f.grant();
  failures[0](new Error("old request")); await Promise.resolve();
  f.docListeners.pointerlockerror();
  assert.equal(f.document.pointerLockElement, f.canvas);
  assert.equal(f.cursor.pending, false); assert.equal(f.cursor.free, false);
});
