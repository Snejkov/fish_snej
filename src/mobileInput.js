const finite = (value) => Number.isFinite(value) ? value : 0;
const limit = (value, low, high) => Math.min(high, Math.max(low, value));

export function touchControlsAvailable(environment = globalThis) {
  const coarse = environment.matchMedia?.("(pointer: coarse)").matches;
  const anyCoarse = environment.matchMedia?.("(any-pointer: coarse)").matches;
  return Boolean(coarse || (anyCoarse && environment.navigator?.maxTouchPoints > 0));
}

export function joystickAxes(dx, dy, radius, deadZone = 0.12) {
  dx = finite(dx);
  dy = finite(dy);
  radius = Math.max(1, finite(radius));
  deadZone = limit(finite(deadZone), 0, 0.95);
  const length = Math.hypot(dx, dy);
  const travel = Math.min(length, radius);
  if (!length) return { mx: 0, mz: 0, x: 0, y: 0 };
  const strength = Math.max(0, travel / radius - deadZone) / (1 - deadZone);
  return { mx: dx / length * strength, mz: -dy / length * strength,
    x: dx / length * travel, y: dy / length * travel };
}

export function combinedMovement(mx, mz, stick = {}) {
  mx = finite(mx) + finite(stick.mx);
  mz = finite(mz) + finite(stick.mz);
  const scale = Math.max(1, Math.hypot(mx, mz));
  return { mx: mx / scale, mz: mz / scale };
}

export function movementInput(keys, stick = {}, autoSprint = false) {
  const has = (code) => keys?.has(code) ? 1 : 0;
  const axes = combinedMovement(has("KeyD") - has("KeyA"), has("KeyW") - has("KeyS"), stick);
  const magnitude = Math.hypot(axes.mx, axes.mz);
  return { ...axes, magnitude, sprint: magnitude > 0 && (autoSprint === true || Boolean(has("ShiftLeft") || has("ShiftRight"))) };
}

export class MobileInputState {
  constructor() { this.reset(); }

  owns(id) { return this.stick?.id === id || this.look?.id === id || this.castId === id; }
  canClaim(id) { return Number.isInteger(id) && id >= 0 && !this.owns(id); }

  beginStick(id, x, y, centerX, centerY, radius) {
    if (this.stick || !this.canClaim(id)) return false;
    this.stick = { id, centerX, centerY, radius };
    this.moveStick(id, x, y);
    return true;
  }

  moveStick(id, x, y) {
    if (this.stick?.id !== id) return false;
    this.axes = joystickAxes(x - this.stick.centerX, y - this.stick.centerY, this.stick.radius);
    return true;
  }

  beginLook(id, x, y) {
    if (this.look || !this.canClaim(id)) return false;
    this.look = { id, x: finite(x), y: finite(y) };
    return true;
  }

  moveLook(id, x, y) {
    if (this.look?.id !== id) return false;
    x = finite(x);
    y = finite(y);
    this.dx += x - this.look.x;
    this.dy += y - this.look.y;
    this.look.x = x;
    this.look.y = y;
    return true;
  }

  beginCast(id) {
    if (this.castId !== null || !this.canClaim(id)) return false;
    this.castId = id;
    return true;
  }

  endPointer(id) {
    if (this.stick?.id === id) {
      this.stick = null;
      this.axes = joystickAxes(0, 0, 1);
      return "stick";
    }
    if (this.look?.id === id) { this.look = null; return "look"; }
    if (this.castId === id) { this.castId = null; return "cast"; }
    return null;
  }

  takeLook() {
    const delta = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return delta;
  }

  reset() {
    this.stick = this.look = null;
    this.castId = null;
    this.axes = joystickAxes(0, 0, 1);
    this.dx = this.dy = 0;
  }
}

export async function requestLandscape(environment = globalThis, element = environment.document?.documentElement) {
  let fullscreen = Boolean(environment.document?.fullscreenElement);
  if (!fullscreen && typeof element?.requestFullscreen === "function") {
    try { await element.requestFullscreen(); fullscreen = true; } catch { /* Portrait remains usable if fullscreen is denied. */ }
  }
  const orientation = environment.screen?.orientation;
  if (typeof orientation?.lock !== "function") return { fullscreen, locked: false };
  try {
    await orientation.lock("landscape");
    return { fullscreen, locked: true };
  } catch {
    return { fullscreen, locked: false };
  }
}

export class SnejMobileInput {
  constructor({ canvas, controls, canInteract, onCastStart, onCastEnd, onCastCancel, onAvailability, environment = globalThis }) {
    this.canvas = canvas;
    this.controls = controls;
    this.environment = environment;
    this.canInteract = canInteract;
    this.onCastStart = onCastStart;
    this.onCastEnd = onCastEnd;
    this.onCastCancel = onCastCancel;
    this.onAvailability = onAvailability;
    this.state = new MobileInputState();
    this.captures = new Map();
    this.listeners = [];
    this.active = false;
    this.enabled = false;
    this.touchSeen = false;
    this.stick = controls.querySelector(".mobile-stick");
    this.thumb = controls.querySelector(".mobile-stick-thumb");
    this.castButton = controls.querySelector("[data-mobile-cast]");
    // A real touch can recover from an inaccurate primary-pointer media query.
    this.listen(environment.document, "pointerdown", (event) => {
      if (event.pointerType !== "touch" || this.touchSeen) return;
      this.touchSeen = true;
      this.refreshAvailability();
    }, { capture: true });
    this.listen(this.stick, "pointerdown", (event) => this.beginStick(event));
    this.listen(this.stick, "pointermove", (event) => {
      if (!this.available()) return this.reset();
      if (this.state.moveStick(event.pointerId, event.clientX, event.clientY)) this.paintStick();
    });
    this.listen(canvas, "pointerdown", (event) => this.beginLook(event));
    this.listen(canvas, "pointermove", (event) => {
      if (this.state.look?.id !== event.pointerId) return;
      if (!this.available()) return this.reset();
      this.state.moveLook(event.pointerId, event.clientX, event.clientY);
    });
    this.listen(this.castButton, "pointerdown", (event) => this.beginCast(event));
    for (const target of [canvas, this.stick, this.castButton]) {
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        this.listen(target, type, (event) => this.finish(event, type !== "pointerup"));
      }
    }
    this.listen(environment, "blur", () => this.reset());
    this.listen(environment, "resize", () => this.reset());
    this.listen(environment.document, "visibilitychange", () => {
      if (environment.document.hidden) this.reset();
    });
    for (const query of ["(pointer: coarse)", "(any-pointer: coarse)"]) {
      this.listen(environment.matchMedia?.(query), "change", () => this.refreshAvailability());
    }
    this.refreshAvailability();
  }

  listen(target, type, handler, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  }

  refreshAvailability() {
    const enabled = this.touchSeen || touchControlsAvailable(this.environment);
    if (enabled !== this.enabled) this.reset();
    this.enabled = enabled;
    this.controls.hidden = !enabled || !this.active;
    this.canvas.classList.toggle("mobile-input-active", enabled && this.active);
    this.onAvailability?.(enabled);
  }

  setActive(active) {
    active = Boolean(active);
    if (active !== this.active) this.reset();
    this.active = active;
    this.controls.hidden = !this.enabled || !active;
    this.canvas.classList.toggle("mobile-input-active", this.enabled && active);
  }

  available(event) {
    return this.enabled && this.active && this.canInteract()
      && !this.environment.document?.hidden
      && (!event || event.pointerType === "touch" || event.pointerType === "pen");
  }

  capture(event, target) {
    try { target.setPointerCapture(event.pointerId); }
    catch { this.state.endPointer(event.pointerId); return false; }
    this.captures.set(event.pointerId, target);
    event.preventDefault();
    return true;
  }

  beginStick(event) {
    if (!this.available(event)) return;
    const rect = this.stick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2 - this.thumb.offsetWidth / 2 - 6);
    if (!this.state.beginStick(event.pointerId, event.clientX, event.clientY, rect.left + rect.width / 2, rect.top + rect.height / 2, radius)) return;
    if (this.capture(event, this.stick)) this.paintStick();
  }

  beginLook(event) {
    if (!this.available(event)) return;
    // Suppress compatibility mouse casts even when an extra finger is ignored.
    event.preventDefault();
    if (this.state.beginLook(event.pointerId, event.clientX, event.clientY)) this.capture(event, this.canvas);
  }

  beginCast(event) {
    if (!this.available(event) || !this.state.beginCast(event.pointerId)) return;
    if (!this.capture(event, this.castButton)) return;
    if (this.onCastStart?.() === false) { this.release(event.pointerId); return; }
    this.castButton.classList.add("pressed");
  }

  release(id) {
    const role = this.state.endPointer(id);
    const target = this.captures.get(id);
    this.captures.delete(id);
    if (target?.hasPointerCapture(id)) target.releasePointerCapture(id);
    return role;
  }

  finish(event, cancelled) {
    const role = this.release(event.pointerId);
    if (role === "stick") this.paintStick();
    if (role === "look" && cancelled) this.state.takeLook();
    if (role !== "cast") return;
    this.castButton.classList.remove("pressed");
    if (cancelled || !this.available()) this.onCastCancel?.();
    else this.onCastEnd?.();
  }

  paintStick() {
    this.thumb.style.transform = `translate(${this.state.axes.x}px, ${this.state.axes.y}px)`;
    this.stick.classList.toggle("pressed", Boolean(this.state.stick));
  }

  reset() {
    const casting = this.state.castId !== null;
    this.state.reset();
    for (const [id, target] of this.captures) {
      if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    }
    this.captures.clear();
    this.paintStick();
    this.castButton.classList.remove("pressed");
    if (casting) this.onCastCancel?.();
  }

  takeLook() {
    if (this.available()) return this.state.takeLook();
    this.reset();
    return { dx: 0, dy: 0 };
  }

  movement() {
    if (this.available()) return this.state.axes;
    this.reset();
    return { mx: 0, mz: 0 };
  }
  destroy() { this.reset(); this.setActive(false); this.listeners.splice(0).forEach((remove) => remove()); }
}
