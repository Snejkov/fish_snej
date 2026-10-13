import * as THREE from "three";
import { SnejAngler } from "./angler.js?v=menu-retrieve-1";
import { RODS, rodForLength } from "./rods.js?v=0.0.5a";
import { SnejInventory } from "./gear/inventory.js";
import { SnejCatchLog } from "./game/catchLog.js";
import { SnejStats } from "./game/stats.js";
import { SnejWorldClock } from "./game/clock.js?v=development-day1";
import { SnejAudio, DEFAULT_AMBIENT_VOLUME, AMBIENT_DEFAULTS_VERSION, migrateAmbientSettings } from "./audio.js?v=0.0.5a-hf8";
import {
  SnejCastSystem, SPLASH_BASE, SPLASH_MIN, SPLASH_SCALE,
  STARTLE_R, STARTLE_SEC, WAKE_BOB_AMP, WAKE_BOB_FREQ
} from "./castSystem.js?v=menu-retrieve-1";
import { DEFAULT_FLOAT_DEPTH, FLOAT_RETRIEVE_FRACTION, SnejFloatRig, limitLineEnd, writeFixedLine } from "./floatRig.js?v=rod-lift-1";
import { SnejDesktopCursor, editableTarget } from "./desktopCursor.js?v=menu-retrieve-1";
import { fishingMeters, fishingWorld } from "./fishingUnits.js?v=shore-cast-2";
import { SnejAuth, SNEJKOV_ID, SNEJKOV_NAME } from "./auth.js";
import { SnejServerClient, editableProfile } from "./serverClient.js?v=cast-bait-error-1";
import { DEFAULT_LANGUAGE, normalizeLanguage, setLanguage, t, translateText, errorMessage } from "./i18n.js";
import { resolveLake } from "./lakeValidator.js";
import { SNEJ_FIXED_SEED, WORLD_SIZE, WATER_REGION } from "./lake.js";
import { SnejMultiplayerClient } from "./multiplayer/client.js";
import { makePresence } from "./multiplayer/presence.js?v=camera-cast-1";
import { SnejRemotePlayerRoom } from "./multiplayer/room.js";
import { SnejPlacementSystem } from "./placement.js";
import { SnejSky } from "./sky.js";
import { SPAWNS, SPAWN_INITIAL_NAME, SPAWN_NAMES } from "./spawns.js";
import { SnejTerrain } from "./terrain.js";
import { SnejTextureManager } from "./textureManager.js";
import { SnejUI } from "./ui.js?v=menu-retrieve-1";
import { SnejMobileInput, movementInput, requestLandscape } from "./mobileInput.js?v=closer-view-1";
import { SnejWater } from "./water.js?v=0.0.5a-hf3";
import { clamp, clamp01, damp, lerp, moveDelta, resolveWalkableStart } from "./util.js?v=0.0.3-hf2.12";

const SAVE_KEY = "snejfishing-save-v1";
const SAVE_VERSION = 5;
const IDENTITY_SAVE_VERSION = 3;
const EYE_H = 1.62;
const PLAYER_RADIUS = 0.34;
const MAX_WADE_DEPTH = 1.0;
const CAM_PULL_MIN = 1.1;
const CAM_DIST = 4.6 * 0.7;
const TOUCH_CAM_DIST = 3.3 * 0.7;
const VIEW_TRANSITION_TIME = 0.18;
const CAST_LOOK_SCALE = 0.06;
const CAST_LOOK_SPEED = 0.12;
export const ROD_LIFT_TIME = 0.4;
const NORMAL_FOV = 70;
export function squintFov(weight = 1) {
  return 2 * Math.atan(Math.tan(NORMAL_FOV * Math.PI / 360) / (1 + 0.5 * clamp01(weight))) * 180 / Math.PI;
}

const DEFAULT_SETTINGS = {
  volume: 0.7,
  bgm: DEFAULT_AMBIENT_VOLUME,
  ambientDefaultsVersion: AMBIENT_DEFAULTS_VERSION,
  sens: 1.0,
  quality: "mid",
  shadow: true,
  autoSprint: false,
  randomLake: false,
  rodLength: 4,
  floatDepth: DEFAULT_FLOAT_DEPTH,
  lang: DEFAULT_LANGUAGE
};

export class SnejFishingGame {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.mode = "title";
    this.settings = { ...DEFAULT_SETTINGS };
    this.auth = new SnejAuth();
    this.identity = null;
    this.nextLocalId = 1;
    this.currentRank = "player";
    this.server = new SnejServerClient({ onProfile: (profile, kind) => this.applyServerProfile(profile, kind) });
    this.serverBusy = false;
    this.serverReady = null;
    this.serverDetectionFailed = false;
    this.hasProgress = false;
    this.seed = SNEJ_FIXED_SEED;
    this.worldClock = new SnejWorldClock();
    this.state = { clock: this.worldClock.hour() };
    this.currentSpawn = SPAWN_INITIAL_NAME;
    this.pos = new THREE.Vector3(SPAWNS.initial.x, SPAWNS.initial.y, SPAWNS.initial.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.08;
    this.camDist = CAM_DIST;
    this.cameraMode = "third-person";
    this.viewBlend = 1;
    this.viewTransition = null;
    this.keys = new Set();
    this.castOrigin = new THREE.Vector3();
    this.castTip = new THREE.Vector3();
    this.castAimDirection = new THREE.Vector3();
    this.castSurfacePoint = new THREE.Vector3();
    this.cast = new SnejCastSystem({ rodRange: RODS[0].range, floatDepth: DEFAULT_FLOAT_DEPTH,
      getCastOrigin: () => this.angler.getCastOrigin(this.castOrigin,
        this.castContext?.cameraAim && ["idle", "aim", "charge"].includes(this.cast.state.fs) ? this.cast.state.aimYaw : undefined) });
    this.floatRig = new SnejFloatRig();
    this.castMesh = null;
    this.castLine = null;
    this.depthLine = null;
    this.hookMesh = null;
    this.aimMarker = null;
    this.castMeter = document.getElementById("cast-meter");
    this.castMeterFill = this.castMeter.querySelector(".cast-meter-fill");
    this.castMeterTarget = this.castMeter.querySelector(".cast-meter-target");
    this.castMeterTol = this.castMeter.querySelector(".cast-meter-tol");
    this.castMeterDistance = this.castMeter.querySelector(".cast-meter-distance");
    this.castMeterStatus = this.castMeter.querySelector(".cast-meter-status");
    this.castMeterCursor = this.castMeter.querySelector(".cast-meter-cursor");
    this.castActions = document.getElementById("cast-actions");
    this.castCancelButton = document.getElementById("cast-cancel");
    this.castInstruction = document.getElementById("cast-instruction");
    this.rodReadout = document.getElementById("rod-line");
    this.floatDepthInput = document.getElementById("float-depth");
    this.floatDepthReadout = document.getElementById("float-depth-line");
    this.castContext = {
      strictTarget: true,
      holdCast: true,
      cameraAim: true,
      waterSurfaceY: (x, z) => this.water.surfaceY(x, z),
      terrainHeightAt: (x, z) => this.castGroundHeight(x, z),
      terrainDepthAt: (x, z) => this.water.surfaceY(x, z) - this.castGroundHeight(x, z),
      isWaterAt: (x, z) => this.isCastWater(x, z),
      dockBlocksSegment: (a, b) => this.terrain.dockBlocksSegment(a.x, a.y, a.z, b.x, b.y, b.z),
      lineObstruction: (a, b, slack) => this.lineObstruction(a, b, slack),
      aimBlockedByDome: () => null,
      aimRay: null,
      rodReel: 0
    };
    this.floatContext = {
      playerOrigin: this.pos,
      surfaceY: (x, z) => this.water.surfaceY(x, z),
      bedY: (x, z) => this.castGroundHeight(x, z),
      isWaterAt: (point) => this.cast.isRigWaterAt(point),
      lineObstruction: (a, b, slack) => this.lineObstruction(a, b, slack)
    };
    this.mouse = { dx: 0, dy: 0 };
    this.castAdjusting = false;
    this.time = 0;
    this.stepTimer = 0;
    this.moveAmt = 0;
    this.moveSpeed = 0;
    this.lastFrame = performance.now();
    this.lastSave = 0;
    this.presenceTimer = 0;
    this.presenceSeq = 0;
    this.playerName = "Player";
    this.lastRoom = "snej-1";
    this.mpEnabled = new URLSearchParams(location.search).get("mp") === "1";

    const initialSave = this.loadSave();
    this.inventory = new SnejInventory(initialSave?.player?.inventory);
    this.catchLog = new SnejCatchLog(initialSave?.player?.catchLog);
    this.stats = new SnejStats(initialSave?.player?.stats);
    this.stats.stampSeen();
    this.uiRefreshInventory = () => this.ui?.refreshInventory();
    this.uiRefreshProfile = () => this.ui?.refreshProfile();
    if (initialSave) {
      this.settings = { ...DEFAULT_SETTINGS, ...initialSave.settings, randomLake: false };
      this.identity = initialSave.player.identity || null;
      this.nextLocalId = Math.max(
        1,
        Number(initialSave.player.nextLocalId) || 1,
        Number(this.identity?.nextLocalId) || 1
      );
      this.playerName = this.identity?.name || initialSave.player.name || "Player";
      this.currentSpawn = SPAWN_NAMES.includes(initialSave.player.spawn)
        ? initialSave.player.spawn
        : SPAWN_INITIAL_NAME;
      this.lastRoom = initialSave.multiplayer?.lastRoom || "snej-1";
      this.hasProgress = Boolean(initialSave.player.lastPosition);
      if (this.identity) this.refreshDerivedRank();
    }
    this.settings.lang = normalizeLanguage(this.settings.lang);
    setLanguage(this.settings.lang, { persist: false });
    this.settings.rodLength = this.inventory.equippedRod().length;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1800);
    this.castCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 1800);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.settings.quality !== "low",
      powerPreference: "high-performance"
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.78;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = Boolean(this.settings.shadow);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.textureManager = new SnejTextureManager();
    this.placementSystem = new SnejPlacementSystem(this, this.textureManager);
    this.nameplateLayer = document.createElement("div");
    this.nameplateLayer.className = "player-nameplates";
    this.nameplateLayer.dataset.i18nSkip = "true";
    document.getElementById("app").appendChild(this.nameplateLayer);
    this.remoteRoom = new SnejRemotePlayerRoom({ labelRoot: this.nameplateLayer });
    this.audio = new SnejAudio(this.settings);
    this.ui = new SnejUI(this);
    this.multiplayer = new SnejMultiplayerClient({
      onStatus: (status) => {
        this.ui.setNetworkStatus(status);
        if (["Offline", "Connection failed", "Connecting"].includes(status)) this.remoteRoom.clear();
        this.refreshPeerList();
        if (this.server.enabled && ["Offline", "Connection failed"].includes(status)
          && ["playing", "connecting"].includes(this.mode) && !this.intentionalDisconnect) this.pause();
      },
      onPresence: (message) => {
        this.remoteRoom.applyPresence(message);
        this.refreshPeerList();
      },
      onLeave: (clientId) => {
        this.remoteRoom.remove(clientId);
        this.refreshPeerList();
      },
      onPlacements: (placements) => this.applyRemotePlacements(placements),
      onIdentityAssigned: (assignment) => this.handleIdentityAssignment(assignment),
      onChat: (message) => this.ui.chat.receive(message),
      onChatError: (error) => this.ui.chat.error(error),
      onWelcome: (message) => {
        if (!this.server.enabled) return;
        this.server.accept(message.profile, "refresh");
        const p = message.profile.state.position;
        this.applyStart(p, { mode: p.view, pitch: p.pitch });
        this.remoteRoom.clear();
        if (this.mode === "connecting") this.mode = "playing";
      },
      onRevision: (revision) => this.server.noteRevision(revision),
      onSessionEnded: () => this.handleAccountError({ status: 401, message: "Please sign in again." })
    });
    if (options.bootstrapSnejkov || this.identity?.name === SNEJKOV_NAME || this.identity?.id === SNEJKOV_ID) {
      this.bootstrapDeveloperIdentity();
    }
    this.buildWorld();
    this.applyStart(this.lake.start, { mode: "third-person", pitch: -0.12 });
    this.installEvents();
    this.desktopCursor = new SnejDesktopCursor({ canvas: this.canvas,
      canInteract: () => this.canDesktopCapture(),
      onCapture: () => { this.desktopMouseActive = true; this.castPointer = null; this.mouse.dx = this.mouse.dy = 0; this.audio.resume(); },
      onRelease: () => { this.mouse.dx = this.mouse.dy = 0; }
    });
    this.mobileInput = new SnejMobileInput({
      canvas: this.canvas, controls: this.ui.el.mobileControls,
      canInteract: () => this.canCast() && !this.ui.rosterOpen,
      onCastStart: () => this.beginHoldCast(),
      onCastEnd: () => this.endHoldCast(),
      onRetrieve: () => this.retrieveCast(),
      onSquintChange: (held) => this.setSquint(held, "mobile"),
      onCastCancel: () => { if (this.holdCasting || this.castApproval) this.cancelCastAction(); },
      onAvailability: (enabled) => document.documentElement.classList.toggle("touch-device", enabled)
    });
    this.resize();
    if (this.identity) this.ui.showTitle(true);
    else this.ui.showRegistration(true);
    requestAnimationFrame((time) => this.frame(time));
    this.serverReady = this.initializeAccount();
  }

  async initializeAccount() {
    try {
      const enabled = await this.server.probe();
      this.serverDetectionFailed = false;
      this.multiplayer.authenticated = enabled;
      this.ui.configureAccount(enabled);
      if (enabled && !this.server.profile) {
        this.identity = null;
        this.currentRank = "player";
        this.hasProgress = false;
        this.ui.showRegistration(true);
      }
      if (enabled && this.server.profile) this.ui.showTitle(true);
      return true;
    } catch (error) {
      this.serverDetectionFailed = true;
      this.ui.configureAccount(true);
      this.ui.showRegistration(true);
      this.ui.showToast(error.message);
      return false;
    }
  }

  applyServerProfile(profile, kind) {
    const state = profile.state;
    if (kind === "restore") {
      this.identity = { ...profile.user, nextLocalId: profile.user.id + 1 };
      this.playerName = profile.user.name;
      this.currentRank = profile.user.role;
      this.inventory = new SnejInventory();
      // Authoritative accounts must not receive the local migration's starter-item defaults.
      this.inventory.state = { ...JSON.parse(JSON.stringify(state.inventory)), coins: profile.coins };
      this.catchLog = new SnejCatchLog({ entries: state.catchLog });
      this.stats = new SnejStats(state.stats);
      this.settings = { ...DEFAULT_SETTINGS, ...state.settings };
      setLanguage(this.settings.lang, { persist: false });
      if (this.audio) this.audio.settings = this.settings;
      if (this.angler) this.applyRod(this.inventory.equippedRod());
      if (this.lake) this.applyStart(state.position, { mode: state.position.view, pitch: state.position.pitch });
      this.hasProgress = true;
      this.ui?.showRegistration(false);
    } else {
      // Pending browser settings/sets stay local until their queued save succeeds.
      this.inventory.state.coins = profile.coins;
      this.inventory.state.owned = { ...state.inventory.owned };
      if (kind === "command") {
        this.inventory.state.equipped = { ...state.inventory.equipped };
        if (this.settings.rodLength !== this.inventory.equippedRod().length) this.applyRod(this.inventory.equippedRod());
      }
    }
    this.ui?.syncSettings();
    this.ui?.updateProfile();
    this.ui?.refreshInventory();
  }

  async authenticatePlayer(name) {
    if (this.serverBusy) return { ok: false, message: "Please try again shortly." };
    this.serverBusy = true;
    const entry = this.beginDesktopEntry({ guest: this.server.enabled });
    try {
      await this.serverReady;
      if (this.serverDetectionFailed && !await this.initializeAccount()) return { ok: false, message: "Connection failed" };
      if (!this.server.enabled) return this.registerPlayer(name);
      await this.server.enterGuest(name.trim());
      this.ui.showTitle(true);
      await this.enterServerLake();
      return { ok: true };
    } catch (error) { return { ok: false, message: error.message }; }
    finally { this.serverBusy = false; this.finishDesktopEntry(entry); }
  }

  async serverCommand(action, itemId) {
    if (this.serverBusy || !this.server.profile) return { ok: false, message: "Please try again shortly." };
    this.serverBusy = true;
    try {
      await this.server.command(action, itemId);
      return { ok: true, message: action === "buy" ? "Purchased." : action === "equip" ? "Equipped" : "Bait used." };
    } catch (error) { this.handleAccountError(error); return { ok: false, message: error.message }; }
    finally { this.serverBusy = false; }
  }

  buyGear(itemId) { return this.server.enabled ? this.serverCommand("buy", itemId) : this.inventory.buy(itemId); }

  handleAccountError(error) {
    if (error.status === 401) {
      this.disconnectMultiplayer();
      this.server.profile = null;
      this.identity = null;
      this.currentRank = "player";
      this.hasProgress = false;
      this.mode = "title";
      this.cast.reset();
      this.keys.clear();
      if (this.ui.inventoryOpen) this.ui.closeInventory();
      if (this.ui.profileOpen) this.ui.closeProfile();
      this.ui.showPause(false);
      this.ui.showRegistration(true);
      if (document.pointerLockElement) document.exitPointerLock();
    }
    this.ui.showToast(error.message);
  }

  installEvents() {
    window.addEventListener("pointerdown", event => { this.desktopMouseActive = event.pointerType === "mouse"; }, true);
    window.addEventListener("touchstart", () => { this.desktopMouseActive = false; }, { capture: true, passive: true });
    window.addEventListener("mousedown", event => {
      if (!this.isTouchCompatibilityEvent(event)) this.desktopMouseActive = true;
    }, true);
    this.castCancelButton.addEventListener("click", () => this.cancelCastAction());
    // Safari can emit compatibility mouse events after a long touch ends.
    for (const type of ["touchstart", "touchend", "touchcancel"]) {
      document.addEventListener(type, () => { this.lastTouchCanvas = performance.now(); }, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.worldClock.refresh(true);
    });
    window.addEventListener("pageshow", () => this.worldClock.refresh(true));
    window.addEventListener("focus", () => this.worldClock.refresh(true));
    this.floatDepthInput.addEventListener("change", () => {
      if (!this.selectFloatDepth(fishingWorld(this.floatDepthInput.valueAsNumber))) this.floatDepthInput.value = String(fishingMeters(this.settings.floatDepth));
    });
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || editableTarget(event.target) || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName)) return;
      if (this.desktopCursor?.handleKey(event)) return;
      if (event.code === "Backquote") return;
      if (this.ui.chat?.open) {
        if (event.code === "Escape") { event.preventDefault(); this.ui.chat.toggle(false); }
        return;
      }
      if (event.code === "Enter" && !event.repeat && this.ui.chat?.available()) {
        event.preventDefault();
        this.ui.chat.toggle(true);
        return;
      }
      if (event.code === "Tab" && !this.ui.inventoryOpen && !this.ui.profileOpen && !this.ui.modalOpen && this.identity
        && ["playing", "paused", "connecting"].includes(this.mode)) {
        event.preventDefault();
        if (!event.repeat) this.ui.toggleRoster();
        return;
      }
      if (event.code === "KeyP" && !event.repeat && this.identity) {
        this.ui.toggleProfile();
        return;
      }
      if (event.code === "KeyI" && !event.repeat && this.identity) {
        this.ui.toggleInventory();
        return;
      }
      if (event.code === "KeyU" && !event.repeat) this.ui.toggleHUD();
      if (event.code === "KeyZ") {
        if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
        if (!event.repeat && this.setSquint(true, "keyboard")) event.preventDefault();
        return;
      }
      if (event.code === "KeyC" && !event.repeat && this.canCast()) {
        this.keyboardCastHeld = this.beginHoldCast();
        return;
      }
      if (event.code === "KeyV" && !event.repeat && this.mode === "playing" && !this.ui.buildOpen && !this.ui.profileOpen && !this.ui.inventoryOpen && !this.ui.modalOpen) {
        this.toggleView();
        return;
      }
      if (event.code === "KeyB" && !event.repeat && this.mode === "playing") {
        this.toggleBuildMode();
        return;
      }
      if (event.code === "Escape") {
        if (this.ui.rosterOpen) this.ui.toggleRoster(false);
        else if (this.ui.modalOpen) this.ui.closeNameModal();
        else if (this.ui.inventoryOpen) this.ui.closeInventory();
        else if (this.ui.buildOpen) this.ui.discardBuild();
        else if (this.ui.profileOpen) this.ui.closeProfile();
        else if (["aim", "charge"].includes(this.cast.state.fs)) this.cancelCastAction();
        else if (this.mode === "playing") this.pause();
        else if (this.mode === "paused") this.resume();
        return;
      }
      if (this.ui.inventoryOpen || this.ui.profileOpen || this.ui.modalOpen) return;
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
      if (event.code === "KeyZ") this.setSquint(false, "keyboard");
      if (event.code === "KeyC" && this.keyboardCastHeld) { this.keyboardCastHeld = false; this.endHoldCast(); }
    });
    window.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement === this.canvas && this.mode === "playing" && this.canDesktopCapture()) {
        this.mouse.dx += event.movementX;
        this.mouse.dy += event.movementY;
      } else if (!this.isTouchCompatibilityEvent(event)) {
        this.updateCastPointer(event.clientX, event.clientY);
      }
    });
    this.canvas.addEventListener("pointerdown", (event) => {
      if (["touch", "pen"].includes(event.pointerType)) this.lastTouchCanvas = performance.now();
      if (this.mode === "playing" && this.ui.buildOpen) this.placementSystem.handlePointerDown(event);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.mode === "playing" && this.ui.buildOpen) this.placementSystem.handlePointerMove(event);
    });
    window.addEventListener("pointerup", () => this.placementSystem.handlePointerUp());
    for (const surface of [this.canvas, this.ui.el.mobileLook]) {
      surface.addEventListener("pointerdown", (event) => {
        if (["touch", "pen"].includes(event.pointerType)) this.lastTouchCanvas = performance.now();
      });
      surface.addEventListener("touchstart", () => { this.lastTouchCanvas = performance.now(); }, { passive: true });
      surface.addEventListener("mousedown", (event) => {
        if (event.button !== 0 || this.isTouchCompatibilityEvent(event)) return;
        this.desktopMouseActive = true;
        event.preventDefault();
        if (this.desktopCursor && !this.desktopCursor.manualFree && document.pointerLockElement !== this.canvas) {
          // A camera-recapture click must never double as a throw or a retrieval.
          this.desktopCursor.captureAutomatically();
          return;
        }
        const lifting = this.cast.state.fs === "wait";
        this.desktopCastHeld = lifting ? false : this.beginHoldCast();
        const started = lifting ? this.beginRodLift() : this.desktopCastHeld;
        if (started && !this.desktopCursor?.manualFree && document.pointerLockElement !== this.canvas) this.desktopCursor?.captureAutomatically();
      });
      surface.addEventListener("click", (event) => {
        if (this.isTouchCompatibilityEvent(event) || !this.canCast() || ["aim", "charge", "flight"].includes(this.cast.state.fs)) return;
        this.audio.resume();
        this.desktopCursor?.captureAutomatically();
      });
    }
    const releaseMouseCast = event => {
      if (this.isTouchCompatibilityEvent(event)) return;
      if (event.button === 0 && this.desktopCastHeld) { this.desktopCastHeld = false; this.endHoldCast(); }
    };
    // Pointer release survives a missing compatibility mouseup or a UI bubble stop.
    window.addEventListener("pointerup", releaseMouseCast, true);
    window.addEventListener("mouseup", releaseMouseCast, true);
    window.addEventListener("pointercancel", () => { this.endRodLift(); if (this.desktopCastHeld) this.cancelCastAction(); });
    window.addEventListener("blur", () => { this.endRodLift(); this.resetSquint(); if (["aim", "charge"].includes(this.cast.state.fs)) this.cancelCastAction(); });
    window.addEventListener("resize", () => this.resetSquint());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { this.endRodLift(); this.resetSquint(); }
      if (document.hidden && ["aim", "charge"].includes(this.cast.state.fs)) this.cancelCastAction();
    });
  }

  isTouchCompatibilityEvent(event) {
    return ["touch", "pen"].includes(event.pointerType) || event.sourceCapabilities?.firesTouchEvents
      || (!event.pointerType && !event.sourceCapabilities && this.lastTouchCanvas != null && performance.now() - this.lastTouchCanvas < 800);
  }

  requestMobileLandscape() {
    if (this.mobileInput?.enabled && this.desktopMouseActive !== true) void requestLandscape();
  }

  checkCastBait() {
    // Early feedback never replaces the server's own inventory checks.
    if (!this.inventory || this.inventory.countOf(this.inventory.state.equipped.bait) > 0) return true;
    this.audio.deny();
    this.ui.showToast("No bait.");
    return false;
  }

  retrieveCast() {
    // Retrieval needs no spare bait and never starts another charged cast.
    if (!this.canCast() || this.cast.state.fs !== "wait" || this.castLanding) return false;
    if (!this.cast.startRetrieve("manual")) return false;
    this.endRodLift();
    this.resetSquint();
    this.mobileInput?.reset();
    this.updateCastControls(true);
    return true;
  }

  beginRodLift() {
    if (!this.canCast() || this.cast.state.fs !== "wait" || this.cast.state.retrieving || this.castLanding || this.rodLiftAction) return false;
    this.rodLiftAction = { elapsed: 0 };
    this.rodLiftHeld = true;
    this.audio.resume();
    return true;
  }

  endRodLift() {
    const held = Boolean(this.rodLiftHeld);
    this.rodLiftHeld = false;
    this.rodLiftAction = null;
    return held;
  }

  updateRodLift(dt) {
    if (!this.canCast() || this.cast.state.fs !== "wait" || this.cast.state.retrieving || this.castLanding) {
      this.endRodLift();
      return;
    }
    if (!this.rodLiftAction) return;
    this.rodLiftAction.elapsed += Math.max(0, dt);
    // One click lifts, then returns the empty rig. A new cast needs a fresh press.
    if (this.rodLiftAction.elapsed >= ROD_LIFT_TIME) this.retrieveCast();
  }

  canSquint() {
    return this.canCast() && this.cast.state.fs === "wait" && !this.cast.state.retrieving && !this.castLanding;
  }

  setSquint(held, source) {
    const key = source === "keyboard" ? "keyboardSquintHeld" : "mobileSquintHeld";
    this[key] = Boolean(held) && this.canSquint();
    return this[key];
  }

  resetSquint() {
    this.keyboardSquintHeld = this.mobileSquintHeld = false;
    this.squintWeight = 0;
    if (this.camera && this.camera.fov !== NORMAL_FOV) {
      this.camera.fov = NORMAL_FOV;
      this.camera.updateProjectionMatrix();
    }
  }

  updateSquint(dt) {
    if (!this.canSquint()) this.resetSquint();
    else {
      const target = this.keyboardSquintHeld || this.mobileSquintHeld ? 1 : 0;
      this.squintWeight = damp(this.squintWeight || 0, target, 12, Math.max(0, dt));
      if (Math.abs(this.squintWeight - target) < 0.0001) this.squintWeight = target;
    }
    const fov = squintFov(this.squintWeight || 0);
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  beginHoldCast() {
    if (!this.canCast() || this.castApproval || this.cast.state.fs !== "idle") return false;
    if (!this.checkCastBait()) return false;
    const direction = this.angler.rig?.getWorldDirection(new THREE.Vector3());
    this.castHeading = direction ? Math.atan2(direction.x, direction.z) : this.yaw + (this.angler.heading || 0);
    if (this.castContext?.cameraAim) this.castFacing = this.castHeading;
    this.updateCast(0);
    if (!this.cast.onActionDown()) return false;
    this.castEpoch = (this.castEpoch || 0) + 1;
    this.holdCasting = true;
    this.castPointer = null;
    this.floatRig.reset();
    this.keys.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.audio.resume();
    this.updateCast(0);
    return true;
  }

  endHoldCast() {
    if (!this.holdCasting || this.cast.state.fs !== "charge") return false;
    this.holdCasting = false;
    this.updateCast(0);
    if (!this.canCast() || !this.cast.state.canRelease) {
      const reason = this.cast.state.releaseBlock || "water";
      this.cancelCastAction();
      this.audio.deny(); this.ui.showToast(this.toastForCastRejection(reason));
      return false;
    }
    return this.endCastAction();
  }

  beginCastAction() {
    if (!this.canCast()) return false;
    if (["aim", "charge"].includes(this.cast.state.fs)) return this.endCastAction();
    if (this.cast.state.fs !== "idle") return false;
    if (!this.checkCastBait()) return false;
    if (!this.castWaterNearby()) { this.ui.showToast("Move closer to the water."); return false; }
    this.audio.resume();
    this.updateCast(0);
    if (!this.cast.beginTargeting()) return false;
    this.castEpoch = (this.castEpoch || 0) + 1;
    this.castPointer = null;
    this.floatRig.reset();
    this.keys.clear();
    this.mobileInput?.reset();
    if (this.desktopCursor) this.desktopCursor.release();
    else if (document.pointerLockElement) document.exitPointerLock();
    this.ui.el.toast.classList.add("hidden");
    this.updateCast(0);
    return true;
  }

  castWaterNearby() {
    const cached = this.nearbyCastWater;
    if (cached && cached.x === this.pos.x && cached.z === this.pos.z && cached.range === this.cast.castRange
      && cached.terrain === this.terrain && cached.quality === this.settings?.quality) return cached.value;
    const remember = (value) => {
      this.nearbyCastWater = { x: this.pos.x, z: this.pos.z, range: this.cast.castRange,
        terrain: this.terrain, quality: this.settings?.quality, value };
      return value;
    };
    for (let r = Math.min(0.5, this.cast.castRange); r <= this.cast.castRange + 1e-8; r += 0.25) {
      for (let i = 0; i < 32; i += 1) {
        const angle = i * Math.PI / 16;
        if (this.isCastWater(this.pos.x + Math.sin(angle) * r, this.pos.z + Math.cos(angle) * r)) return remember(true);
      }
    }
    return remember(false);
  }

  castRayFromScreen(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !rect.width || !rect.height
      || x < rect.left || y < rect.top || x > rect.left + rect.width || y > rect.top + rect.height) return null;
    const pointer = this.castScreenPoint ||= new THREE.Vector2();
    pointer.set((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2);
    this.camera.updateMatrixWorld();
    const ray = this.castScreenRay ||= new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    return ray.ray;
  }

  updateCastPointer(x, y) {
    if (!this.canCast() || !["idle", "aim"].includes(this.cast.state.fs) || !this.castRayFromScreen(x, y)) return false;
    this.castPointer = { x, y };
    this.updateCast(0);
    return this.cast.state.targetValid;
  }

  beginMarkerDrag(x, y) {
    if (!this.canCast() || this.cast.state.fs !== "idle" || !this.aimMarker.visible) return false;
    const rect = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const center = this.aimMarker.position.clone().project(this.camera);
    if (center.z < -1 || center.z > 1) return false;
    const cx = rect.left + (center.x + 1) * rect.width / 2;
    const cy = rect.top + (1 - center.y) * rect.height / 2;
    // A generous finger hit area grabs the ring; other swipes still turn the camera.
    if (Math.hypot(x - cx, y - cy) > 44) return false;
    return this.beginCastAction();
  }

  handleCastTap(x, y, allowIdle = false) {
    if (!this.canCast() || !(this.cast.state.fs === "aim" || (allowIdle && this.cast.state.fs === "idle"))) return false;
    if (!this.updateCastPointer(x, y)) {
      this.ui.showToast(this.toastForCastRejection(this.cast.state.aimOutOfReach ? "reach" : this.cast.state.releaseBlock || "water"));
      return false;
    }
    if (this.cast.state.fs === "idle") {
      if (!this.beginCastAction()) return false;
      this.updateCastPointer(x, y);
    }
    return this.endCastAction();
  }

  updateCastControls(enabled) {
    if (!this.castActions) return;
    const fs = this.cast.state.fs, session = ["aim", "charge"].includes(fs);
    this.castActions.classList.toggle("hidden", !enabled || !session);
    this.castCancelButton.classList.toggle("hidden", !session);
    const label = "Cast", retrieveMode = fs === "wait" || Boolean(this.cast.state.retrieving);
    const mobile = this.ui.el.mobileControls?.querySelector("[data-mobile-cast]");
    if (mobile) { mobile.dataset.i18n = label; mobile.textContent = t(label); mobile.hidden = retrieveMode;
      mobile.disabled = !enabled || fs === "flight" || Boolean(this.castRelease || this.castApproval); }
    const run = this.ui.el.mobileControls?.querySelector("[data-mobile-run]");
    if (run) { run.hidden = retrieveMode; run.disabled = !enabled || session || fs === "flight"; }
    const retrieve = this.ui.el.mobileControls?.querySelector("[data-mobile-retrieve]");
    if (retrieve) { retrieve.hidden = !retrieveMode;
      retrieve.disabled = !enabled || fs !== "wait" || Boolean(this.castLanding); }
    const squint = this.ui.el.mobileControls?.querySelector("[data-mobile-squint]");
    if (squint) { squint.hidden = !enabled || fs !== "wait" || Boolean(this.cast.state.retrieving);
      squint.disabled = Boolean(this.castLanding); }
    const view = this.ui.el.mobileControls?.querySelector("[data-mobile-action='view']");
    if (view) view.disabled = session;
    const turning = this.castTurn && this.castTurn.elapsed < this.castTurn.duration;
    const releasedInstruction = turning ? "Turning to cast..." : this.castRelease?.approved ? "" : "Waiting for server...";
    this.castInstruction.textContent = t(session ? this.castRelease ? releasedInstruction : this.castContext?.cameraAim
      ? "Hold to increase range. Aim with the camera, then release." : this.castContext?.holdCast
      ? "Hold to increase range. Release to cast forward." : "Move the circle, then click or lift your finger to cast." : "");
    document.documentElement.classList.toggle("cast-session", enabled && session);
  }

  endCastAction() {
    if (this.castApproval) return false;
    if (!["aim", "charge"].includes(this.cast.state.fs)) return false;
    if (!this.canCast()) { this.cancelCastAction(); return false; }
    if (!this.checkCastBait()) { this.cancelCastAction(); return false; }
    this.updateCast(0);
    if (this.castContext?.holdCast && this.castContext.cameraAim) return this.prepareCameraCast();
    if (this.cast.state.fs === "aim") {
      if (!this.cast.state.targetValid || !this.cast.selectTarget({ ...this.cast.state.aimPoint })) {
        this.ui.showToast(this.toastForCastRejection(this.cast.state.lastRejection || "water"));
        return false;
      }
      this.yaw = this.cast.state.aimYaw;
      this.updateCamera(0);
      this.updateCast(0);
    }
    if (this.server?.enabled) {
      const point = this.castContext?.holdCast ? this.cast.state.predictedLanding : this.cast.state.aimPoint;
      const pending = { selected: this.cast.state.selectedTarget, power: this.cast.state.charge,
        target: { x: point.x, y: point.y, z: point.z } };
      this.castApproval = pending;
      this.server.save(editableProfile(this)).then(() => this.server.beginCast(pending.target)).then(ticket => {
        if (this.castApproval !== pending || this.cast.state.fs !== "charge"
          || this.cast.state.selectedTarget !== pending.selected || !this.canCast()) {
          void this.server.cancelCast(ticket.castId).catch(() => {});
          return;
        }
        this.activeServerCast = ticket;
        this.cast.state.charge = pending.power;
        this.releaseCast();
        if (this.cast.state.fs !== "flight") this.cancelServerCast();
      }).catch(error => {
        if (this.castApproval === pending) { this.cancelCastAction(); this.handleAccountError(error); }
      }).finally(() => { if (this.castApproval === pending) this.castApproval = null; });
      return true;
    }
    return this.releaseCast();
  }

  prepareCameraCast() {
    if (this.castRelease || this.cast.state.fs !== "charge" || !this.cast.state.canRelease) return false;
    const state = this.cast.state, target = { ...state.aimPoint };
    const yaw = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    const start = this.castFacing ?? this.yaw + (this.angler.heading || 0);
    const delta = Math.atan2(Math.sin(yaw - start), Math.cos(yaw - start));
    const release = { epoch: this.castEpoch, power: state.charge, target, yaw, pitch: this.pitch,
      origin: { x: this.pos.x, z: this.pos.z }, approved: !this.server?.enabled };
    this.castRelease = release;
    this.castTurn = { release, start, delta, elapsed: 0, duration: clamp(Math.abs(delta) / 5, 0.16, 0.65) };
    this.updateCast(0);
    if (this.server?.enabled) {
      this.castApproval = release;
      this.server.save(editableProfile(this)).then(() => this.castRelease === release && this.castEpoch === release.epoch
        && this.cast.state.fs === "charge" && this.canCast() ? this.server.beginCast(target) : null).then(ticket => {
        if (!ticket) return;
        if (this.castRelease !== release || this.castEpoch !== release.epoch || this.cast.state.fs !== "charge" || !this.canCast()) {
          void this.server.cancelCast(ticket.castId).catch(() => {});
          return;
        }
        this.activeServerCast = ticket;
        release.approved = true;
      }).catch(error => {
        if (this.castRelease === release) { this.cancelCastAction(); this.handleAccountError(error); }
      }).finally(() => { if (this.castApproval === release) this.castApproval = null; });
    }
    return true;
  }

  updateCastTurn(dt) {
    const turn = this.castTurn;
    if (!turn) return false;
    const release = turn.release;
    if (this.castRelease !== release || this.castEpoch !== release.epoch || this.cast.state.fs !== "charge" || !this.canCast()
      || Math.hypot(this.pos.x - release.origin.x, this.pos.z - release.origin.z) > 0.00001) {
      this.cancelCastAction(); return false;
    }
    turn.elapsed += Math.max(0, dt);
    const progress = clamp01(turn.elapsed / turn.duration), smooth = progress * progress * (3 - 2 * progress);
    this.castFacing = turn.start + turn.delta * smooth;
    if (progress < 1 || !release.approved) return false;
    this.castFacing = release.yaw;
    return true;
  }

  castTipForFacing(yaw) {
    let camera = this.castCamera;
    if (this.castRelease) {
      camera = this.castPreviewCamera ||= new THREE.PerspectiveCamera();
      camera.position.set(this.pos.x, this.pos.y + EYE_H, this.pos.z);
      const pitch = this.castRelease.pitch;
      const target = this.castPreviewLook ||= new THREE.Vector3();
      target.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).add(camera.position);
      camera.lookAt(target);
    }
    return this.angler.getCastHoldTip(camera, this.castPreviewTip ||= new THREE.Vector3(), yaw);
  }

  releaseCast() {
    // Direct targeting uses the exact marker distance, never timing-dependent power.
    if (this.cast.state.selectedTarget) this.cast.state.charge = this.cast.state.targetPower;
    const released = this.cast.onActionUp();
    if (released) {
      if (this.castContext?.holdCast) {
        this.yaw = this.cast.state.aimYaw;
        this.angler.heading = 0;
      }
      if (this.cameraMode === "third-person") this.toggleView();
      this.audio.cast(this.cast.state.castPower);
    }
    else if (this.cast.state.lastRejection) {
      this.audio.deny();
      this.ui.showToast(this.toastForCastRejection(this.cast.state.lastRejection));
    }
    this.castRelease = this.castTurn = null;
    this.castFacing = null;
    this.updateCast(0);
    this.updateCastVisuals();
    return released;
  }

  cancelCastAction() {
    this.endRodLift();
    this.resetSquint();
    this.holdCasting = this.desktopCastHeld = this.keyboardCastHeld = false;
    this.castEpoch = (this.castEpoch || 0) + 1;
    this.castApproval = null;
    this.castRelease = this.castTurn = null;
    this.castFacing = null;
    this.cancelServerCast();
    this.cast.cancelCharge();
    this.castPointer = null;
    this.mobileInput?.reset();
    this.keys.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.updateCast(0);
    this.updateCastVisuals();
  }

  cancelServerCast() {
    const ticket = this.activeServerCast;
    this.activeServerCast = null;
    if (ticket && this.server?.enabled) void this.server.cancelCast(ticket.castId).catch(() => {});
  }

  resize() {
    this.castPointer = null;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const quality = this.settings.quality;
    const ratio = Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : quality === "low" ? 1 : 1.5);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  buildWorld() {
    this.angler?.model?.dispose();
    this.angler?.skeleton?.dispose();
    this.scene.clear();
    this.scene.fog = new THREE.Fog(0x8fb4cc, 90, 620);
    this.seed = SNEJ_FIXED_SEED;
    this.lake = resolveLake(SNEJ_FIXED_SEED);
    if (!this.lake.validation?.ok) console.warn("Fixed lake validator did not pass", this.lake.validation);
    this.terrain = new SnejTerrain(this.lake, this.settings);
    this.water = new SnejWater(this.settings, this.lake);
    this.sky = new SnejSky(this.scene);
    this.angler = new SnejAngler();
    this.cast.reset();
    this.applyRod(this.inventory.equippedRod());
    if (!this.castMesh) {
      this.castMesh = this.createBobberMesh();
      this.castLine = this.createCastLineMesh();
      this.depthLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.castLine.material);
      this.depthLine.name = "SnejDepthLine";
      this.depthLine.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
      this.depthLine.frustumCulled = false;
      this.hookMesh = this.createHookMesh();
      this.aimMarker = this.createMarker(0.5, 0.66, 0x9ff0ff, 0.85);
      this.aimMarker.name = "SnejCastMarker";
    }
    this.castMesh.visible = false;
    this.castLine.visible = false;
    this.depthLine.visible = false;
    this.hookMesh.visible = false;
    this.aimMarker.visible = false;
    this.castMeter.classList.add("hidden");
    this.scene.add(
      this.terrain.group,
      this.water.group,
      this.angler.group,
      this.placementSystem.group,
      this.remoteRoom.group,
      this.castMesh, this.castLine, this.depthLine, this.hookMesh, this.aimMarker
    );
    this.scene.traverse((object) => { if (object.isLight) object.layers.enable(1); });
    this.configureShadows();
    this.worldClock.refresh(true);
    this.state.clock = this.worldClock.hour();
    this.sky.update(0, this.state.clock);
  }

  configureShadows() {
    const sun = this.sky.sun;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 340;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.06;
  }

  registerPlayer(name) {
    if (this.server.enabled || this.serverDetectionFailed) return { ok: false, message: "Please sign in again." };
    try {
      const validation = this.auth.validateName(name);
      if (!validation.valid) throw new Error(validation.message);
      this.identity = validation.name === SNEJKOV_NAME
        ? this.auth.createSnejkovIdentity(this.nextLocalId)
        : this.auth.createIdentity(validation.name, this.nextLocalId);
      this.nextLocalId = this.identity.nextLocalId;
      this.inventory = new SnejInventory();
      this.catchLog = new SnejCatchLog();
      this.stats = new SnejStats();
      this.stats.stampSeen();
      this.applyRod(this.inventory.equippedRod());
      this.playerName = this.identity.name;
      this.refreshDerivedRank();
      this.save();
      this.ui.showRegistration(false);
      this.ui.showTitle(true);
      this.ui.updateProfile();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error, "Could not create the profile.") };
    }
  }

  bootstrapDeveloperIdentity() {
    if (this.server.enabled) return;
    const isSnejkov = this.identity?.id === SNEJKOV_ID && this.identity?.name === SNEJKOV_NAME;
    if (!isSnejkov) this.identity = this.auth.createSnejkovIdentity(this.nextLocalId);
    this.nextLocalId = Math.max(SNEJKOV_ID + 1, this.nextLocalId, this.identity.nextLocalId);
    this.identity = { ...this.identity, nextLocalId: this.nextLocalId };
    this.playerName = SNEJKOV_NAME;
    this.refreshDerivedRank();
    this.save();
  }

  setInitialSpawn() {
    const spawn = SPAWNS[SPAWN_INITIAL_NAME];
    this.currentSpawn = SPAWN_INITIAL_NAME;
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.yaw = spawn.yaw;
    this.pitch = spawn.pitch;
    this.cameraMode = "third-person";
    this.camDist = CAM_DIST;
    this.hasProgress = true;
  }

  changePlayerName(name) {
    if (this.server.enabled) return { ok: false, message: "Account names cannot be changed." };
    try {
      this.identity = this.auth.rename(this.identity, name);
      this.playerName = this.identity.name;
      this.multiplayer?.updateIdentity(this.identity, this.currentRank);
      this.save();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error, "Could not change the name.") };
    }
  }

  async signOut() {
    if (this.server.enabled) {
      try {
        await this.server.logout();
        this.disconnectMultiplayer();
        location.reload();
      } catch (error) { this.handleAccountError(error); }
      return;
    }
    this.nextLocalId = Math.max(this.nextLocalId, Number(this.identity?.nextLocalId) || 1);
    this.disconnectMultiplayer();
    this.identity = null;
    this.currentRank = "player";
    this.inventory = new SnejInventory();
    this.catchLog = new SnejCatchLog();
    this.stats = new SnejStats();
    this.save();
    location.reload();
  }

  handleIdentityAssignment(assignment) {
    if (this.server.enabled) return;
    if (!assignment) return;
    if (Number(assignment.id) === 0 && assignment.reason === "duplicate") {
      this.identity = this.auth.rollNewId(this.identity, this.nextLocalId);
      this.nextLocalId = this.identity.nextLocalId;
      this.playerName = this.identity.name;
      this.refreshDerivedRank();
      this.save();
      this.multiplayer.reconnect(this.identity, this.currentRank);
      return;
    }
    const id = Math.floor(Number(assignment.id));
    if (id < 1 || id === this.identity.id) return;
    this.identity = this.auth.applyGlobalId(this.identity, id);
    this.nextLocalId = Math.max(this.nextLocalId, this.identity.nextLocalId);
    this.playerName = this.identity.name;
    this.refreshDerivedRank();
    this.save();
    this.multiplayer.updateIdentity(this.identity, this.currentRank);
    this.ui.showToast(`Your global ID was adjusted to ${id} for uniqueness.`);
  }

  refreshDerivedRank() {
    this.currentRank = this.server.enabled ? this.server.profile?.user.role || "player" : this.auth.rankForId(this.identity?.id);
    this.ui?.updateProfile();
  }

  canDesktopCapture() {
    return (this.desktopEntryActive || this.mode === "playing" || this.mode === "connecting")
      && !this.ui.buildOpen && !this.ui.profileOpen && !this.ui.inventoryOpen && !this.ui.modalOpen
      && !this.ui.rosterOpen && !this.ui.chat?.open;
  }

  captureDesktopCursor() {
    return (!this.mobileInput?.enabled || this.desktopMouseActive === true)
      && this.canDesktopCapture() && Boolean(this.desktopCursor?.captureAutomatically());
  }

  beginDesktopEntry({ guest = false } = {}) {
    const epoch = this.desktopEntryEpoch = (this.desktopEntryEpoch || 0) + 1;
    this.desktopEntryActive = Boolean(this.identity || guest) && (!this.mobileInput?.enabled || this.desktopMouseActive === true);
    // Request during the launch click, before an online profile or room can await the network.
    this.captureDesktopCursor();
    return epoch;
  }

  finishDesktopEntry(epoch) {
    if (epoch !== this.desktopEntryEpoch) return;
    this.desktopEntryActive = false;
    if (!["playing", "connecting"].includes(this.mode)) this.desktopCursor?.release();
  }

  releaseDesktopCursor() {
    this.desktopEntryEpoch = (this.desktopEntryEpoch || 0) + 1;
    this.desktopEntryActive = false;
    this.desktopCursor?.release();
  }

  async newGame(options = {}) {
    const entry = this.beginDesktopEntry();
    try {
      await this.serverReady;
      if (this.serverDetectionFailed) return this.ui.showToast("Connection failed");
      if (this.server.enabled) return await this.enterServerLake();
      this.audio.resume();
      if (!options.keepConnection) this.disconnectMultiplayer();
      this.buildWorld();
      this.currentSpawn = SPAWN_INITIAL_NAME;
      this.applyStart(SPAWNS[this.currentSpawn], { mode: "third-person", pitch: SPAWNS[this.currentSpawn].pitch });
      await this.placementSystem.setPlacements([]);
      this.hasProgress = true;
      this.mode = "playing";
      this.ui.showTitle(false);
      this.ui.showPause(false);
      this.save();
    } finally { this.finishDesktopEntry(entry); }
  }

  async continueGame() {
    const entry = this.beginDesktopEntry();
    try {
      await this.serverReady;
      if (this.serverDetectionFailed) return this.ui.showToast("Connection failed");
      if (this.server.enabled) return await this.enterServerLake();
      this.audio.resume();
      this.disconnectMultiplayer();
      const save = this.loadSave();
      if (!save?.player?.lastPosition) return await this.newGame();
      this.settings = { ...DEFAULT_SETTINGS, ...(save.settings || {}), randomLake: false };
      this.settings.lang = normalizeLanguage(this.settings.lang);
      setLanguage(this.settings.lang, { persist: false });
      this.audio.settings = this.settings;
      this.identity = save.player.identity;
      this.nextLocalId = Math.max(this.nextLocalId, Number(this.identity?.nextLocalId) || 1);
      this.playerName = this.identity.name;
      this.refreshDerivedRank();
      this.lastRoom = save.multiplayer?.lastRoom || "snej-1";
      this.currentSpawn = SPAWN_NAMES.includes(save.player.spawn) ? save.player.spawn : SPAWN_INITIAL_NAME;
      this.buildWorld();
      this.applyStart(save.player.lastPosition, save.player.view);
      await this.placementSystem.setPlacements(save.placements || []);
      this.ui.syncSettings();
      this.hasProgress = true;
      this.mode = "playing";
      this.ui.showTitle(false);
      this.ui.showPause(false);
      this.save();
    } finally { this.finishDesktopEntry(entry); }
  }

  async startOnline(room) {
    if (this.server.enabled) return this.continueGame();
    this.lastRoom = String(room || "snej-1").trim().slice(0, 32) || "snej-1";
    await this.newGame({ keepConnection: true });
    this.multiplayer.connect(this.lastRoom, this.identity, this.currentRank);
    this.save();
  }

  async newLake() {
    if (this.server.enabled) return this.continueGame();
    const entry = this.beginDesktopEntry();
    try {
      const placements = this.placementSystem.serializeCommitted();
      this.buildWorld();
      this.applyStart(this.lake.start, { mode: this.cameraMode, pitch: this.pitch });
      await this.placementSystem.setPlacements(placements);
      this.mode = "playing";
      this.ui.showPause(false);
      this.save();
    } finally { this.finishDesktopEntry(entry); }
  }

  quitToTitle() {
    this.save();
    this.cast.reset();
    this.mode = "title";
    this.releaseDesktopCursor();
    this.castMeter.classList.add("hidden");
    if (this.ui.buildOpen) this.ui.discardBuild();
    if (this.ui.profileOpen) this.ui.closeProfile();
    if (this.ui.inventoryOpen) this.ui.closeInventory();
    this.disconnectMultiplayer();
    this.ui.showPause(false);
    this.ui.showTitle(true);
  }

  pause() {
    this.endRodLift();
    this.resetSquint();
    this.mode = "paused";
    this.releaseDesktopCursor();
    if (this.ui.inventoryOpen) this.ui.closeInventory();
    if (this.holdCasting || this.castApproval || ["aim", "charge"].includes(this.cast.state.fs)) this.cancelCastAction();
    else this.cast.cancelCharge();
    this.castMeter.classList.add("hidden");
    this.ui.el.toast.classList.add("hidden");
    this.keys.clear();
    this.ui.showPause(true);
    this.save();
  }

  resume({ capture = true } = {}) {
    this.audio.resume();
    this.mode = this.server.enabled && !this.multiplayer.connected ? "connecting" : "playing";
    if (this.mode === "connecting") this.multiplayer.connect("snej-1", this.identity, this.currentRank);
    this.ui.showPause(false);
    if (capture) this.captureDesktopCursor();
  }

  async enterServerLake() {
    if (!this.server.profile) { this.ui.showRegistration(true); return; }
    try {
      await this.server.pending;
      const profile = await this.server.request("/api/profile");
      this.disconnectMultiplayer();
      this.buildWorld();
      this.server.accept(profile, "restore");
      this.mode = "connecting";
      this.audio.resume();
      this.ui.showTitle(false);
      this.ui.showPause(false);
      if (!this.multiplayer.connect("snej-1", this.identity, this.currentRank)) {
        this.mode = "paused"; this.ui.showPause(true);
      }
    } catch (error) { this.handleAccountError(error); }
  }

  applyStart(position, view = {}) {
    const start = resolveWalkableStart(position, this.lake, MAX_WADE_DEPTH);
    this.pos.set(
      Number.isFinite(start.x) ? start.x : 0,
      Number.isFinite(start.y) ? start.y : 1,
      Number.isFinite(start.z) ? start.z : 0
    );
    this.yaw = Number.isFinite(start.yaw) ? start.yaw : 0;
    this.pitch = Number.isFinite(view.pitch)
      ? view.pitch
      : Number.isFinite(start.pitch) ? start.pitch : -0.08;
    this.cameraMode = view.mode === "first-person" ? "first-person" : "third-person";
    this.camDist = CAM_DIST;
    this.viewBlend = this.cameraMode === "third-person" ? 1 : 0;
    this.viewTransition = null;
    this.ui.updateViewChip(this);
  }

  toggleView() {
    if (["aim", "charge"].includes(this.cast.state.fs)) return;
    this.resetSquint();
    this.mobileInput?.reset();
    const next = this.cameraMode === "first-person" ? "third-person" : "first-person";
    this.cameraMode = next;
    this.viewTransition = {
      elapsed: 0,
      start: this.viewBlend,
      end: next === "third-person" ? 1 : 0
    };
    this.ui.updateViewChip(this);
    this.save();
  }

  toggleBuildMode() {
    if (this.cameraMode !== "third-person" || this.ui.modalOpen) return;
    if (!this.auth.can(this.currentRank, "buildMode")) {
      this.ui.showToast("Build Mode locked. Requires developer rank. Ask the project maintainer to grant you access.");
      return;
    }
    this.ui.toggleBuildPanel();
  }

  setSetting(key, value) {
    this.settings[key] = key === "randomLake" ? false : key === "lang" ? normalizeLanguage(value) : value;
    if (key === "lang") setLanguage(this.settings.lang, { persist: false });
    if (key === "volume") this.audio.setVolume(value);
    if (key === "bgm") this.audio.setBgm(value);
    if (key === "shadow" && this.renderer) this.renderer.shadowMap.enabled = Boolean(value);
    if (key === "quality") this.resize();
    this.save();
  }

  migrateSave(data) {
    if (!data || typeof data !== "object") return null;
    const sourceVersion = Math.max(1, Math.floor(Number(data.version)) || 1);
    const legacyName = data.player?.identity?.name || data.player?.name || data.multiplayer?.lastName || "Player";
    const nameValidation = this.auth.validateName(legacyName);
    const playerName = nameValidation.valid ? nameValidation.name : "Player";
    let identity = this.auth.normalizeIdentity(data.player?.identity);
    if (!identity && sourceVersion < IDENTITY_SAVE_VERSION) identity = this.auth.createIdentity(playerName, 1);
    const nextLocalId = Math.max(
      1,
      Number(data.player?.nextLocalId) || 1,
      Number(identity?.nextLocalId) || 1
    );
    if (identity) identity = { ...identity, nextLocalId };
    const sourcePosition = data.player?.lastPosition ?? data.lastPosition ?? null;
    const usesLegacyDefault = sourcePosition
      && Number(sourcePosition.x) === 0
      && Number(sourcePosition.y) === 1
      && Number(sourcePosition.z) === 0;
    const useInitialSpawn = usesLegacyDefault || (!sourcePosition && sourceVersion < 4);
    const positionSource = useInitialSpawn ? SPAWNS[SPAWN_INITIAL_NAME] : sourcePosition;
    const legacyView = data.player?.view || {};
    const mode = legacyView.mode === "first-person" ? "first-person" : "third-person";
    const lastPosition = positionSource
      ? {
        x: Number(positionSource.x) || 0,
        y: Number(positionSource.y) || 1,
        z: Number(positionSource.z) || 0,
        yaw: Number(positionSource.yaw) || 0,
        pitch: Number.isFinite(positionSource.pitch)
          ? positionSource.pitch
          : Number.isFinite(legacyView.pitch) ? legacyView.pitch : -0.08
      }
      : null;
    const settings = { ...DEFAULT_SETTINGS, ...migrateAmbientSettings(data.settings), randomLake: false };
    settings.lang = normalizeLanguage(settings.lang);
    const inventory = new SnejInventory(data.player?.inventory);
    if (sourceVersion < 5 && !data.player?.inventory) {
      const rod = rodForLength(settings.rodLength);
      inventory.state.owned[rod.id] = 1;
      inventory.state.equipped.rod = rod.id;
      inventory.state.owned[inventory.state.equipped.bait] = 4;
    }
    settings.rodLength = inventory.equippedRod().length;
    return {
      version: SAVE_VERSION,
      settings,
      player: {
        name: identity?.name || playerName,
        inventory: inventory.serialize(),
        catchLog: new SnejCatchLog(data.player?.catchLog).serialize(),
        stats: new SnejStats(data.player?.stats).serialize(),
        ...(identity ? { identity } : {}),
        nextLocalId,
        lastPosition,
        spawn: SPAWN_NAMES.includes(data.player?.spawn) ? data.player.spawn : SPAWN_INITIAL_NAME,
        view: {
          mode,
          camDist: CAM_DIST,
          pitch: Number.isFinite(legacyView.pitch) ? legacyView.pitch : lastPosition?.pitch ?? -0.08
        }
      },
      seed: SNEJ_FIXED_SEED,
      placements: Array.isArray(data.placements) ? data.placements : [],
      multiplayer: {
        lastRoom: data.multiplayer?.lastRoom || "snej-1"
      }
    };
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const migrated = this.migrateSave(parsed);
      if (migrated && JSON.stringify(parsed) !== JSON.stringify(migrated)) {
        localStorage.setItem(SAVE_KEY, JSON.stringify(migrated));
      }
      return migrated;
    } catch {
      return null;
    }
  }

  save() {
    if (this.server?.enabled) {
      if (!this.server.profile) return;
      const desired = editableProfile(this);
      this.server.save(desired).catch((error) => this.handleAccountError(error));
      this.ui?.refreshContinue();
      return;
    }
    if (this.serverDetectionFailed) return;
    if (this.identity) this.nextLocalId = Math.max(this.nextLocalId, this.identity.nextLocalId);
    this.settings.rodLength = this.inventory.equippedRod().length;
    this.stats.stampSeen();
    const data = {
      version: SAVE_VERSION,
      settings: {
        volume: this.settings.volume,
        bgm: this.settings.bgm,
        ambientDefaultsVersion: this.settings.ambientDefaultsVersion,
        sens: this.settings.sens,
        quality: this.settings.quality,
        shadow: this.settings.shadow,
        autoSprint: this.settings.autoSprint === true,
        randomLake: false,
        rodLength: this.settings.rodLength,
        floatDepth: this.settings.floatDepth,
        lang: this.settings.lang
      },
      player: {
        name: this.identity?.name || this.playerName,
        inventory: this.inventory.serialize(),
        catchLog: this.catchLog.serialize(),
        stats: this.stats.serialize(),
        ...(this.identity ? {
          identity: {
            name: this.identity.name,
            id: this.identity.id,
            registeredAt: this.identity.registeredAt,
            nextLocalId: this.identity.nextLocalId
          }
        } : {}),
        nextLocalId: this.nextLocalId,
        lastPosition: this.hasProgress
          ? { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch }
          : null,
        spawn: this.currentSpawn,
        view: { mode: this.cameraMode, camDist: CAM_DIST, pitch: this.pitch }
      },
      seed: SNEJ_FIXED_SEED,
      placements: this.placementSystem?.serializeCommitted() || [],
      multiplayer: { lastRoom: this.lastRoom }
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      this.ui?.showToast("Local save storage is unavailable.");
    }
    this.ui?.refreshContinue();
  }

  async deleteTexture(textureId) {
    try {
      await this.textureManager.remove(textureId);
      this.placementSystem.removeByTexture(textureId);
      this.placementSystem.commit();
      this.placementSystem.setTexture(null);
      this.save();
      this.broadcastPlacements();
      await this.ui.refreshTextures();
      this.ui.showToast("Texture and its placements deleted.");
    } catch (error) {
      this.ui.showToast(errorMessage(error, "Could not delete the texture."));
    }
  }

  async applyRemotePlacements(placements) {
    await this.placementSystem.setPlacements(placements);
    this.save();
  }

  broadcastPlacements() {
    this.multiplayer.sendPlacements(this.placementSystem.serializeCommitted());
  }

  refreshPeerList() {
    if (!this.ui || !this.multiplayer) return;
    const peers = this.remoteRoom.listPeers();
    if (this.multiplayer.connected && this.identity) {
      peers.push({ id: this.identity.id, name: this.identity.name, rank: this.currentRank });
    }
    peers.sort((a, b) => a.id - b.id);
    this.ui.updatePeerList(peers);
  }

  disconnectMultiplayer() {
    this.endRodLift();
    this.resetSquint();
    this.intentionalDisconnect = true;
    this.multiplayer?.disconnect();
    this.intentionalDisconnect = false;
    this.remoteRoom.clear();
    this.ui?.toggleRoster(false);
    this.refreshPeerList();
  }

  frame(now) {
    const dt = clamp((now - this.lastFrame) / 1000, 0, 0.1);
    this.lastFrame = now;
    this.update(dt);
    this.render();
    requestAnimationFrame((time) => this.frame(time));
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    if (!this.angler?.armOnly) return;
    const layers = this.camera.layers.mask;
    const autoClear = this.renderer.autoClear;
    const shadowUpdate = this.renderer.shadowMap.autoUpdate;
    const background = this.scene.background;
    // Draw the same raised arm after the world so nearby terrain cannot slice through it.
    try {
      this.camera.layers.set(1);
      this.renderer.autoClear = false;
      this.renderer.shadowMap.autoUpdate = false;
      this.scene.background = null;
      this.renderer.clearDepth();
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.camera.layers.mask = layers;
      this.renderer.autoClear = autoClear;
      this.renderer.shadowMap.autoUpdate = shadowUpdate;
      this.scene.background = background;
    }
  }

  update(dt) {
    this.ui.chat?.update();
    const mobileActive = this.canCast() && !this.ui.rosterOpen;
    if (!mobileActive || this.cast.state.fs !== "wait" || this.cast.state.retrieving) this.endRodLift();
    this.mobileInput?.setActive(mobileActive);
    if (this.ui.el?.mobileOrientation) this.ui.el.mobileOrientation.hidden = !this.mobileInput?.enabled || !mobileActive;
    this.worldClock.refresh();
    this.state.clock = this.worldClock.hour();
    const paused = this.mode === "paused" || this.mode === "title";
    const sceneDt = paused ? 0 : dt;
    this.time += sceneDt;
    this.updateRodLift(sceneDt);
    const previousX = this.pos.x;
    const previousZ = this.pos.z;
    if (this.mode === "playing") {
      this.stats.tickPlaytime(dt);
    }
    if (this.mode === "playing" && !this.ui.buildOpen && !this.ui.profileOpen && !this.ui.inventoryOpen && !this.ui.modalOpen && !this.ui.chat?.open) {
      this.updateLook(sceneDt);
      this.updateMove(dt);
    } else {
      this.moveAmt = 0;
      this.moveSpeed = 0;
    }
    this.updateCamera(sceneDt);
    this.updateCast(this.canCast() ? sceneDt : 0);
    if (this.sky) this.sky.update(sceneDt, this.state.clock, this.camera, this.pos);
    if (this.terrain) {
      this.terrain.updateWind(this.time, 0.8);
      this.terrain.updateTrees(dt, this.camera.position);
      this.terrain.updateLamp(this.sky?.nightAmount || 0, sceneDt);
      this.terrain.updateUnderwaterProps(this.time, this.camera, this.terrain.lake.dockDir, 0.4);
      this.terrain.updateShore(this.water?.time || 0, this.water?.wind || 0.8);
    }
    if (this.water) {
      this.water.update(sceneDt, this.camera, this.sky);
      this.water.capture(this.renderer, this.scene, this.camera);
      this.water.captureReflection(this.renderer, this.scene, this.camera);
    }
    if (this.audio && this.terrain) this.audio.setUnderwater(this.camera.position.y < -0.1);
    if (this.angler && this.terrain) {
      this.angler.group.position.copy(this.pos);
      this.angler.group.rotation.y = this.castFacing ?? this.yaw;
      if (this.castFacing != null) this.angler.heading = 0;
      const travelX = this.pos.x - previousX;
      const travelZ = this.pos.z - previousZ;
      this.angler.update(sceneDt, {
        state: this.mode,
        speed: sceneDt > 0 ? Math.hypot(travelX, travelZ) / sceneDt : 0,
        directionX: travelX,
        directionZ: travelZ,
        depth: this.terrain.depthAt(this.pos.x, this.pos.z),
        castState: this.cast.state.fs,
        castRetrieving: this.cast.state.retrieving,
        rodLiftHeld: this.rodLiftHeld,
        castBobber: this.cast.state.fs === "wait" || this.cast.state.retrieving ? this.cast.state.bobber : null,
        castLineLength: this.cast.state.retrieving ? this.cast.rig.lineLength - this.cast.state.retrieveDepth : this.cast.rig.upperLine,
        rodLiftAllowed: this.rodLiftAllowed ||= tip => !this.lineObstruction(tip, this.cast.state.bobber, 0),
        cameraMode: this.cameraMode,
        viewBlend: this.viewBlend,
        camera: this.squintWeight > 0 || this.fishingFocusWeight > 0 ? this.castCamera : this.camera,
        castCamera: this.castCamera
      });
    }
    this.updateFloatRig(this.canCast() ? sceneDt : 0);
    this.updateCastVisuals();
    if (this.nameplateLayer) this.nameplateLayer.hidden = this.mode !== "playing" || this.ui.profileOpen || this.ui.inventoryOpen || this.ui.buildOpen || this.ui.modalOpen;
    this.remoteRoom.update(dt, this.camera, this.canvas && { width: this.canvas.clientWidth, height: this.canvas.clientHeight }, this.pos);
    this.updateMultiplayer(dt);
    this.ui.updateHUD(this, dt);
    this.lastSave += dt;
    if (this.mode === "playing" && this.lastSave > 2) {
      this.lastSave = 0;
      this.save();
    }
  }

  canCast() {
    return this.mode === "playing" && (!this.server?.enabled || (this.multiplayer.connected && !this.serverBusy))
      && !this.ui.buildOpen && !this.ui.profileOpen && !this.ui.inventoryOpen && !this.ui.modalOpen && !this.ui.rosterOpen && !this.ui.chat?.open;
  }

  applyRod(rod) {
    this.settings.rodLength = rod.length;
    this.angler.carry.setLength(rod.length);
    this.cast.setRodRange(rod.range, this.settings.floatDepth);
    this.floatRig.reset();
    this.settings.floatDepth = this.cast.rig.floatDepth;
    this.floatDepthInput.max = String(fishingMeters(this.cast.rig.maxDepth));
    this.floatDepthInput.value = String(fishingMeters(this.settings.floatDepth));
    this.rodReadout.textContent = t("Rod {length} m / Range {range} m", { length: rod.length, range: fishingMeters(this.cast.castRange) });
    this.floatDepthReadout.textContent = t("Depth {depth} m / Line {length} m", { depth: fishingMeters(this.settings.floatDepth), length: fishingMeters(this.cast.rig.lineLength) });
  }

  selectRod(length) {
    const rod = RODS.find((item) => item.length === length);
    if (!rod || ["aim", "charge", "flight"].includes(this.cast.state.fs)) return false;
    if (this.inventory && !this.inventory.equip(rod.id).ok) return false;
    this.applyRod(rod);
    this.updateCast(0);
    this.updateCastVisuals();
    this.save();
    return true;
  }

  equipGear(itemId) {
    if (["aim", "charge", "flight"].includes(this.cast.state.fs)) {
      return { ok: false, message: "Equipment is locked during the cast." };
    }
    if (this.server.enabled) return this.serverCommand("equip", itemId);
    const result = this.inventory.equip(itemId);
    if (!result.ok) return result;
    this.applyRod(this.inventory.equippedRod());
    this.updateCast(0);
    this.updateCastVisuals();
    this.ui.refreshInventory();
    this.ui.refreshProfile();
    this.save();
    return result;
  }

  selectFloatDepth(depth) {
    if (!Number.isFinite(depth) || depth < 0 || depth > this.cast.rig.maxDepth
      || ["aim", "charge", "flight"].includes(this.cast.state.fs)) return false;
    this.settings.floatDepth = depth;
    this.applyRod(rodForLength(this.settings.rodLength));
    this.updateCast(0);
    this.updateCastVisuals();
    this.ui?.refreshInventory();
    this.save();
    return true;
  }

  updateFloatRig(dt) {
    const state = this.cast.state;
    if (state.fs !== "wait") {
      this.floatRig.reset();
      this.castAdjusting = false;
      return;
    }
    const wasAnchored = this.floatRig.anchored;
    const previousReach = Math.hypot(state.bobber.x - this.pos.x, state.bobber.z - this.pos.z);
    const tip = this.angler.getRodTip(this.castTip);
    if (!this.floatRig.follow(dt, tip, state.bobber, this.cast.rig, this.floatContext, this.angler.rodAdjustmentTip || tip)) {
      this.cast.startRetrieve("line");
      this.floatRig.reset();
      this.audio.deny();
      this.ui.showToast("The float cannot reach this position.");
    } else if (dt > 0 && wasAnchored && this.castAdjusting) {
      const reach = Math.hypot(state.bobber.x - this.pos.x, state.bobber.z - this.pos.z);
      // Only a player's correction triggers this rule, not a short landing or a view transition.
      if (reach < previousReach - 1e-8 && reach < this.cast.rig.lineLength * FLOAT_RETRIEVE_FRACTION - 1e-8) {
        this.cast.startRetrieve("close");
        this.floatRig.reset();
        this.ui.showToast("Retrieving rig.");
      }
    }
    this.castAdjusting = false;
  }

  updateCast(dt) {
    if (this.inventory && this.cast.state.fs === "idle" && this.settings.rodLength !== this.inventory.equippedRod().length) {
      this.applyRod(this.inventory.equippedRod());
      this.ui.refreshRodLine();
    }
    const enabled = this.canCast();
    if (!enabled) {
      if (["aim", "charge"].includes(this.cast.state.fs)) {
        this.castEpoch = (this.castEpoch || 0) + 1;
        this.holdCasting = this.desktopCastHeld = this.keyboardCastHeld = false;
        this.castApproval = null;
        this.castRelease = this.castTurn = null;
        this.castFacing = null;
        this.cancelServerCast();
      }
      this.cast.cancelCharge(); this.castPointer = null;
    }
    this.angler.group.position.copy(this.pos);
    const turnReady = this.updateCastTurn?.(dt);
    this.angler.group.rotation.y = this.castFacing ?? this.yaw;
    if (this.castFacing != null) this.angler.heading = 0;
    if (this.camera && this.castAimDirection) {
      const ray = !this.castContext.holdCast && this.castPointer && globalThis.document?.pointerLockElement !== this.canvas
        ? this.castRayFromScreen(this.castPointer.x, this.castPointer.y) : null;
      this.castContext.aimRay = this.castContext.holdCast && !this.castContext.cameraAim ? null : ray || {
        origin: this.camera.position,
        direction: this.camera.getWorldDirection(this.castAimDirection)
      };
    }
    const previewing = ["idle", "aim", "charge"].includes(this.cast.state.fs);
    const rodTip = previewing && this.castCamera && this.angler.getCastHoldTip
      ? this.angler.getCastHoldTip(this.castCamera, this.castTip) : this.angler.getRodTip(this.castTip);
    Object.assign(this.castContext, { yaw: this.yaw, pitch: this.pitch, pos: this.pos, rodTip,
      retrieveTarget: this.angler.getRetrieveHand?.(this.retrieveHand ||= new THREE.Vector3()),
      retrieveDepth: this.floatRig?.actualDepth ?? this.cast.rig?.floatDepth,
      retrieveClearanceY: this.terrain?.groundMesh && this.water
        ? this.retrieveClearanceY ||= (x, z) => this.castMarkerHeight({ x, z }) : undefined });
    this.castContext.rodTipForYaw = previewing && this.castContext.cameraAim && this.angler.getCastHoldTip
      ? this.castTipPreviewFn ||= yaw => this.castTipForFacing(yaw) : null;
    this.castContext.castHeading = this.cast.state.fs === "charge" || this.castApproval ? this.castHeading
      : this.yaw + (this.angler.rig?.rotation.y ?? this.angler.heading ?? 0);
    this.castContext.frozenCast = this.castRelease;
    this.castContext.holdPaused = Boolean(this.castApproval || this.castRelease);
    const previous = this.cast.state.fs;
    const wasRetrieving = this.cast.state.retrieving;
    const state = this.cast.tick(dt, this.castContext);
    this.floatDepthInput.disabled = ["aim", "charge", "flight"].includes(state.fs);
    this.updateCastControls?.(enabled);
    const holdPreview = this.castContext.holdCast && state.fs === "charge" && enabled;
    this.castMeter.classList.toggle("hidden", !holdPreview || Boolean(this.castRelease));
    if (holdPreview) {
      const percentage = Math.round(state.charge * 100);
      this.castMeter.setAttribute("aria-valuenow", String(percentage));
      this.castMeterFill.style.width = `${percentage}%`;
      this.castMeterFill.classList.toggle("on-target", state.canRelease);
      this.castMeterFill.classList.toggle("blocked", !state.canRelease);
      for (const obsolete of [this.castMeterTarget, this.castMeterTol, this.castMeterCursor]) obsolete.style.display = "none";
      this.castMeterDistance.textContent = `${fishingMeters(state.charge * this.cast.castRange).toFixed(2)} / ${fishingMeters(this.cast.castRange).toFixed(2)} ${t("m")}`;
      this.castMeterStatus.textContent = t(this.castApproval ? "Waiting for server..." : state.canRelease ? "Release to cast." : "Aim at open water.");
    }
    const markerPoint = state.aimPoint;
    this.aimMarker.visible = enabled && state.aimHasPoint && (holdPreview || ["idle", "aim"].includes(state.fs))
      && (state.fs === "aim" || this.castWaterNearby());
    if (this.aimMarker.visible) {
      this.aimMarker.material.color.setHex(state.targetValid ? 0x54e58b : 0xff5555);
      this.placeCastMarker(this.aimMarker, markerPoint, 0.05);
    }
    if (previous === "flight" && state.fs === "wait") {
      this.stats.recordCast(true);
      // With no bite mechanic yet, the attached bait survives landing and retrieval.
      const hasBait = this.inventory.countOf(this.inventory.state.equipped.bait) > 0;
      if (this.server?.enabled) {
        const ticket = this.activeServerCast;
        this.activeServerCast = null;
        const landing = { ...state.bobber };
        const epoch = this.castEpoch;
        if (!ticket) this.cast.startRetrieve("bait");
        else {
          const pending = { epoch }; this.castLanding = pending;
          this.updateCastControls?.(enabled);
          this.server.landCast(ticket.castId, landing).catch(error => {
            // Do not alter a newer cast when an older response finishes late.
            if (this.castEpoch === epoch && this.cast.state.fs === "wait") this.cast.startRetrieve("bait");
            this.handleAccountError(error);
          }).finally(() => { if (this.castLanding === pending) this.castLanding = null; });
        }
      }
      this.ui.refreshInventory();
      this.ui.refreshProfile();
      const soft = 1 - state.castAcc * SPLASH_SCALE;
      const { x, z } = state.bobber;
      const surface = this.castMarkerHeight(state.bobber);
      this.audio.splash((0.55 + state.castPower * 0.5) * soft);
      const firstEffect = this.water.particles.children.length;
      this.water.addSplash(x, surface, z, Math.max(SPLASH_MIN, Math.round(SPLASH_BASE * soft)), (0.9 + state.castPower * 0.5) * soft);
      this.water.addRipple(x, z, (1 + state.castPower * 0.7) * soft, 1.9);
      this.water.addRipple(x, z, 0.6 * soft, 1.3);
      for (let i = firstEffect; i < this.water.particles.children.length; i += 1) {
        const effect = this.water.particles.children[i];
        if (!effect.userData.vel) effect.position.y = surface + 0.035;
      }
      this.ui.showToast(hasBait ? this.toastForCast(state) : "No bait.");
      this.save();
      if (window.__snejDebug) console.debug("Cast startle preview", {
        radius: lerp(STARTLE_R[0], STARTLE_R[1] + state.castPower * 2, 1 - state.castAcc),
        seconds: lerp(STARTLE_SEC[0], STARTLE_SEC[1], 1 - state.castAcc)
      });
    }
    if (state.retrieving && !wasRetrieving) {
      this.cancelServerCast();
      this.stats.recordCast(false);
      this.ui.refreshProfile();
      this.save();
      this.audio.deny();
      this.ui.showToast(state.castObstruction === "dock" ? "The cast hit the dock."
        : state.castObstruction === "rock" ? "The cast hit a rock." : "The cast landed on land.");
    }
    if (turnReady && this.castTurn && state.fs === "charge") {
      this.castTurn = null;
      if (!this.releaseCast()) this.cancelServerCast();
    }
  }

  placeCastMarker(marker, point, offset) {
    const cached = marker.userData;
    const scale = marker.scale.x;
    if (cached.x === point.x && cached.z === point.z && cached.scale === scale) return;
    Object.assign(cached, { x: point.x, z: point.z, scale });
    marker.position.set(point.x, this.castMarkerHeight(point) + offset, point.z);
    const positions = marker.geometry.attributes.position;
    const sample = this.castSurfacePoint;
    for (let i = 0; i < positions.count; i += 1) {
      sample.set(point.x + positions.getX(i) * scale, 0, point.z + positions.getZ(i) * scale);
      positions.setY(i, (this.castMarkerHeight(sample) + offset - marker.position.y) / scale);
    }
    positions.needsUpdate = true;
    marker.geometry.computeBoundingSphere();
  }

  castMarkerHeight(point) {
    let height = Math.max(this.renderedTerrainHeight(point), this.water.surfaceY(point.x, point.z));
    const dock = this.terrain.dockLocal(point.x, point.z);
    if (dock.along >= 0 && dock.along <= this.lake.dockLength && Math.abs(dock.side) <= this.lake.dockWidth * 0.5) {
      height = Math.max(height, this.lake.dockY + 0.14);
    }
    return height;
  }

  renderedTerrainHeight(point) {
    const geometry = this.terrain.groundMesh.geometry;
    const { width, height: size, widthSegments: nx, heightSegments: nz } = geometry.parameters;
    const gx = clamp((point.x / width + 0.5) * nx, 0, nx);
    const gz = clamp((point.z / size + 0.5) * nz, 0, nz);
    const ix = Math.min(Math.floor(gx), nx - 1), iz = Math.min(Math.floor(gz), nz - 1);
    const fx = gx - ix, fz = gz - iz, a = iz * (nx + 1) + ix;
    const positions = geometry.attributes.position;
    const y00 = positions.getY(a), y10 = positions.getY(a + 1);
    const y01 = positions.getY(a + nx + 1), y11 = positions.getY(a + nx + 2);
    // Match the rendered grid triangles at the coarse shoreline, not just the analytic height.
    return fx + fz <= 1 ? y00 * (1 - fx - fz) + y10 * fx + y01 * fz
      : y11 * (fx + fz - 1) + y10 * (1 - fz) + y01 * (1 - fx);
  }

  castGroundHeight(x, z) {
    return this.terrain.groundMesh ? this.renderedTerrainHeight({ x, z }) : this.terrain.heightAt(x, z);
  }

  isCastWater(x, z) {
    if (Math.abs(x) > WATER_REGION / 2 || Math.abs(z) > WATER_REGION / 2) return false;
    const point = this.castSurfacePoint.set(x, 0, z);
    const surface = this.water.surfaceY(x, z);
    if (this.renderedTerrainHeight(point) >= surface) return false;
    const dock = this.terrain.dockLocal(x, z);
    if (dock.along >= -0.5 && dock.along <= this.lake.dockLength + 0.5
      && Math.abs(dock.side) <= this.lake.dockWidth * 0.5 + 0.1) return false;
    return !this.terrain.obstacles.some((item) => item.top >= surface && Math.hypot(x - item.x, z - item.z) <= item.r);
  }

  updateCastVisuals() {
    const state = this.cast.state;
    const visible = this.mode !== "title" && (state.fs === "flight" || state.fs === "wait");
    this.castMesh.visible = visible;
    this.castLine.visible = visible;
    const hooked = visible && (state.fs === "wait" || state.retrieving);
    const depth = state.retrieving ? state.retrieveDepth : this.floatRig.actualDepth;
    this.depthLine.visible = hooked && depth > 0;
    if (this.hookMesh) this.hookMesh.visible = hooked;
    if (!visible) return;
    this.castMesh.position.set(state.bobber.x, state.bobber.y, state.bobber.z);
    if (state.fs === "wait") this.castMesh.position.y += Math.sin(state.waitTime * WAKE_BOB_FREQ) * WAKE_BOB_AMP;
    const tip = this.angler.getRodTip(this.castTip);
    const end = this.castMesh.position;
    const points = this.castLine.geometry.attributes.position;
    const length = state.fs === "wait" ? this.cast.rig.upperLine : this.cast.rig.lineLength - (state.retrieving ? depth : 0);
    limitLineEnd(tip, end, length, end);
    writeFixedLine(tip, end, length, points.array, this.time);
    points.needsUpdate = true;
    if (this.depthLine.visible) {
      const lower = this.depthLine.geometry.attributes.position;
      lower.setXYZ(0, end.x, end.y, end.z);
      const hook = state.retrieving ? { x: end.x, y: end.y - depth, z: end.z } : this.floatRig.hook;
      lower.setXYZ(1, hook.x, hook.y, hook.z);
      lower.needsUpdate = true;
    }
    if (hooked && this.hookMesh) this.hookMesh.position.set(end.x, state.retrieving ? end.y - depth : this.floatRig.hook.y, end.z);
  }

  createHookMesh() {
    const points = [[0, 0, 0], [0, -0.045, 0], [0.014, -0.065, 0], [0.032, -0.056, 0], [0.034, -0.035, 0]];
    const mesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))),
      new THREE.LineBasicMaterial({ color: 0xeaf4ff, toneMapped: false }));
    mesh.name = "SnejHook";
    mesh.frustumCulled = false;
    return mesh;
  }

  lineObstruction(tip, end, slack = 0) {
    const length = Math.hypot(end.x - tip.x, end.y - tip.y, end.z - tip.z);
    const steps = Math.max(1, Math.ceil(length / 0.5));
    let x0 = tip.x, y0 = tip.y, z0 = tip.z;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = lerp(tip.x, end.x, t), z = lerp(tip.z, end.z, t);
      const y = lerp(tip.y, end.y, t) - 6.75 * t * t * (1 - t) * slack;
      if (this.terrain.dockBlocksSegment(x0, y0, z0, x, y, z)) return "dock";
      if (y < this.castGroundHeight(x, z)) return "land";
      for (const obstacle of this.terrain.obstacles) {
        const dx = x - x0, dz = z - z0;
        const denominator = dx * dx + dz * dz;
        const near = denominator > 0 ? clamp(((obstacle.x - x0) * dx + (obstacle.z - z0) * dz) / denominator, 0, 1) : 0;
        const px = lerp(x0, x, near), pz = lerp(z0, z, near), py = lerp(y0, y, near);
        if (Math.hypot(px - obstacle.x, pz - obstacle.z) <= obstacle.r && py <= obstacle.top && py >= this.castGroundHeight(px, pz)) {
          return obstacle.kind === "rock" ? "rock" : "land";
        }
      }
      x0 = x; y0 = y; z0 = z;
    }
    return null;
  }

  toastForCast({ castPerfect, charge, targetPower }) {
    return castPerfect ? "Perfect" : charge > targetPower ? "Overcast" : "Undercast";
  }

  toastForCastRejection(reason) {
    if (reason === "reach") return "Water is out of reach. Move closer.";
    if (reason === "range") return "Charge a longer cast.";
    if (reason === "dock") return "Dock blocks the cast.";
    if (reason === "rock") return "Rock blocks the cast.";
    if (reason === "terrain") return "The cast would land on land.";
    return "Aim at open water.";
  }

  createBobberMesh() {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5555, roughness: 0.6 }));
    mesh.name = "SnejBobber";
    return mesh;
  }

  createCastLineMesh() {
    const geometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 33 }, () => new THREE.Vector3()));
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.6 }));
    line.name = "SnejCastLine";
    line.frustumCulled = false;
    return line;
  }

  createMarker(inner, outer, color, opacity) {
    const geometry = new THREE.RingGeometry(inner, outer, 36).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide
    }));
    mesh.visible = false;
    mesh.renderOrder = 6;
    return mesh;
  }

  updateMultiplayer(dt) {
    if (!this.multiplayer.connected || this.mode !== "playing") return;
    this.presenceTimer += dt;
    if (this.presenceTimer < 0.1) return;
    this.presenceTimer = 0;
    this.presenceSeq += 1;
    this.multiplayer.sendPresence(makePresence(this, this.presenceSeq));
  }

  updateLook(dt = 1 / 60) {
    const adjusting = this.cast.state.fs === "flight" || this.cast.state.fs === "wait";
    const rodStick = this.mobileInput?.enabled && this.cameraMode === "first-person"
      && this.cast.state.fs === "wait" && !this.cast.state.retrieving;
    this.mobileInput?.setStickMode?.(rodStick ? "rod" : "move", t(rodStick ? "Adjust fishing rod" : "Movement joystick"));
    const rod = rodStick ? this.mobileInput?.rodLook?.(dt) : null;
    const sensitivity = this.settings.sens * 0.0022 * (adjusting ? CAST_LOOK_SCALE : 1);
    const touch = this.mobileInput?.takeLook() || { dx: 0, dy: 0 };
    if (this.cast.state.fs === "charge" && !this.castContext?.cameraAim
      && (this.cast.state.selectedTarget || this.castContext?.holdCast)) {
      this.mouse.dx = this.mouse.dy = 0;
      this.castAdjusting = false;
      return;
    }
    let dx = (this.mouse.dx + touch.dx) * sensitivity + (rod?.dx || 0);
    let dy = (this.mouse.dy + touch.dy) * sensitivity + (rod?.dy || 0);
    if (adjusting) {
      const amount = Math.hypot(dx, dy), limit = CAST_LOOK_SPEED * Math.max(0, dt);
      if (amount > limit) { dx *= limit / amount; dy *= limit / amount; }
    }
    this.castAdjusting = adjusting && (dx !== 0 || dy !== 0);
    this.yaw -= dx;
    this.pitch -= dy;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  }

  updateMove(dt) {
    if (!this.terrain) return;
    if (["aim", "charge", "flight", "wait"].includes(this.cast.state.fs)) {
      this.moveAmt = 0;
      this.moveSpeed = 0;
      this.stepTimer = 0;
      return;
    }
    const { mx, mz, magnitude, sprint } = movementInput(this.keys, this.mobileInput?.movement(), this.settings.autoSprint);
    const moving = magnitude > 0;
    const depth = this.terrain.depthAt(this.pos.x, this.pos.z);
    const baseSpeed = sprint ? 6.8 : 4.0;
    const wadeCap = lerp(4.0, 1.6, clamp01(depth / 1.2));
    const speed = depth > 0.05 ? Math.min(baseSpeed, wadeCap) : baseSpeed;
    this.moveAmt = damp(this.moveAmt, magnitude, moving ? 16 : 10, dt);
    this.moveSpeed = damp(this.moveSpeed, speed * magnitude, moving ? 14 : 9, dt);
    if (!moving) {
      this.stepTimer = 0;
      this.snapToGround();
      return;
    }
    const origin = this.pos.clone();
    const next = this.pos.clone();
    const steps = 6;
    const movement = moveDelta(mx, mz, this.yaw, speed, dt);
    const delta = new THREE.Vector3(movement.dx, 0, movement.dz);
    for (let i = 1; i <= steps; i += 1) {
      const sample = this.pos.clone().addScaledVector(delta, i / steps);
      const sampleDepth = this.terrain.depthAt(sample.x, sample.z);
      const leavingForcedDeepSpawn = depth > MAX_WADE_DEPTH && sampleDepth < depth;
      if (sampleDepth > MAX_WADE_DEPTH && !leavingForcedDeepSpawn) {
        sample.x = this.pos.x;
        sample.z = this.pos.z;
        if (this.audio.ready && i === 1) this.audio.deny();
      }
      if (!this.terrain.blockedAt(sample.x, sample.z, PLAYER_RADIUS, this.pos.y + 0.8)) {
        next.x = sample.x;
        next.z = sample.z;
      }
    }
    this.pos.x = clamp(next.x, -WORLD_SIZE * 0.49, WORLD_SIZE * 0.49);
    this.pos.z = clamp(next.z, -WORLD_SIZE * 0.49, WORLD_SIZE * 0.49);
    if (this.terrain.depthAt(this.pos.x, this.pos.z) > MAX_WADE_DEPTH) {
      this.pos.copy(origin);
      if (this.audio.ready) this.audio.deny();
    }
    this.snapToGround();
    const newDepth = this.terrain.depthAt(this.pos.x, this.pos.z);
    const interval = 0.55 / Math.max(0.5, speed * magnitude);
    this.stepTimer += dt;
    if (this.stepTimer >= interval) {
      this.stepTimer = 0;
      this.audio.step();
      if (newDepth > 0.08 && newDepth <= MAX_WADE_DEPTH) {
        this.audio.waterSplash(clamp01(newDepth));
        this.water.addSplash(this.pos.x, 0.03, this.pos.z, 5, 0.45 + newDepth * 0.25);
      }
    }
  }

  snapToGround() {
    const height = this.terrain.heightAt(this.pos.x, this.pos.z);
    const depth = this.terrain.depthAt(this.pos.x, this.pos.z);
    if (depth > MAX_WADE_DEPTH) {
      this.pos.y = 0.04;
      return;
    }
    this.pos.y = height + 0.04;
  }

  updateCamera(dt) {
    this.updateSquint(dt);
    const fishingFocus = this.canCast() && this.cameraMode === "first-person"
      && this.cast.state.fs === "wait" && !this.cast.state.retrieving;
    this.fishingFocusWeight = damp(this.fishingFocusWeight || 0, fishingFocus ? 1 : 0, 8, Math.max(0, dt));
    if (Math.abs(this.fishingFocusWeight - (fishingFocus ? 1 : 0)) < 0.0001) this.fishingFocusWeight = fishingFocus ? 1 : 0;
    if (!this.terrain) {
      this.camera.position.set(0, 12, 18);
      this.camera.lookAt(0, 0, 0);
      return;
    }
    const eye = this.pos.clone().add(new THREE.Vector3(0, EYE_H, 0));
    const lookDir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
    const touchView = Boolean(this.mobileInput?.enabled);
    const orbitHorizontal = touchView ? Math.max(0.9, Math.cos(this.pitch)) : Math.cos(this.pitch);
    const back = new THREE.Vector3(
      -Math.sin(this.yaw) * orbitHorizontal,
      touchView ? 1.7 - Math.sin(this.pitch) * 0.2 : 0.35 - Math.sin(this.pitch) * 0.6,
      -Math.cos(this.yaw) * orbitHorizontal
    );
    // A raised shoulder orbit keeps close floats clear of the mobile avatar.
    if (touchView) back.addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 0.25);
    if (touchView && this.cast.state.fs === "wait" && !this.cast.state.retrieving) {
      const float = new THREE.Vector3().copy(this.cast.state.bobber);
      const towardFloat = float.sub(this.pos).setY(0);
      const range = towardFloat.length();
      const facing = clamp01((towardFloat.normalize().dot(lookDir.clone().setY(0).normalize()) - 0.2) / 0.5);
      const blend = facing * facing * (3 - 2 * facing);
      if (blend > 0) {
        // Short casts below a raised bank need extra elevation, not a longer orbit.
        const bankShoulder = clamp01((this.pos.y - this.cast.state.bobber.y) / 0.7) * clamp01((3 - range) / 1.5);
        back.addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 1.5 * bankShoulder * blend);
        const clearance = Math.max(0, this.pos.y + 1.9 - this.cast.state.bobber.y);
        back.y = lerp(back.y, Math.max(back.y, Math.hypot(back.x, back.z) * clearance / Math.max(0.75, range) + 0.5), blend);
      }
    }
    back.normalize();
    let distance = touchView ? TOUCH_CAM_DIST : CAM_DIST;
    const probe = eye.clone().addScaledVector(back, distance);
    const top = this.terrain.obstacleTopAt(probe.x, probe.z);
    const ground = this.terrain.heightAt(probe.x, probe.z);
    if (probe.y < ground + 0.35 || top > probe.y - 0.3) distance = Math.max(CAM_PULL_MIN, distance * 0.55);
    const thirdPosition = eye.clone().addScaledVector(back, distance);
    thirdPosition.y = Math.max(thirdPosition.y, this.terrain.heightAt(thirdPosition.x, thirdPosition.z) + 0.35);

    let transitioning = false;
    if (this.viewTransition) {
      transitioning = true;
      this.viewTransition.elapsed += dt;
      const t = clamp01(this.viewTransition.elapsed / VIEW_TRANSITION_TIME);
      const smooth = t * t * (3 - 2 * t);
      this.viewBlend = lerp(this.viewTransition.start, this.viewTransition.end, smooth);
      if (t >= 1) this.viewTransition = null;
    } else {
      this.viewBlend = this.cameraMode === "third-person" ? 1 : 0;
    }
    const desiredPosition = eye.clone().lerp(thirdPosition, this.viewBlend);
    const firstTarget = eye.clone().addScaledVector(lookDir, 8);
    if (this.castCamera) {
      // The physical grip follows player look, never the first/third-person orbit.
      this.castCamera.aspect = this.camera.aspect;
      this.castCamera.position.copy(eye);
      this.castCamera.lookAt(firstTarget);
    }
    // Shift only the observer slightly left: the same physical hand/rod appear right.
    // Keep the hand visible on narrow portrait screens while widening the offset elsewhere.
    const rodViewOffset = lerp(0.155, 0.22, clamp01((this.camera.aspect - 0.5) / 0.5));
    desiredPosition.addScaledVector(new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)),
      -rodViewOffset * this.fishingFocusWeight * (1 - this.viewBlend));
    const thirdTarget = eye.clone();
    if (touchView) thirdTarget.y -= 0.4;
    if (touchView && this.cast.state.fs === "wait" && !this.cast.state.retrieving) {
      const float = new THREE.Vector3().copy(this.cast.state.bobber);
      const towardFloat = float.clone().sub(eye).setY(0).normalize();
      const forward = lookDir.clone().setY(0).normalize();
      const framing = clamp01((towardFloat.dot(forward) - 0.2) / 0.5);
      if (framing > 0) {
        // Center the angular bounds of head, feet and float, including narrow portrait views.
        const points = [this.pos.clone().add(new THREE.Vector3(0, 0.15, 0)),
          this.pos.clone().add(new THREE.Vector3(0, 1.8, 0)), float];
        const directions = points.map(point => point.sub(thirdPosition).normalize());
        const frameDirection = thirdTarget.clone().sub(thirdPosition).normalize();
        for (let i = 0; i < 4; i++) {
          const right = frameDirection.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
          const up = right.clone().cross(frameDirection).normalize();
          const bounds = directions.map(direction => {
            const depth = Math.max(0.01, direction.dot(frameDirection));
            return { x: direction.dot(right) / depth, y: direction.dot(up) / depth };
          });
          frameDirection.addScaledVector(right, (Math.min(...bounds.map(a => a.x)) + Math.max(...bounds.map(a => a.x))) / 2)
            .addScaledVector(up, (Math.min(...bounds.map(a => a.y)) + Math.max(...bounds.map(a => a.y))) / 2).normalize();
        }
        thirdTarget.lerp(thirdPosition.clone().addScaledVector(frameDirection, 4), framing * framing * (3 - 2 * framing));
      }
    }
    const desiredTarget = firstTarget.lerp(thirdTarget, this.viewBlend);
    // Zoom only the rendered view; the physical grip and casting camera stay unchanged.
    const focusWeight = Math.max(this.squintWeight || 0, this.fishingFocusWeight);
    if (focusWeight > 0) desiredTarget.lerp(new THREE.Vector3().copy(this.cast.state.bobber), focusWeight);
    if (transitioning) {
      this.camera.position.copy(desiredPosition);
    } else {
      this.camera.position.x = damp(this.camera.position.x, desiredPosition.x, 14, dt);
      this.camera.position.y = damp(this.camera.position.y, desiredPosition.y, 14, dt);
      this.camera.position.z = damp(this.camera.position.z, desiredPosition.z, 14, dt);
    }
    this.camera.lookAt(desiredTarget);
  }
}
