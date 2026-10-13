import { FISHING_UNITS_VERSION } from "./fishingUnits.js";

const copy = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
};
export const ACCOUNT_ERRORS = Object.freeze({
  invalid_credentials: "Incorrect name or password.", invalid_name: "Use 3 to 20 characters.",
  reserved_name: "This name is reserved.", name_taken: "This name is already taken.",
  auth_busy: "Please try again shortly.", rate_limited: "Please try again shortly.",
  authentication_required: "Please sign in again.", unauthorized: "Please sign in again.",
  session_expired: "Please sign in again.", insufficient_coins: "Not enough coins.",
  login_required: "Please sign in again.", already_owned: "Already owned.",
  item_not_owned: "Item is not owned.", out_of_bait: "No bait.",
  revision_conflict: "Your profile changed. Please try again.", depth_out_of_range: "Invalid float depth.",
  client_update_required: "Refresh the game to update fishing units.",
  bait_unavailable: "No bait.", name_unavailable: "This name is already taken.",
  network_error: "Connection failed", server_error: "Server unavailable. Please try again.",
  cast_unavailable: "Reconnect to the lake before casting.", cast_invalid_target: "Invalid cast target.",
  cast_gear_unavailable: "Check your equipped fishing gear.",
  cast_expired: "Cast expired. Please cast again.", cast_conflict: "Cast changed. Please cast again."
});
export class AccountError extends Error {
  constructor(code, status = 0) { super(ACCOUNT_ERRORS[code] || "Server unavailable. Please try again."); this.code = code; this.status = status; }
}

export function createOperationId(random = globalThis.crypto) {
  const bytes = random.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Only editable fields travel from the browser. Coins and ownership come back from the server.
export function editableProfile(game) {
  const { volume, bgm, sens, quality, shadow, floatDepth, lang } = game.settings;
  const { equipped, clothing, loadouts } = game.inventory.serialize();
  return copy({ settings: { volume, bgm, sens, quality, shadow, floatDepth, lang, fishingUnitsVersion: FISHING_UNITS_VERSION,
    autoSprint: game.settings.autoSprint === true }, equipped, clothing, loadouts });
}
export function profileDifference(desired, profile) {
  const patch = {};
  for (const key of ["settings", "clothing", "loadouts"]) {
    const existing = key === "settings" ? profile.state.settings : profile.state.inventory[key];
    if (!same(desired[key], existing)) patch[key] = desired[key];
  }
  const equipped = {};
  for (const [key, value] of Object.entries(desired.equipped)) {
    if (value !== profile.state.inventory.equipped[key]) equipped[key] = value;
  }
  if (Object.keys(equipped).length) patch.equipped = equipped;
  return patch;
}

export class SnejServerClient {
  constructor({ fetcher = globalThis.fetch.bind(globalThis), requestId = createOperationId, onProfile = () => {} } = {}) {
    this.fetcher = fetcher;
    this.requestId = requestId;
    this.onProfile = onProfile;
    this.enabled = false;
    this.guestOnly = false;
    this.profile = null;
    this.revision = 0;
    this.pending = Promise.resolve();
  }
  async request(path, method = "GET", value) {
    let response;
    try {
      response = await this.fetcher(path, { method, credentials: "same-origin", cache: "no-store",
        headers: value === undefined ? {} : { "Content-Type": "application/json" },
        body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(10000) });
    } catch { throw new AccountError("network_error"); }
    let data;
    try { data = await response.json(); } catch { throw new AccountError("server_error", response.status); }
    if (!response.ok) throw new AccountError(data.error, response.status);
    return data;
  }
  accept(profile, kind) {
    if (!profile?.user || !profile.state?.inventory || !Number.isSafeInteger(profile.revision)) throw new AccountError("server_error");
    if (this.profile && profile.user.id !== this.profile.user.id) throw new AccountError("authentication_required", 401);
    this.profile = profile;
    this.revision = Math.max(this.revision, profile.revision);
    this.onProfile(profile, kind);
    return profile;
  }
  async probe() {
    let response;
    try { response = await this.fetcher("/healthz", { cache: "no-store", signal: AbortSignal.timeout(10000) }); }
    catch { throw new AccountError("network_error"); }
    if ([404, 501].includes(response.status)) return false;
    if (!response.ok) throw new AccountError("server_error", response.status);
    let health;
    try { health = await response.json(); } catch { throw new AccountError("server_error", response.status); }
    if (health.mode !== "authenticated-game") return false;
    this.enabled = true;
    this.guestOnly = health.entry === "guest";
    try { this.accept(await this.request("/api/profile"), "restore"); }
    catch (error) { if (error.status !== 401) throw error; }
    return true;
  }
  async authenticate(name, password, register = false) {
    if (!this.enabled) throw new AccountError("server_error");
    this.profile = null; this.revision = 0;
    return this.accept(await this.request(register ? "/api/register" : "/api/login", "POST", { name, password }), "restore");
  }
  async enterGuest(name) {
    if (!this.enabled || !this.guestOnly) throw new AccountError("server_error");
    this.profile = null; this.revision = 0;
    return this.accept(await this.request("/api/guest", "POST", { name }), "restore");
  }
  enqueue(operation) {
    const task = this.pending.then(operation);
    this.pending = task.catch(() => {});
    return task;
  }
  async retry(operation) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await operation(); }
      catch (error) {
        if (error.code !== "revision_conflict" || attempt === 2) throw error;
        this.accept(await this.request("/api/profile"), "refresh");
      }
    }
  }
  save(desired) {
    const snapshot = copy(desired);
    return this.enqueue(() => this.retry(async () => {
      if (!this.profile) throw new AccountError("authentication_required", 401);
      const patch = profileDifference(snapshot, this.profile);
      if (!Object.keys(patch).length) return this.profile;
      return this.accept(await this.request("/api/profile", "PATCH", { expectedRevision: this.revision, patch }), "save");
    }));
  }
  command(action, itemId) {
    const requestId = this.requestId();
    return this.enqueue(() => this.retry(async () => {
      if (!this.profile) throw new AccountError("authentication_required", 401);
      const result = await this.request("/api/command", "POST", { expectedRevision: this.revision, requestId, action,
        ...(itemId === undefined ? {} : { itemId }) });
      this.accept(result.profile, "command");
      return result;
    }));
  }
  noteRevision(revision) { if (Number.isSafeInteger(revision)) this.revision = Math.max(this.revision, revision); }
  castRequest(path, value) {
    const snapshot = copy(value);
    return this.enqueue(async () => {
      // Idempotent cast IDs make a lost response safe to retry without consuming bait twice.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try { return await this.request(path, "POST", snapshot); }
        catch (error) { if (error.code !== "network_error" || attempt === 2) throw error; }
      }
    });
  }
  beginCast(target) { return this.castRequest("/api/cast/start", { requestId: this.requestId(), target }); }
  cancelCast(castId) { return this.castRequest("/api/cast/cancel", { castId }); }
  async landCast(castId, landing) {
    const result = await this.castRequest("/api/cast/land", { castId, landing });
    this.accept(result.profile, "command");
    return result;
  }
  async logout() {
    await this.pending;
    await this.request("/api/logout", "POST", {});
    this.profile = null; this.revision = 0;
  }
}
