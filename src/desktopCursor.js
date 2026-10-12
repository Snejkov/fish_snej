export function editableTarget(target) {
  return Boolean(target?.isContentEditable || target?.closest?.("input,textarea,select,[contenteditable]:not([contenteditable='false'])"));
}

// Pointer lock is asynchronous; a late grant must not capture a paused game.
export class SnejDesktopCursor {
  constructor({ canvas, canInteract, onCapture, onRelease, environment = globalThis }) {
    Object.assign(this, { canvas, canInteract, onCapture, onRelease, environment });
    this.free = false;
    this.pending = false;
    this.generation = 0;
    const doc = environment.document;
    doc.addEventListener("pointerlockchange", () => this.changed());
    doc.addEventListener("pointerlockerror", () => this.release());
    doc.addEventListener("visibilitychange", () => { if (doc.hidden) this.release(); });
    environment.addEventListener("blur", () => this.release());
  }

  handleKey(event) {
    if (event.code !== "Backquote" || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey
      || editableTarget(event.target) || !this.canInteract()) return false;
    event.preventDefault();
    if (this.pending || this.environment.document.pointerLockElement === this.canvas) this.release();
    else this.capture();
    return true;
  }

  capture() {
    if (this.pending || !this.canInteract() || this.environment.document.hidden) return false;
    this.free = false;
    this.pending = true;
    const generation = ++this.generation;
    try {
      const result = this.canvas.requestPointerLock();
      result?.catch?.(() => { if (generation === this.generation) this.release(); });
    } catch { this.release(); return false; }
    return true;
  }

  release() {
    this.free = true;
    this.pending = false;
    this.generation += 1;
    this.onRelease?.();
    if (this.environment.document.pointerLockElement === this.canvas) this.environment.document.exitPointerLock();
  }

  changed() {
    if (this.environment.document.pointerLockElement === this.canvas) {
      if (this.free || !this.canInteract() || this.environment.document.hidden) { this.release(); return; }
      this.pending = false;
      this.onCapture?.();
    } else this.release();
  }
}
