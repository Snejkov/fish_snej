const finite = (value) => Number.isFinite(value) ? value : 0;
const limit = (value, low, high) => Math.min(high, Math.max(low, value));

export const ROD_JOYSTICK_SPEED = 0.07;
const ROD_JOYSTICK_RESPONSE = 10;

export function rodJoystickDelta(axes, velocity, dt) {
  const step = limit(finite(dt), 0, 0.1);
  const { mx, mz } = combinedMovement(0, 0, axes);
  if (!step || (!mx && !mz)) {
    velocity.mx = velocity.mz = 0;
    return { dx: 0, dy: 0 };
  }
  const blend = -Math.expm1(-ROD_JOYSTICK_RESPONSE * step);
  const integrate = (axis, target) => {
    const previous = finite(velocity[axis]);
    velocity[axis] = previous + (target - previous) * blend;
    // Integrate the smooth ramp, rather than making sensitivity depend on FPS.
    return target * step + (previous - target) * blend / ROD_JOYSTICK_RESPONSE;
  };
  return { dx: integrate("mx", mx * ROD_JOYSTICK_SPEED), dy: -integrate("mz", mz * ROD_JOYSTICK_SPEED) };
}

export function touchControlsAvailable(environment = globalThis) {
  const coarse = environment.matchMedia?.("(pointer: coarse)").matches;
  const anyCoarse = environment.matchMedia?.("(any-pointer: coarse)").matches;
  const noHover = environment.matchMedia?.("(hover: none)").matches;
  return Boolean(coarse || ((anyCoarse || noHover) && environment.navigator?.maxTouchPoints > 0));
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
  return { ...axes, magnitude, sprint: magnitude > 0 && (autoSprint === true || stick.sprint === true || Boolean(has("ShiftLeft") || has("ShiftRight"))) };
}

export class MobileInputState {
  constructor() { this.reset(); }

  owns(id) { return this.stick?.id === id || this.look?.id === id || this.castId === id || this.runId === id || this.retrieveId === id || this.squintId === id; }
  canClaim(id) { return (Number.isInteger(id) || (typeof id === "string" && /^touch:-?\d+$/.test(id))) && !this.owns(id); }

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
    this.look = { id, x: finite(x), y: finite(y), startX: finite(x), startY: finite(y), travel: 0 };
    return true;
  }

  moveLook(id, x, y) {
    if (this.look?.id !== id) return false;
    x = finite(x);
    y = finite(y);
    this.dx += x - this.look.x;
    this.dy += y - this.look.y;
    this.look.travel = Math.max(this.look.travel, Math.hypot(x - this.look.startX, y - this.look.startY));
    this.look.x = x;
    this.look.y = y;
    return true;
  }

  beginCast(id) {
    if (this.castId !== null || !this.canClaim(id)) return false;
    this.castId = id;
    return true;
  }

  beginRun(id) {
    if (this.runId !== null || !this.canClaim(id)) return false;
    this.runId = id;
    return true;
  }

  beginRetrieve(id) {
    if (this.retrieveId !== null || !this.canClaim(id)) return false;
    this.retrieveId = id;
    return true;
  }

  beginSquint(id) {
    if (this.squintId !== null || !this.canClaim(id)) return false;
    this.squintId = id;
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
    if (this.runId === id) { this.runId = null; return "run"; }
    if (this.retrieveId === id) { this.retrieveId = null; return "retrieve"; }
    if (this.squintId === id) { this.squintId = null; return "squint"; }
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
    this.runId = null;
    this.retrieveId = null;
    this.squintId = null;
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
  constructor({ canvas, controls, canInteract, onCastStart, onCastEnd, onCastCancel, onRetrieve, onSquintChange, onTap, onAim, onAimCancel, onTargetStart, isTargeting, onAvailability, environment = globalThis }) {
    this.canvas = canvas;
    this.controls = controls;
    this.environment = environment;
    this.canInteract = canInteract;
    this.onCastStart = onCastStart;
    this.onCastEnd = onCastEnd;
    this.onCastCancel = onCastCancel;
    this.onRetrieve = onRetrieve;
    this.onSquintChange = onSquintChange;
    this.onTap = onTap;
    this.onAim = onAim;
    this.onAimCancel = onAimCancel;
    this.onTargetStart = onTargetStart;
    this.isTargeting = isTargeting;
    this.onAvailability = onAvailability;
    this.state = new MobileInputState();
    this.captures = new Map();
    this.uncaptured = new Set();
    this.listeners = [];
    this.active = false;
    this.enabled = false;
    this.stickMode = "move";
    this.rodVelocity = { mx: 0, mz: 0 };
    this.touchSeen = false;
    this.useTouchEvents = "ontouchstart" in environment
      || (typeof environment.TouchEvent === "function" && environment.navigator?.maxTouchPoints > 0);
    this.stick = controls.querySelector(".mobile-stick");
    this.thumb = controls.querySelector(".mobile-stick-thumb");
    this.castButton = controls.querySelector("[data-mobile-cast]");
    this.runButton = controls.querySelector("[data-mobile-run]");
    this.retrieveButton = controls.querySelector("[data-mobile-retrieve]");
    this.squintButton = controls.querySelector("[data-mobile-squint]");
    this.lookZone = controls.querySelector("[data-mobile-look]") || canvas;
    // A real touch can recover from an inaccurate primary-pointer media query.
    this.listen(environment.document, "pointerdown", (event) => {
      if (event.pointerType !== "touch" || this.touchSeen) return;
      this.touchSeen = true;
      this.refreshAvailability();
    }, { capture: true });
    // Safari touch-start detection also works when pointer media queries miss the device.
    this.listen(environment.document, "touchstart", () => {
      if (this.touchSeen) return;
      this.touchSeen = true;
      this.refreshAvailability();
    }, { capture: true, passive: true });
    const pointerStart = (start) => (event) => {
      if (this.useTouchEvents && event.pointerType === "touch") return;
      start.call(this, event);
    };
    this.listen(this.stick, "pointerdown", pointerStart(this.beginStick));
    this.listen(this.stick, "pointermove", (event) => {
      if (!this.available()) return this.reset();
      if (this.state.moveStick(event.pointerId, event.clientX, event.clientY)) this.paintStick();
    });
    this.listen(this.lookZone, "pointerdown", pointerStart(this.beginLook));
    if (canvas !== this.lookZone) this.listen(canvas, "pointerdown", pointerStart(function(event) {
      this.beginLook(event);
    }));
    this.listen(this.lookZone, "pointermove", (event) => {
      if (this.state.look?.id !== event.pointerId) return;
      if (!this.available()) return this.reset();
      this.moveLookPointer(event);
    });
    if (canvas !== this.lookZone) this.listen(canvas, "pointermove", (event) => {
      if (this.state.look?.id !== event.pointerId) return;
      if (!this.available()) return this.reset();
      this.moveLookPointer(event);
    });
    this.listen(this.castButton, "pointerdown", pointerStart(this.beginCast));
    this.listen(this.runButton, "pointerdown", pointerStart(this.beginRun));
    this.listen(this.retrieveButton, "pointerdown", pointerStart(this.beginRetrieve));
    this.listen(this.squintButton, "pointerdown", pointerStart(this.beginSquint));
    this.listen(this.squintButton, "keydown", (event) => {
      if (!["Space", "Enter"].includes(event.code) || !this.available() || this.squintButton.hidden || this.squintButton.disabled) return;
      event.preventDefault();
      if (event.repeat || this.keyboardSquint) return;
      this.keyboardSquint = true;
      if (this.onSquintChange?.(true) === false) this.keyboardSquint = false;
      this.paintSquint();
    });
    this.listen(environment, "keyup", (event) => {
      if (this.keyboardSquint && ["Space", "Enter"].includes(event.code)) {
        this.keyboardSquint = false;
        this.onSquintChange?.(this.state.squintId !== null);
        this.paintSquint();
      }
    });
    this.listen(this.retrieveButton, "click", (event) => {
      if (event.detail === 0 && this.available() && !this.retrieveButton.hidden && !this.retrieveButton.disabled) this.onRetrieve?.();
    });
    for (const [target, start] of [[this.stick, this.beginStick], [this.lookZone, this.beginLook],
      [this.castButton, this.beginCast], [this.runButton, this.beginRun], [this.retrieveButton, this.beginRetrieve], [this.squintButton, this.beginSquint]]) {
      this.listen(target, "touchstart", (event) => {
        if (!this.useTouchEvents || !this.available()) return;
        // A captured stylus keeps its pointer stream; do not cancel it with duplicate touch events.
        if (Array.from(this.captures).some(([id, owner]) => typeof id === "number" && owner === target)) return;
        event.preventDefault();
        for (const touch of Array.from(event.changedTouches || [])) start.call(this, this.touchPointer(touch, event));
      }, { passive: false });
    }
    this.listen(canvas, "touchstart", (event) => {
      if (!this.available()) return;
      event.preventDefault();
      if (canvas !== this.lookZone && this.useTouchEvents) {
        for (const touch of Array.from(event.changedTouches || [])) this.beginLook(this.touchPointer(touch, event));
      }
    }, { passive: false });
    this.listen(environment.document, "touchmove", (event) => {
      if (!this.useTouchEvents) return;
      for (const touch of Array.from(event.changedTouches || [])) {
        const pointer = this.touchPointer(touch, event);
        if (!this.state.owns(pointer.pointerId)) continue;
        if (!this.available()) { this.reset(); return; }
        event.preventDefault();
        this.movePointer(pointer);
      }
    }, { capture: true, passive: false });
    for (const type of ["touchend", "touchcancel"]) {
      this.listen(environment.document, type, (event) => {
        if (!this.useTouchEvents) return;
        for (const touch of Array.from(event.changedTouches || [])) {
          const pointer = this.touchPointer(touch, event);
          if (!this.state.owns(pointer.pointerId)) continue;
          event.preventDefault();
          this.finish(pointer, type === "touchcancel");
        }
      }, { capture: true, passive: false });
    }
    // A failed capture must not discard input; document listeners retain ownership.
    this.listen(environment.document, "pointermove", (event) => {
      if (this.uncaptured.has(event.pointerId)) this.movePointer(event);
    }, { capture: true });
    for (const type of ["pointerup", "pointercancel"]) {
      this.listen(environment.document, type, (event) => {
        if (this.uncaptured.has(event.pointerId)) this.finish(event, type === "pointercancel");
      }, { capture: true });
    }
    for (const target of [canvas, this.lookZone, this.stick, this.castButton, this.runButton, this.retrieveButton, this.squintButton]) {
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        this.listen(target, type, (event) => this.finish(event, type !== "pointerup"));
      }
    }
    this.listen(environment, "blur", () => this.reset());
    this.listen(environment, "resize", () => this.reset());
    this.listen(environment.document, "visibilitychange", () => {
      if (environment.document.hidden) this.reset();
    });
    for (const target of [canvas, controls]) {
      for (const type of ["contextmenu", "selectstart"]) {
        this.listen(target, type, (event) => { if (this.available()) event.preventDefault(); });
      }
    }
    for (const query of ["(pointer: coarse)", "(any-pointer: coarse)", "(hover: none)"]) {
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
    this.environment.document?.body?.classList.toggle("touch-active", enabled);
    this.onAvailability?.(enabled);
  }

  setActive(active) {
    active = Boolean(active);
    if (active !== this.active) this.reset();
    this.active = active;
    this.controls.hidden = !this.enabled || !active;
    this.canvas.classList.toggle("mobile-input-active", this.enabled && active);
  }

  setStickMode(mode, label) {
    mode = mode === "rod" ? "rod" : "move";
    if (mode !== this.stickMode) {
      // A held movement finger must not become a rod correction, or vice versa.
      if (this.state.stick) this.release(this.state.stick.id);
      this.rodVelocity.mx = this.rodVelocity.mz = 0;
      this.stickMode = mode;
      this.paintStick();
    }
    if (label) {
      this.stick.setAttribute?.("aria-label", label);
      this.stick.setAttribute?.("title", label);
    }
  }

  rodLook(dt) {
    const axes = this.available() && this.stickMode === "rod" ? this.state.axes : {};
    return rodJoystickDelta(axes, this.rodVelocity, dt);
  }

  available(event) {
    return this.enabled && this.active && this.canInteract()
      && !this.environment.document?.hidden
      && (!event || event.pointerType === "touch" || event.pointerType === "pen");
  }

  capture(event, target) {
    if (!event.nativeTouch) {
      try { target.setPointerCapture(event.pointerId); }
      catch { this.uncaptured.add(event.pointerId); }
    }
    this.captures.set(event.pointerId, target);
    event.preventDefault();
    return true;
  }

  touchPointer(touch, event) {
    return { pointerId: `touch:${touch.identifier}`, pointerType: "touch", nativeTouch: true,
      clientX: touch.clientX, clientY: touch.clientY, currentTarget: event.currentTarget, preventDefault: () => event.preventDefault() };
  }

  movePointer(event) {
    if (!this.available()) return this.reset();
    if (this.state.moveStick(event.pointerId, event.clientX, event.clientY)) this.paintStick();
    this.moveLookPointer(event);
  }

  moveLookPointer(event) {
    if (this.state.look?.id !== event.pointerId) return;
    if (this.state.look.aiming) {
      event.preventDefault();
      this.onAim?.(event.clientX, event.clientY);
    } else this.state.moveLook(event.pointerId, event.clientX, event.clientY);
  }

  releaseCapture(id, target) {
    if (typeof id !== "number") return;
    try { if (target?.hasPointerCapture(id)) target.releasePointerCapture(id); }
    catch { /* The browser may have already revoked this pointer. */ }
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
    if (this.state.look) return;
    const aiming = this.isTargeting?.() || this.onTargetStart?.(event.clientX, event.clientY);
    if (!aiming && event.currentTarget === this.canvas && this.canvas !== this.lookZone) return;
    if (this.state.beginLook(event.pointerId, event.clientX, event.clientY)) {
      this.capture(event, event.currentTarget === this.canvas ? this.canvas : this.lookZone);
      if (aiming && this.onAim) {
        this.state.look.aiming = true;
        this.state.takeLook();
        this.onAim(event.clientX, event.clientY);
      }
    }
  }

  beginRun(event) {
    if (!this.available(event) || this.runButton.hidden || this.runButton.disabled || !this.state.beginRun(event.pointerId)) return;
    if (this.capture(event, this.runButton)) this.paintRun();
  }

  beginCast(event) {
    if (!this.available(event) || this.castButton.hidden || this.castButton.disabled || !this.state.beginCast(event.pointerId)) return;
    if (!this.capture(event, this.castButton)) return;
    if (this.onCastStart?.() === false) { this.release(event.pointerId); return; }
    this.castButton.classList.add("pressed");
  }

  beginRetrieve(event) {
    if (!this.available(event) || !this.retrieveButton || this.retrieveButton.hidden || this.retrieveButton.disabled
      || !this.state.beginRetrieve(event.pointerId)) return;
    this.capture(event, this.retrieveButton);
    this.retrieveButton.classList.add("pressed");
  }

  beginSquint(event) {
    if (!this.available(event) || !this.squintButton || this.squintButton.hidden || this.squintButton.disabled
      || !this.state.beginSquint(event.pointerId)) return;
    this.capture(event, this.squintButton);
    if (this.onSquintChange?.(true) === false) this.release(event.pointerId);
    this.paintSquint();
  }

  release(id) {
    const role = this.state.endPointer(id);
    if (role === "stick") this.rodVelocity.mx = this.rodVelocity.mz = 0;
    const target = this.captures.get(id);
    this.captures.delete(id);
    this.uncaptured.delete(id);
    this.releaseCapture(id, target);
    return role;
  }

  finish(event, cancelled) {
    const look = this.state.look?.id === event.pointerId ? this.state.look : null;
    const role = this.release(event.pointerId);
    if (role === "squint") {
      this.onSquintChange?.(Boolean(this.keyboardSquint));
      this.paintSquint();
      return;
    }
    if (role === "retrieve") {
      this.retrieveButton.classList.remove("pressed");
      if (!cancelled && this.available() && !this.retrieveButton.hidden && !this.retrieveButton.disabled) this.onRetrieve?.();
      return;
    }
    if (role === "stick") this.paintStick();
    if (role === "run") this.paintRun();
    if (role === "look" && cancelled) this.state.takeLook();
    if (role === "look" && look.aiming && (cancelled || !this.available())) this.onAimCancel?.();
    if (role === "look" && !cancelled && this.available() && (look.aiming || (look.travel <= 10
      && Math.hypot(event.clientX - look.startX, event.clientY - look.startY) <= 10))) {
      this.onTap?.(event.clientX, event.clientY);
    }
    if (role !== "cast") return;
    this.castButton.classList.remove("pressed");
    if (cancelled || !this.available()) this.onCastCancel?.();
    else this.onCastEnd?.();
  }

  paintStick() {
    this.thumb.style.transition = this.state.stick ? "none" : "transform 120ms ease-out";
    this.thumb.style.transform = `translate(${this.state.axes.x}px, ${this.state.axes.y}px)`;
    this.stick.classList.toggle("pressed", Boolean(this.state.stick));
  }

  paintRun() {
    const held = this.state.runId !== null;
    this.runButton?.classList.toggle("pressed", held);
    this.runButton?.setAttribute?.("aria-pressed", String(held));
  }

  paintSquint() {
    const held = this.state.squintId !== null || Boolean(this.keyboardSquint);
    this.squintButton?.classList.toggle("pressed", held);
    this.squintButton?.setAttribute?.("aria-pressed", String(held));
  }

  reset() {
    const casting = this.state.castId !== null;
    const aiming = this.state.look?.aiming;
    const squinting = this.state.squintId !== null || this.keyboardSquint;
    this.keyboardSquint = false;
    this.state.reset();
    this.rodVelocity.mx = this.rodVelocity.mz = 0;
    for (const [id, target] of this.captures) {
      this.releaseCapture(id, target);
    }
    this.captures.clear();
    this.uncaptured.clear();
    this.paintStick();
    this.paintRun();
    this.paintSquint();
    this.castButton.classList.remove("pressed");
    this.retrieveButton?.classList.remove("pressed");
    if (casting) this.onCastCancel?.();
    if (aiming) this.onAimCancel?.();
    if (squinting) this.onSquintChange?.(false);
  }

  takeLook() {
    if (this.available()) return this.state.takeLook();
    this.reset();
    return { dx: 0, dy: 0 };
  }

  movement() {
    if (this.available()) return { ...this.state.axes, sprint: this.state.runId !== null };
    this.reset();
    return { mx: 0, mz: 0 };
  }
  destroy() { this.reset(); this.setActive(false); this.listeners.splice(0).forEach((remove) => remove()); }
}
