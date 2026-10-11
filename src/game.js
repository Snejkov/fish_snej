import * as THREE from "three";
import { SnejAngler } from "./angler.js?v=0.0.4-hf3";
import { RODS, rodForLength } from "./rods.js?v=0.0.5a";
import { SnejInventory } from "./gear/inventory.js";
import { SnejCatchLog } from "./game/catchLog.js";
import { SnejStats } from "./game/stats.js";
import { SnejAudio } from "./audio.js?v=0.0.4";
import {
  SnejCastSystem, CAST_TOL, SPLASH_BASE, SPLASH_MIN, SPLASH_SCALE,
  STARTLE_R, STARTLE_SEC, WAKE_BOB_AMP, WAKE_BOB_FREQ
} from "./castSystem.js?v=0.0.4-hf7";
import { DEFAULT_FLOAT_DEPTH, SnejFloatRig, rigForRod, limitLineEnd, writeFixedLine } from "./floatRig.js?v=0.0.4-hf6";
import { SnejAuth, SNEJKOV_ID, SNEJKOV_NAME } from "./auth.js";
import { resolveLake } from "./lakeValidator.js";
import { SNEJ_FIXED_SEED, WORLD_SIZE } from "./lake.js";
import { SnejMultiplayerClient } from "./multiplayer/client.js";
import { makePresence } from "./multiplayer/presence.js";
import { SnejRemotePlayerRoom } from "./multiplayer/room.js";
import { SnejPlacementSystem } from "./placement.js";
import { SnejSky } from "./sky.js";
import { SPAWNS, SPAWN_INITIAL_NAME, SPAWN_NAMES } from "./spawns.js";
import { SnejTerrain } from "./terrain.js";
import { SnejTextureManager } from "./textureManager.js";
import { SnejUI } from "./ui.js?v=0.0.5a";
import { SnejWater } from "./water.js?v=0.0.4";
import { clamp, clamp01, damp, lerp, moveDelta, resolveWalkableStart } from "./util.js?v=0.0.3-hf2.12";

const SAVE_KEY = "snejfishing-save-v1";
const SAVE_VERSION = 5;
const IDENTITY_SAVE_VERSION = 3;
const HOURS_PER_SEC = 1 / 60;
const EYE_H = 1.62;
const PLAYER_RADIUS = 0.34;
const MAX_WADE_DEPTH = 1.0;
const CAM_PULL_MIN = 1.1;
const CAM_DIST = 4.6;
const VIEW_TRANSITION_TIME = 0.18;

const DEFAULT_SETTINGS = {
  volume: 0.7,
  bgm: 0.7,
  sens: 1.0,
  quality: "mid",
  shadow: true,
  randomLake: false,
  rodLength: 4,
  floatDepth: DEFAULT_FLOAT_DEPTH,
  lang: "en"
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
    this.hasProgress = false;
    this.seed = SNEJ_FIXED_SEED;
    this.state = { clock: 6 };
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
    this.castSurfacePoint = new THREE.Vector3();
    this.cast = new SnejCastSystem({ rodRange: RODS[0].range, floatDepth: DEFAULT_FLOAT_DEPTH, getCastOrigin: () => this.angler.getCastOrigin(this.castOrigin) });
    this.floatRig = new SnejFloatRig();
    this.castMesh = null;
    this.castLine = null;
    this.depthLine = null;
    this.aimMarker = null;
    this.landingMarker = null;
    this.castMeter = document.getElementById("cast-meter");
    this.castMeterFill = this.castMeter.querySelector(".cast-meter-fill");
    this.castMeterTarget = this.castMeter.querySelector(".cast-meter-target");
    this.castMeterTol = this.castMeter.querySelector(".cast-meter-tol");
    this.castMeterDistance = this.castMeter.querySelector(".cast-meter-distance");
    this.rodSelect = document.getElementById("rod-select");
    this.rodReadout = document.getElementById("rod-line");
    this.floatDepthInput = document.getElementById("float-depth");
    this.floatDepthReadout = document.getElementById("float-depth-line");
    for (const rod of RODS) {
      this.rodSelect.add(new Option(`${rod.length} m / Range ${rod.range} m`, String(rod.length)));
    }
    this.castContext = {
      waterSurfaceY: (x, z) => this.water.surfaceY(x, z),
      terrainHeightAt: (x, z) => this.terrain.heightAt(x, z),
      terrainDepthAt: (x, z) => this.terrain.depthAt(x, z),
      isWaterAt: (x, z) => this.isCastWater(x, z),
      dockBlocksSegment: (a, b) => this.terrain.dockBlocksSegment(a.x, a.y, a.z, b.x, b.y, b.z),
      lineObstruction: (a, b, slack) => this.lineObstruction(a, b, slack),
      aimBlockedByDome: () => null,
      rodReel: 0
    };
    this.floatContext = {
      playerOrigin: this.pos,
      surfaceY: (x, z) => this.castMarkerHeight({ x, z }) + Math.sin(this.cast.state.waitTime * WAKE_BOB_FREQ) * WAKE_BOB_AMP,
      isWaterAt: (point) => this.cast.isRigWaterAt(point),
      lineObstruction: (a, b, slack) => this.lineObstruction(a, b, slack)
    };
    this.mouse = { dx: 0, dy: 0 };
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
    this.settings.rodLength = this.inventory.equippedRod().length;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1800);
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
    this.remoteRoom = new SnejRemotePlayerRoom();
    this.audio = new SnejAudio(this.settings);
    this.ui = new SnejUI(this);
    this.multiplayer = new SnejMultiplayerClient({
      onStatus: (status) => {
        this.ui.setNetworkStatus(status);
        this.refreshPeerList();
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
      onChat: () => {}
    });
    if (options.bootstrapSnejkov || this.identity?.name === SNEJKOV_NAME || this.identity?.id === SNEJKOV_ID) {
      this.bootstrapDeveloperIdentity();
    }
    this.buildWorld();
    this.applyStart(this.lake.start, { mode: "third-person", pitch: -0.12 });
    this.installEvents();
    this.resize();
    if (this.identity) this.ui.showTitle(true);
    else this.ui.showRegistration(true);
    requestAnimationFrame((time) => this.frame(time));
  }

  installEvents() {
    this.rodSelect.addEventListener("change", () => {
      if (!this.selectRod(Number(this.rodSelect.value))) this.rodSelect.value = String(this.settings.rodLength);
    });
    this.floatDepthInput.addEventListener("change", () => {
      if (!this.selectFloatDepth(this.floatDepthInput.valueAsNumber)) this.floatDepthInput.value = String(this.settings.floatDepth);
    });
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (event.code === "Tab" && !this.ui.inventoryOpen && !this.ui.profileOpen && !this.ui.modalOpen) event.preventDefault();
      if (event.code === "KeyP" && !event.repeat && this.identity) {
        this.ui.toggleProfile();
        return;
      }
      if (event.code === "KeyI" && !event.repeat && this.identity) {
        this.ui.toggleInventory();
        return;
      }
      if (event.code === "KeyU" && !event.repeat) this.ui.toggleHUD();
      if (event.code === "KeyV" && !event.repeat && this.mode === "playing" && !this.ui.buildOpen && !this.ui.profileOpen && !this.ui.inventoryOpen && !this.ui.modalOpen) {
        this.toggleView();
        return;
      }
      if (event.code === "KeyB" && !event.repeat && this.mode === "playing") {
        this.toggleBuildMode();
        return;
      }
      if (event.code === "Escape") {
        if (this.ui.modalOpen) this.ui.closeNameModal();
        else if (this.ui.inventoryOpen) this.ui.closeInventory();
        else if (this.ui.buildOpen) this.ui.discardBuild();
        else if (this.ui.profileOpen) this.ui.closeProfile();
        else if (this.mode === "playing") this.pause();
        else if (this.mode === "paused") this.resume();
        return;
      }
      if (this.ui.inventoryOpen || this.ui.profileOpen || this.ui.modalOpen) return;
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement === this.canvas && this.mode === "playing" && !this.ui.buildOpen && !this.ui.profileOpen && !this.ui.inventoryOpen && !this.ui.modalOpen) {
        this.mouse.dx += event.movementX;
        this.mouse.dy += event.movementY;
      }
    });
    this.canvas.addEventListener("pointerdown", (event) => {
      if (this.mode === "playing" && this.ui.buildOpen) this.placementSystem.handlePointerDown(event);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.mode === "playing" && this.ui.buildOpen) this.placementSystem.handlePointerMove(event);
    });
    window.addEventListener("pointerup", () => this.placementSystem.handlePointerUp());
    this.canvas.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || !this.canCast()) return;
      this.audio.resume();
      // Starting another cast clears the previous float and its fixed rig.
      if (this.cast.state.fs === "wait") this.cast.reset();
      this.updateCast(0);
      if (this.cast.onActionDown()) {
        this.ui.el.toast.classList.add("hidden");
        this.audio.charge();
        this.updateCast(0);
      }
    });
    window.addEventListener("mouseup", (event) => {
      if (event.button !== 0 || this.cast.state.fs !== "charge") return;
      if (!this.canCast()) {
        this.cast.cancelCharge();
        this.updateCast(0);
        return;
      }
      this.updateCast(0);
      if (this.cast.onActionUp()) {
        this.audio.cast(this.cast.state.castPower);
      } else if (this.cast.state.lastRejection) {
        this.audio.deny();
        this.ui.showToast(this.toastForCastRejection(this.cast.state.lastRejection));
      }
      this.updateCast(0);
      this.updateCastVisuals();
    });
    window.addEventListener("blur", () => {
      this.cast.cancelCharge();
      this.castMeter.classList.add("hidden");
    });
    this.canvas.addEventListener("click", () => {
      if (!this.canCast()) return;
      this.audio.resume();
      this.canvas.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === this.canvas) this.audio.resume();
    });
  }

  resize() {
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
      this.aimMarker = this.createMarker(0.5, 0.66, 0x9ff0ff, 0.85);
      this.landingMarker = this.createMarker(0.86, 1.12, 0xffe98a, 0.92);
    }
    this.castMesh.visible = false;
    this.castLine.visible = false;
    this.depthLine.visible = false;
    this.aimMarker.visible = false;
    this.landingMarker.visible = false;
    this.castMeter.classList.add("hidden");
    this.scene.add(
      this.terrain.group,
      this.water.group,
      this.angler.group,
      this.placementSystem.group,
      this.remoteRoom.group,
      this.castMesh, this.castLine, this.depthLine, this.aimMarker, this.landingMarker
    );
    this.scene.traverse((object) => { if (object.isLight) object.layers.enable(1); });
    this.configureShadows();
    this.state.clock = 6;
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
      return { ok: false, message: error.message || "Could not create the profile." };
    }
  }

  bootstrapDeveloperIdentity() {
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
    try {
      this.identity = this.auth.rename(this.identity, name);
      this.playerName = this.identity.name;
      this.multiplayer?.updateIdentity(this.identity, this.currentRank);
      this.save();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Could not change the name." };
    }
  }

  signOut() {
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
    this.currentRank = this.auth.rankForId(this.identity?.id);
    this.ui?.updateProfile();
  }

  async newGame(options = {}) {
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
  }

  async continueGame() {
    this.audio.resume();
    this.disconnectMultiplayer();
    const save = this.loadSave();
    if (!save?.player?.lastPosition) return this.newGame();
    this.settings = { ...DEFAULT_SETTINGS, ...(save.settings || {}), randomLake: false };
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
  }

  async startOnline(room) {
    this.lastRoom = String(room || "snej-1").trim().slice(0, 32) || "snej-1";
    await this.newGame({ keepConnection: true });
    this.multiplayer.connect(this.lastRoom, this.identity, this.currentRank);
    this.save();
  }

  async newLake() {
    const placements = this.placementSystem.serializeCommitted();
    this.buildWorld();
    this.applyStart(this.lake.start, { mode: this.cameraMode, pitch: this.pitch });
    await this.placementSystem.setPlacements(placements);
    this.mode = "playing";
    this.ui.showPause(false);
    this.save();
  }

  quitToTitle() {
    this.cast.reset();
    this.castMeter.classList.add("hidden");
    if (this.ui.buildOpen) this.ui.discardBuild();
    if (this.ui.profileOpen) this.ui.closeProfile();
    if (this.ui.inventoryOpen) this.ui.closeInventory();
    this.disconnectMultiplayer();
    this.mode = "title";
    this.ui.showPause(false);
    this.ui.showTitle(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  pause() {
    if (this.ui.inventoryOpen) this.ui.closeInventory();
    this.cast.cancelCharge();
    this.castMeter.classList.add("hidden");
    this.ui.el.toast.classList.add("hidden");
    this.mode = "paused";
    this.keys.clear();
    this.ui.showPause(true);
    this.save();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume() {
    this.audio.resume();
    this.mode = "playing";
    this.ui.showPause(false);
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
    this.settings[key] = key === "randomLake" ? false : value;
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
    const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}), randomLake: false };
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
    if (this.identity) this.nextLocalId = Math.max(this.nextLocalId, this.identity.nextLocalId);
    this.settings.rodLength = this.inventory.equippedRod().length;
    this.stats.stampSeen();
    const data = {
      version: SAVE_VERSION,
      settings: {
        volume: this.settings.volume,
        bgm: this.settings.bgm,
        sens: this.settings.sens,
        quality: this.settings.quality,
        shadow: this.settings.shadow,
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
      this.ui.showToast(error.message || "Could not delete the texture.");
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
    this.multiplayer?.disconnect();
    this.remoteRoom.clear();
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
    const paused = this.mode === "paused" || this.mode === "title";
    const sceneDt = paused ? 0 : dt;
    this.time += sceneDt;
    const previousX = this.pos.x;
    const previousZ = this.pos.z;
    if (this.mode === "playing") {
      this.state.clock = (this.state.clock + dt * HOURS_PER_SEC) % 24;
      this.stats.tickPlaytime(dt);
    }
    if (this.mode === "playing" && !this.ui.buildOpen && !this.ui.profileOpen && !this.ui.inventoryOpen && !this.ui.modalOpen) {
      this.updateLook();
      this.updateMove(dt);
    } else {
      this.moveAmt = 0;
      this.moveSpeed = 0;
    }
    this.updateCast(this.canCast() ? sceneDt : 0);
    this.updateCamera(sceneDt);
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
      this.angler.group.rotation.y = this.yaw;
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
        cameraMode: this.cameraMode,
        viewBlend: this.viewBlend,
        camera: this.camera
      });
    }
    this.updateFloatRig(this.canCast() ? sceneDt : 0);
    this.updateCastVisuals();
    this.remoteRoom.update(dt);
    this.updateMultiplayer(dt);
    this.ui.updateHUD(this, dt);
    this.lastSave += dt;
    if (this.mode === "playing" && this.lastSave > 2) {
      this.lastSave = 0;
      this.save();
    }
  }

  canCast() {
    return this.mode === "playing" && !this.ui.buildOpen && !this.ui.profileOpen && !this.ui.inventoryOpen && !this.ui.modalOpen;
  }

  applyRod(rod) {
    this.settings.rodLength = rod.length;
    this.angler.carry.setLength(rod.length);
    this.cast.setRodRange(rod.range, this.settings.floatDepth);
    this.floatRig.reset();
    this.settings.floatDepth = this.cast.rig.floatDepth;
    this.rodSelect.value = String(rod.length);
    for (const [index, item] of RODS.entries()) {
      const rig = rigForRod(item.length, this.settings.floatDepth);
      this.rodSelect.options[index].textContent = `${item.length} m / Cast ${Number(rig.castRange.toFixed(2))} m`;
      this.rodSelect.options[index].disabled = this.inventory ? !this.inventory.owns(item.id) : false;
    }
    this.floatDepthInput.max = String(this.cast.rig.maxDepth);
    this.floatDepthInput.value = String(this.settings.floatDepth);
    this.rodReadout.textContent = `Rod ${rod.length} m / Range ${rod.range} m`;
    this.floatDepthReadout.textContent = `Depth ${Number(this.settings.floatDepth.toFixed(2))} m / Line ${rod.length} m`;
  }

  selectRod(length) {
    const rod = RODS.find((item) => item.length === length);
    if (!rod || this.cast.state.fs === "charge" || this.cast.state.fs === "flight") return false;
    if (this.inventory && !this.inventory.equip(rod.id).ok) return false;
    this.applyRod(rod);
    this.updateCast(0);
    this.updateCastVisuals();
    this.save();
    return true;
  }

  equipGear(itemId) {
    if (this.cast.state.fs === "charge" || this.cast.state.fs === "flight") {
      return { ok: false, message: "Equipment is locked during the cast." };
    }
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
      || this.cast.state.fs === "charge" || this.cast.state.fs === "flight") return false;
    this.settings.floatDepth = depth;
    this.applyRod(rodForLength(this.settings.rodLength));
    this.updateCast(0);
    this.updateCastVisuals();
    this.save();
    return true;
  }

  updateFloatRig(dt) {
    const state = this.cast.state;
    if (state.fs !== "wait") {
      this.floatRig.reset();
      return;
    }
    const tip = this.angler.getRodTip(this.castTip);
    if (!this.floatRig.follow(dt, tip, state.bobber, this.cast.rig, this.floatContext)) {
      state.fs = "flight";
      state.retrieving = true;
      state.castObstruction = "line";
      this.floatRig.reset();
      this.audio.deny();
      this.ui.showToast("The float cannot reach this position.");
    }
  }

  updateCast(dt) {
    if (this.inventory && this.cast.state.fs === "idle" && this.settings.rodLength !== this.inventory.equippedRod().length) {
      this.applyRod(this.inventory.equippedRod());
      this.ui.refreshRodLine();
    }
    const enabled = this.canCast();
    if (!enabled) this.cast.cancelCharge();
    this.angler.group.position.copy(this.pos);
    this.angler.group.rotation.y = this.yaw;
    Object.assign(this.castContext, { yaw: this.yaw, pitch: this.pitch, pos: this.pos, rodTip: this.angler.getRodTip(this.castTip) });
    const previous = this.cast.state.fs;
    const wasRetrieving = this.cast.state.retrieving;
    const state = this.cast.tick(dt, this.castContext);
    this.rodSelect.disabled = state.fs === "charge" || state.fs === "flight";
    this.floatDepthInput.disabled = this.rodSelect.disabled;
    const charging = enabled && state.fs === "charge";
    const onTarget = charging && state.canRelease && Math.abs(state.charge - state.targetPower) <= CAST_TOL;
    this.castMeter.classList.toggle("hidden", !charging);
    if (charging) {
      this.castMeterFill.style.width = `${(state.charge * 100).toFixed(1)}%`;
      this.castMeterFill.classList.toggle("on-target", onTarget);
      this.castMeterFill.classList.toggle("blocked", !state.canRelease);
      this.castMeterDistance.textContent = `${state.requestedDist.toFixed(1)} / ${this.cast.castRange} m`;
      this.castMeterTarget.style.left = `${state.targetPower * 100}%`;
      const lower = Math.max(0, state.targetPower - CAST_TOL);
      const upper = Math.min(1, state.targetPower + CAST_TOL);
      this.castMeterTol.style.left = `${lower * 100}%`;
      this.castMeterTol.style.width = `${(upper - lower) * 100}%`;
      this.castMeter.setAttribute("aria-valuenow", (state.charge * 100).toFixed(0));
      this.castMeter.setAttribute("aria-valuetext", `${state.requestedDist.toFixed(1)} of ${this.cast.castRange} meters`);
    }
    this.aimMarker.visible = enabled && state.aimValid && (state.fs === "idle" || charging);
    if (this.aimMarker.visible) {
      const aim = state.aimPoint;
      this.aimMarker.material.color.setHex(onTarget ? 0x9dffb4 : 0x9ff0ff);
      this.aimMarker.scale.setScalar(onTarget ? 1.1 : 1);
      this.placeCastMarker(this.aimMarker, aim, 0.05);
    }
    this.landingMarker.visible = charging && state.aimValid && state.predictedLanding.water
      && this.cast.isWaterAt(state.predictedLanding);
    if (this.landingMarker.visible) {
      const predicted = state.predictedLanding;
      this.landingMarker.material.color.setHex(!state.canRelease ? 0xff5a4a
        : this.terrain.depthAt(predicted.x, predicted.z) > 0.4 ? 0xfff0b0 : 0xff8a6a);
      this.landingMarker.scale.setScalar(1 + (1 - state.charge) * 0.5);
      this.placeCastMarker(this.landingMarker, predicted, 0.06);
    }
    if (previous === "flight" && state.fs === "wait") {
      this.stats.recordCast(true);
      const consumed = this.inventory.consumeBait();
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
      this.ui.showToast(consumed ? this.toastForCast(state) : "Out of bait. Reel in and re-equip.");
      this.save();
      if (window.__snejDebug) console.debug("Cast startle preview", {
        radius: lerp(STARTLE_R[0], STARTLE_R[1] + state.castPower * 2, 1 - state.castAcc),
        seconds: lerp(STARTLE_SEC[0], STARTLE_SEC[1], 1 - state.castAcc)
      });
    }
    if (state.retrieving && !wasRetrieving) {
      this.stats.recordCast(false);
      this.ui.refreshProfile();
      this.save();
      this.audio.deny();
      this.ui.showToast(state.castObstruction === "dock" ? "The cast hit the dock."
        : state.castObstruction === "rock" ? "The cast hit a rock." : "The cast landed on land.");
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
    const ground = this.terrain.heightAt(point.x, point.z);
    // Existing water is static but has visible relief. Keep markers and float above it.
    let height = Math.max(ground, this.water.surfaceY(point.x, point.z));
    height = Math.max(height, this.renderedTerrainHeight(point));
    if (this.terrain.depthAt(point.x, point.z) > 0) height = Math.max(height, this.water.waveHeight(point.x, point.z, 0));
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

  isCastWater(x, z) {
    if (this.terrain.depthAt(x, z) <= 0.25) return false;
    const point = this.castSurfacePoint.set(x, 0, z);
    const surface = this.water.waveHeight(x, z, 0);
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
    this.depthLine.visible = visible && state.fs === "wait" && this.cast.rig.floatDepth > 0;
    if (!visible) return;
    this.castMesh.position.set(state.bobber.x, state.bobber.y, state.bobber.z);
    const tip = this.angler.getRodTip(this.castTip);
    const end = this.castMesh.position;
    const points = this.castLine.geometry.attributes.position;
    const length = state.fs === "wait" ? this.cast.rig.upperLine : this.cast.rig.lineLength;
    limitLineEnd(tip, end, length, end);
    writeFixedLine(tip, end, length, points.array);
    points.needsUpdate = true;
    if (this.depthLine.visible) {
      const lower = this.depthLine.geometry.attributes.position;
      lower.setXYZ(0, end.x, end.y, end.z);
      lower.setXYZ(1, end.x, end.y - this.cast.rig.floatDepth, end.z);
      lower.needsUpdate = true;
    }
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
      if (y < this.terrain.heightAt(x, z)) return "land";
      for (const obstacle of this.terrain.obstacles) {
        const dx = x - x0, dz = z - z0;
        const denominator = dx * dx + dz * dz;
        const near = denominator > 0 ? clamp(((obstacle.x - x0) * dx + (obstacle.z - z0) * dz) / denominator, 0, 1) : 0;
        const px = lerp(x0, x, near), pz = lerp(z0, z, near), py = lerp(y0, y, near);
        if (Math.hypot(px - obstacle.x, pz - obstacle.z) <= obstacle.r && py <= obstacle.top && py >= this.terrain.heightAt(px, pz)) {
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
    if (reason === "depth") return "Not enough depth for this rig.";
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
      color, transparent: true, opacity, depthWrite: false, fog: false, side: THREE.DoubleSide
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

  updateLook() {
    const sensitivity = this.settings.sens * 0.0022;
    this.yaw -= this.mouse.dx * sensitivity;
    this.pitch -= this.mouse.dy * sensitivity;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  }

  updateMove(dt) {
    if (!this.terrain) return;
    if (this.cast.state.fs === "flight" || this.cast.state.fs === "wait") {
      this.moveAmt = 0;
      this.moveSpeed = 0;
      this.stepTimer = 0;
      return;
    }
    let mx = 0;
    let mz = 0;
    if (this.keys.has("KeyW")) mz += 1;
    if (this.keys.has("KeyS")) mz -= 1;
    if (this.keys.has("KeyA")) mx -= 1;
    if (this.keys.has("KeyD")) mx += 1;
    const inputLength = Math.hypot(mx, mz);
    const moving = inputLength > 0;
    if (moving) {
      mx /= inputLength;
      mz /= inputLength;
    }
    const depth = this.terrain.depthAt(this.pos.x, this.pos.z);
    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const baseSpeed = sprint ? 6.8 : 4.0;
    const wadeCap = lerp(4.0, 1.6, clamp01(depth / 1.2));
    const speed = depth > 0.05 ? Math.min(baseSpeed, wadeCap) : baseSpeed;
    this.moveAmt = damp(this.moveAmt, moving ? 1 : 0, moving ? 16 : 10, dt);
    this.moveSpeed = damp(this.moveSpeed, moving ? speed : 0, moving ? 14 : 9, dt);
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
    const interval = 0.55 / Math.max(0.5, speed);
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
    const back = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      0.35 - Math.sin(this.pitch) * 0.6,
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
    let distance = CAM_DIST;
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
    const desiredTarget = firstTarget.lerp(eye, this.viewBlend);
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
