import assert from "node:assert/strict";
import { MobileInputState, SnejMobileInput, combinedMovement, joystickAxes, movementInput, requestLandscape, touchControlsAvailable } from "../src/mobileInput.js";
import { moveDelta } from "../src/util.js";

const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-9, `${value} != ${expected}`);
const capabilities = (coarse, anyCoarse, points) => ({
  navigator: { maxTouchPoints: points },
  matchMedia: (query) => ({ matches: query === "(pointer: coarse)" ? coarse : anyCoarse })
});
assert.equal(touchControlsAvailable(capabilities(false, false, 0)), false);
assert.equal(touchControlsAvailable(capabilities(true, true, 5)), true);
assert.equal(touchControlsAvailable(capabilities(false, true, 10)), true, "An attached mouse does not remove tablet controls.");
assert.equal(touchControlsAvailable(capabilities(false, false, 10)), false, "Touch points alone must not replace a fine-pointer desktop interface.");
assert.equal(touchControlsAvailable({}), false);
assert.equal(touchControlsAvailable({ navigator: { maxTouchPoints: 5 }, matchMedia: (query) => ({ matches: query === "(hover: none)" }) }), true,
  "A touch-only device remains discoverable when coarse-pointer queries are inaccurate.");
assert.equal(touchControlsAvailable({ navigator: { maxTouchPoints: 0 }, matchMedia: () => ({ matches: true }) }), true);

const centered = joystickAxes(0, 0, 50);
assert.deepEqual(centered, { mx: 0, mz: 0, x: 0, y: 0 });
near(Math.hypot(joystickAxes(3, -3, 50).mx, joystickAxes(3, -3, 50).mz), 0);
const slow = joystickAxes(0, -28, 50);
near(slow.mx, 0);
near(slow.mz, 0.5);
const far = joystickAxes(300, -400, 50);
near(Math.hypot(far.mx, far.mz), 1);
near(Math.hypot(far.x, far.y), 50);
assert.deepEqual(joystickAxes(NaN, Infinity, 50), centered);

const input = new MobileInputState();
assert.equal(input.beginStick(0, 100, 72, 100, 100, 50), true);
assert.equal(input.beginLook(1, 600, 200), true);
assert.equal(input.beginLook(0, 600, 200), false, "The movement finger cannot also own camera look.");
assert.equal(input.beginStick(2, 100, 50, 100, 100, 50), false, "Extra fingers cannot steal the joystick.");
assert.equal(input.beginLook(2, 600, 200), false, "Extra fingers cannot steal the camera.");
near(input.axes.mz, 0.5);
input.moveLook(1, 625, 190);
input.moveLook(1, 630, 192);
assert.deepEqual(input.takeLook(), { dx: 30, dy: -8 });
assert.deepEqual(input.takeLook(), { dx: 0, dy: 0 }, "A camera delta is consumed once.");
near(input.axes.mz, 0.5);
assert.equal(input.endPointer(99), null);
assert.equal(input.endPointer(1), "look");
near(input.axes.mz, 0.5, "Releasing look must not release movement.");
assert.equal(input.beginLook(3, 610, 210), true);
assert.equal(input.endPointer(0), "stick");
near(input.axes.mz, 0);
assert.equal(input.look.id, 3, "Releasing movement must not release look.");
assert.equal(input.beginCast(4), true);
assert.equal(input.beginCast(5), false);
input.moveLook(3, 620, 205);
input.reset();
assert.deepEqual(input.takeLook(), { dx: 0, dy: 0 });
assert.deepEqual(input.axes, centered);
assert.equal(input.castId, null);
assert.equal(input.look, null);
assert.equal(input.stick, null);
assert.equal(input.beginLook(3, 610, 210), true, "Input works again after pause/cancel/orientation reset.");

near(combinedMovement(0, 0, slow).mz, 0.5);
near(Math.hypot(...Object.values(combinedMovement(1, 1))), 1);
near(Math.hypot(...Object.values(combinedMovement(1, 0, far))), 1);
assert.deepEqual(combinedMovement(0, 1, { mz: -1 }), { mx: 0, mz: 0 });
for (let i = 0; i < 32; i++) {
  const yaw = i / 32 * Math.PI * 2;
  const half = combinedMovement(0, 0, slow);
  const move = moveDelta(half.mx, half.mz, yaw, 4, 1);
  near(Math.hypot(move.dx, move.dz), 2);
  assert.ok(move.dx * Math.sin(yaw) + move.dz * Math.cos(yaw) > 0, "Joystick forward follows the camera at every yaw.");
}

assert.equal(movementInput(new Set(["KeyW"])).sprint, false);
assert.equal(movementInput(new Set(["KeyW", "ShiftLeft"])).sprint, true);
assert.equal(movementInput(new Set(["KeyW", "ShiftRight"])).sprint, true);
assert.equal(movementInput(new Set(["KeyW"]), {}, true).sprint, true);
assert.equal(movementInput(new Set(), slow, true).sprint, true, "Auto sprint applies to analog movement.");
assert.equal(movementInput(new Set(), slow, false).sprint, false);
assert.equal(movementInput(new Set(), { ...slow, sprint: true }).sprint, true);
assert.equal(movementInput(new Set(), { sprint: true }).sprint, false, "Run alone does not move the character.");
assert.equal(movementInput(new Set(["KeyW"]), { sprint: true }).sprint, true, "Touch Run can accompany keyboard movement on hybrids.");
assert.equal(movementInput(new Set(["ShiftLeft"]), {}, true).sprint, false, "No input means no sprint.");
assert.equal(movementInput(new Set(["KeyW", "KeyS"]), {}, true).sprint, false, "Opposite keys cancel automatic running.");
near(movementInput(new Set(), slow, true).magnitude, 0.5);

const pointer = (type, id, x = 0, y = 0) => Object.assign(new Event(type, { cancelable: true }), {
  pointerId: id, pointerType: "touch", clientX: x, clientY: y
});
class Element extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.captured = new Set();
    this.classes = new Set();
    this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name),
      toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name) };
    this.offsetWidth = 50;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 132, height: 132 }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); this.dispatchEvent(pointer("lostpointercapture", id)); }
}
const canvas = new Element(), controls = new Element(), stick = new Element(), thumb = new Element(), cast = new Element(), run = new Element();
controls.querySelector = (selector) => ({ ".mobile-stick": stick, ".mobile-stick-thumb": thumb, "[data-mobile-cast]": cast, "[data-mobile-run]": run })[selector];
const environment = Object.assign(new EventTarget(), capabilities(true, true, 5), { document: new EventTarget() });
let interactive = true;
const actions = [];
const controller = new SnejMobileInput({ canvas, controls, environment, canInteract: () => interactive,
  onCastStart: () => { actions.push("start"); return true; }, onCastEnd: () => actions.push("end"), onCastCancel: () => actions.push("cancel") });
controller.setActive(true);
assert.equal(controls.hidden, false);
stick.dispatchEvent(pointer("pointerdown", 10, 66, 31));
near(controller.movement().mz, 1);
run.dispatchEvent(pointer("pointerdown", 9));
assert.equal(controller.movement().sprint, true);
run.dispatchEvent(pointer("pointerdown", 8));
run.dispatchEvent(pointer("pointerup", 8));
assert.equal(controller.movement().sprint, true, "Another finger cannot release held Run.");
assert.equal(controller.state.beginLook(9, 20, 30), false, "Run finger cannot also control the camera.");
canvas.dispatchEvent(pointer("pointerdown", 11, 20, 200));
canvas.dispatchEvent(pointer("pointermove", 11, 30, 205));
const extraTouch = pointer("pointerdown", 12, 300, 200);
canvas.dispatchEvent(extraTouch);
assert.equal(extraTouch.defaultPrevented, true, "Extra touch must not fall through to mouse casting.");
assert.deepEqual(controller.takeLook(), { dx: 10, dy: 5 });
near(controller.movement().mz, 1);
run.dispatchEvent(pointer("lostpointercapture", 9));
assert.equal(controller.movement().sprint, false, "Lost Run capture clears sprint without cancelling movement.");
near(controller.movement().mz, 1);
run.dispatchEvent(pointer("pointerdown", 19));
canvas.dispatchEvent(pointer("pointerup", 11));
near(controller.movement().mz, 1);
cast.dispatchEvent(pointer("pointerdown", 12));
cast.dispatchEvent(pointer("pointercancel", 12));
assert.deepEqual(actions, ["start", "cancel"], "Cancellation never releases a charged cast.");
cast.dispatchEvent(pointer("pointerdown", 13));
cast.dispatchEvent(pointer("pointerup", 13));
assert.deepEqual(actions.slice(-2), ["start", "end"]);
canvas.dispatchEvent(pointer("pointerdown", 16, 400, 200));
canvas.dispatchEvent(pointer("pointermove", 16, 420, 210));
canvas.dispatchEvent(pointer("pointercancel", 16));
assert.deepEqual(controller.takeLook(), { dx: 0, dy: 0 }, "Cancelled look cannot leave a queued camera movement.");
near(controller.movement().mz, 1, "Cancelling camera touch preserves the independent joystick.");
canvas.dispatchEvent(pointer("pointerdown", 14, 400, 200));
canvas.dispatchEvent(pointer("pointermove", 14, 420, 210));
cast.dispatchEvent(pointer("pointerdown", 15));
controller.setActive(false);
assert.equal(controls.hidden, true);
assert.equal(stick.captured.size + canvas.captured.size + cast.captured.size + run.captured.size, 0);
assert.equal(controller.state.runId, null);
assert.deepEqual(controller.takeLook(), { dx: 0, dy: 0 });
near(controller.movement().mz, 0);
assert.equal(actions.at(-1), "cancel");
controller.setActive(true);
stick.dispatchEvent(pointer("pointerdown", 20, 66, 31));
interactive = false;
stick.dispatchEvent(pointer("pointermove", 20, 66, 20));
near(controller.movement().mz, 0, "Opening a menu cannot leave movement held.");
interactive = true;
stick.dispatchEvent(pointer("pointerdown", 21, 66, 31));
environment.document.hidden = true;
environment.document.dispatchEvent(new Event("visibilitychange"));
near(controller.movement().mz, 0);
environment.document.hidden = false;
stick.dispatchEvent(pointer("pointerdown", 22, 66, 31));
environment.dispatchEvent(new Event("resize"));
near(controller.movement().mz, 0);
controller.destroy();
stick.dispatchEvent(pointer("pointerdown", 23, 66, 31));
near(controller.state.axes.mz, 0, "Destroyed controls have no remaining input listeners.");

const fallbackEnvironment = Object.assign(new EventTarget(), capabilities(false, false, 5), { document: new EventTarget() });
const fallback = new SnejMobileInput({ canvas, controls, environment: fallbackEnvironment, canInteract: () => true });
fallback.setActive(true);
assert.equal(fallback.enabled, false);
assert.equal(controls.hidden, true);
const mouse = new Event("pointerdown");
Object.defineProperty(mouse, "pointerType", { value: "mouse" });
fallbackEnvironment.document.dispatchEvent(mouse);
assert.equal(fallback.enabled, false, "Desktop mouse input must not activate touch controls.");
const firstTouch = pointer("pointerdown", 31, 200, 200);
fallbackEnvironment.document.dispatchEvent(firstTouch);
canvas.dispatchEvent(firstTouch);
assert.equal(fallback.enabled, true, "Actual touch recovers a false-negative coarse-pointer query.");
assert.equal(controls.hidden, false);
assert.equal(fallback.state.look.id, 31, "Capture-phase detection enables the same canvas touch.");
fallback.refreshAvailability();
assert.equal(fallback.enabled, true, "Later media changes cannot erase observed touch input.");
canvas.dispatchEvent(pointer("pointercancel", 31));
fallback.setActive(false);
assert.equal(controls.hidden, true, "Touch detection cannot reveal controls over menus.");
fallback.setActive(true);
stick.dispatchEvent(pointer("pointerdown", 32, 66, 31));
near(fallback.movement().mz, 1);
fallbackEnvironment.dispatchEvent(new Event("blur"));
near(fallback.movement().mz, 0, "Fallback controls retain lifecycle cancellation.");
fallback.destroy();
fallback.touchSeen = false;
fallbackEnvironment.document.dispatchEvent(pointer("pointerdown", 33));
fallbackEnvironment.document.dispatchEvent(new Event("touchstart"));
assert.equal(fallback.touchSeen, false, "Destroy removes the document capture listener too.");

const lookZone = new Element();
const originalQuery = controls.querySelector;
controls.querySelector = (selector) => selector === "[data-mobile-look]" ? lookZone : originalQuery(selector);
const safariFallback = new SnejMobileInput({ canvas, controls, environment: fallbackEnvironment, canInteract: () => true });
safariFallback.setActive(true);
fallbackEnvironment.document.dispatchEvent(new Event("touchstart"));
assert.equal(safariFallback.enabled, true, "Safari touchstart recovers controls before pointer interaction.");
lookZone.dispatchEvent(pointer("pointerdown", 40, 200, 200));
lookZone.dispatchEvent(pointer("pointermove", 40, 210, 195));
assert.deepEqual(safariFallback.takeLook(), { dx: 10, dy: -5 });
canvas.dispatchEvent(pointer("pointerdown", 41, 20, 200));
assert.equal(safariFallback.state.look.id, 40, "The separate look zone leaves canvas placement listeners untouched.");
run.dispatchEvent(pointer("pointerdown", 42));
lookZone.dispatchEvent(pointer("pointercancel", 40));
assert.equal(safariFallback.movement().sprint, true, "Camera cancellation does not release Run.");
run.dispatchEvent(pointer("pointercancel", 42));
assert.equal(safariFallback.movement().sprint, false);
safariFallback.destroy();

const order = [];
const document = { fullscreenElement: null };
const supported = {
  document,
  screen: { orientation: { lock: async (mode) => { order.push(mode); } } }
};
const element = { requestFullscreen: async () => { order.push("fullscreen"); } };
assert.deepEqual(await requestLandscape(supported, element), { fullscreen: true, locked: true });
assert.deepEqual(order, ["fullscreen", "landscape"]);
const denied = { document, screen: { orientation: { lock: async () => { throw new Error("NotSupportedError"); } } } };
assert.deepEqual(await requestLandscape(denied, { requestFullscreen: async () => { throw new Error("Denied"); } }), { fullscreen: false, locked: false });
assert.deepEqual(await requestLandscape({}), { fullscreen: false, locked: false });
console.log("Mobile axes, independent touches, lifecycle reset, desktop movement and orientation fallback tests passed.");
