const mobile = location.pathname.includes("target-cast");
const page = new DOMParser().parseFromString(await (await fetch("../index.html")).text(), "text/html");
const base = page.createElement("base"); base.href = new URL("../", location.href).href; page.head.prepend(base);
const qaStyle = page.createElement("style");
qaStyle.textContent = ".qa{position:fixed;z-index:1000;left:12px;top:85px;background:#111;color:white}output.qa{top:125px;pointer-events:none;font-size:12px;max-width:70%}";
page.head.append(qaStyle);
if (mobile) {
  const setup = page.createElement("script");
  setup.textContent = `const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => { const result = nativeMatchMedia(query);
      if (query === '(pointer: coarse)' || query === '(any-pointer: coarse)') Object.defineProperty(result,'matches',{value:true}); return result; };
    Object.defineProperty(navigator,'maxTouchPoints',{value:5});
    document.documentElement.requestFullscreen=undefined;`;
  base.after(setup);
}
const frame = document.getElementById("fixture"), button = document.getElementById("checks"), report = document.getElementById("result");
let touchId = 1800;
frame.onload = () => {
  const win = frame.contentWindow; win.document.body.append(button, report);
  const status = () => {
    const game = win.snejFishing;
    if (!game) return;
    report.dataset.locked = String(win.document.pointerLockElement === game.canvas);
    report.dataset.free = String(game.desktopCursor.free);
  };
  win.document.addEventListener("pointerlockchange", status);
  win.addEventListener("keydown", () => queueMicrotask(status));
};
frame.srcdoc = "<!doctype html>" + page.documentElement.outerHTML;
button.onclick = () => {
  const win = frame.contentWindow, game = win.snejFishing;
  const check = (value, message) => { if (!value) throw new Error(message); };
  const press = () => {
    if (mobile) {
      const target = game.ui.el.mobileControls.querySelector("[data-mobile-cast]"), r = target.getBoundingClientRect();
      const touch = new win.Touch({ identifier: touchId++, target, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      target.dispatchEvent(new win.TouchEvent("touchstart", { bubbles: true, cancelable: true, changedTouches: [touch], touches: [touch] }));
      return cancel => target.dispatchEvent(new win.TouchEvent(cancel ? "touchcancel" : "touchend", { bubbles: true, cancelable: true, changedTouches: [touch], touches: [] }));
    }
    game.canvas.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 300, clientY: 180 }));
    return cancel => {
      if (cancel) win.dispatchEvent(new win.Event("blur"));
      else win.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 300, clientY: 180 }));
    };
  };
  try {
    check(game.mode === "playing" && !game.server.enabled, "Enter the isolated local game first");
    check(game.castContext.holdCast, "Hold casting was not enabled");
    if (!button.dataset.ready) {
      game.cancelCastAction(); game.cast.reset(); game.desktopCursor.release();
      const start = game.pos.clone(); let found = false;
      search: for (let dx = -18; dx <= 18; dx += 2) for (let dz = -18; dz <= 18; dz += 2) {
        const x = start.x + dx, z = start.z + dz;
        if (game.terrain.depthAt(x, z) > 0.05 || game.terrain.blockedAt(x, z, 0.34, game.terrain.heightAt(x, z) + 0.8)) continue;
        game.pos.set(x, game.terrain.heightAt(x, z) + 0.04, z);
        for (let i = 0; i < 32; i += 1) {
          game.yaw = i * Math.PI / 16; game.pitch = -0.35;
          game.angler.heading = 0; game.angler.rig.rotation.y = 0; game.angler.group.rotation.y = game.yaw;
          game.angler.group.updateMatrixWorld(true);
          game.cast.reset(); game.beginHoldCast(); game.updateCast(2.5);
          found = game.cast.state.canRelease; game.cancelCastAction(); game.cast.reset();
          if (found) break search;
        }
      }
      check(found, "No unobstructed forward shore cast spot");
      game.cameraMode = "third-person"; game.viewBlend = 1; game.viewTransition = null;
      game.updateCamera(10); game.ui.updateViewChip(game); game.updateCast(0);
      button.dataset.ready = "1"; button.textContent = "Check hold cast";
      report.textContent = mobile ? "Ready: native-touch hold/release/cancel checks" : "Ready: Backquote captures/releases; then check hold cast";
      report.dataset.locked = "false"; report.dataset.free = "true";
      return;
    }
    if (mobile) check(game.mobileInput.useTouchEvents, "Native touch was not selected");
    const savedPitch = game.pitch, savedCamera = game.camera.position.clone(), savedYaw = game.yaw;
    let lift = press(); check(game.cast.state.fs === "charge", "Press did not charge from idle");
    game.updateCast(1); lift(true);
    check(game.cast.state.fs === "idle" && game.cameraMode === "third-person", "Cancellation cast or changed view");
    check(!game.holdCasting, "Cancellation left a held cast active");
    lift = press();
    let previous = 0;
    for (let i = 0; i < 240; i += 1) {
      game.updateCast(1 / 60);
      check(game.cast.state.charge >= previous - 1e-9, "Strength oscillated instead of holding max"); previous = game.cast.state.charge;
    }
    check(game.cast.state.fs === "charge" && game.cast.state.charge === 1, "Maximum auto-cast or did not cap");
    check(game.cameraMode === "third-person" && game.pitch === savedPitch && game.yaw === savedYaw
      && game.camera.position.distanceTo(savedCamera) < 0.001, "Charging moved the original view");
    check(game.castMeter.getAttribute("aria-valuenow") === "100", "Strength UI did not show 100 percent");
    check(game.aimMarker.visible && game.aimMarker.material.color.getHex() === 0x54e58b, "Valid forward ring not green");
    const chosen = { ...game.cast.state.predictedLanding };
    lift(false); check(game.cast.state.fs === "flight", "Release did not launch");
    check(game.cameraMode === "first-person", "Successful release did not switch to first person");
    for (let i = 0; i < 600 && game.cast.state.fs === "flight"; i += 1) game.updateCast(1 / 60);
    check(game.cast.state.fs === "wait", "Cast did not land");
    check(Math.hypot(game.cast.state.bobber.x - chosen.x, game.cast.state.bobber.z - chosen.z) < 0.001, "Float missed charged preview");
    check(game.cast.castRange >= 2 * (game.settings.rodLength - game.settings.floatDepth), "Physical range did not increase");
    check(game.castMeter.classList.contains("hidden"), "Strength bar remained after release");
    if (!mobile) check(game.desktopCursor.free && win.document.pointerLockElement !== game.canvas, "Free cursor was recaptured");
    game.toggleView(); game.updateCamera(10); game.cast.reset();
    game.yaw = savedYaw + Math.PI; game.angler.heading = 0; game.angler.rig.rotation.y = 0;
    game.angler.group.rotation.y = game.yaw; game.angler.group.updateMatrixWorld(true);
    lift = press(); game.updateCast(2.5);
    if (!game.cast.state.canRelease) {
      check(game.aimMarker.material.color.getHex() === 0xff5555, "Invalid forward ring not red");
      lift(false); check(game.cast.state.fs === "idle", "Invalid land release launched");
    } else lift(true);
    game.yaw = savedYaw; game.angler.group.rotation.y = savedYaw; game.angler.group.updateMatrixWorld(true);
    game.updateCamera(10); game.cast.reset(); game.updateCast(0);
    press(); game.updateCast(1.8);
    report.textContent = "PASS: hold / capped strength / release forward / exact landing / cancel / unchanged charge view / release first person";
    button.hidden = true;
  } catch (error) { report.textContent = "FAIL: " + error.message; }
};
