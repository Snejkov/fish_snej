import * as THREE from "three";
import { SnejAngler } from "./angler.js?v=0.0.3-hf2.14";
import { SnejAudio } from "./audio.js";
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
import { SnejUI } from "./ui.js?v=0.0.3-hf2.12";
import { SnejWater } from "./water.js?v=0.0.3-hf2.12";
import { clamp, clamp01, damp, lerp, moveDelta, resolveWalkableStart } from "./util.js?v=0.0.3-hf2.12";

const SAVE_KEY = "snejfishing-save-v1";
const SAVE_VERSION = 4;
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
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (event.code === "Tab") event.preventDefault();
      if (event.code === "KeyP" && !event.repeat && this.identity) {
        this.ui.toggleProfile();
        return;
      }
      if (event.code === "KeyU" && !event.repeat) this.ui.toggleHUD();
      if (event.code === "KeyV" && !event.repeat && this.mode === "playing" && !this.ui.buildOpen && !this.ui.profileOpen) {
        this.toggleView();
        return;
      }
      if (event.code === "KeyB" && !event.repeat && this.mode === "playing") {
        this.toggleBuildMode();
        return;
      }
      if (event.code === "Escape") {
        if (this.ui.modalOpen) this.ui.closeNameModal();
        else if (this.ui.buildOpen) this.ui.discardBuild();
        else if (this.ui.profileOpen) this.ui.closeProfile();
        else if (this.mode === "playing") this.pause();
        else if (this.mode === "paused") this.resume();
        return;
      }
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement === this.canvas && this.mode === "playing" && !this.ui.buildOpen && !this.ui.profileOpen) {
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
    this.canvas.addEventListener("click", () => {
      if (this.mode !== "playing" || this.ui.buildOpen || this.ui.profileOpen) return;
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
    this.scene.add(
      this.terrain.group,
      this.water.group,
      this.angler.group,
      this.placementSystem.group,
      this.remoteRoom.group
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
    if (this.ui.buildOpen) this.ui.discardBuild();
    if (this.ui.profileOpen) this.ui.closeProfile();
    this.disconnectMultiplayer();
    this.mode = "title";
    this.ui.showPause(false);
    this.ui.showTitle(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  pause() {
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
    if (this.cameraMode !== "third-person" || this.ui.profileOpen) return;
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
    const useInitialSpawn = usesLegacyDefault || (!sourcePosition && sourceVersion < SAVE_VERSION);
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
    return {
      version: SAVE_VERSION,
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}), randomLake: false },
      player: {
        name: identity?.name || playerName,
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
    const data = {
      version: SAVE_VERSION,
      settings: {
        volume: this.settings.volume,
        bgm: this.settings.bgm,
        sens: this.settings.sens,
        quality: this.settings.quality,
        shadow: this.settings.shadow,
        randomLake: false,
        lang: this.settings.lang
      },
      player: {
        name: this.identity?.name || this.playerName,
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
    if (this.mode === "playing") this.state.clock = (this.state.clock + dt * HOURS_PER_SEC) % 24;
    if (this.mode === "playing" && !this.ui.buildOpen && !this.ui.profileOpen) {
      this.updateLook();
      this.updateMove(dt);
    } else {
      this.moveAmt = 0;
      this.moveSpeed = 0;
    }
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
        cameraMode: this.cameraMode,
        viewBlend: this.viewBlend,
        camera: this.camera
      });
    }
    this.remoteRoom.update(dt);
    this.updateMultiplayer(dt);
    this.ui.updateHUD(this, dt);
    this.lastSave += dt;
    if (this.mode === "playing" && this.lastSave > 2) {
      this.lastSave = 0;
      this.save();
    }
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
