import * as THREE from "three";
import { SnejAngler } from "../angler.js?v=0.0.5a-hf6";

function materialsOf(model) {
  const materials = new Set();
  model.traverse((part) => {
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
      if (material) materials.add(material);
    }
  });
  return [...materials];
}

export class SnejRemotePlayerRoom {
  constructor({ labelRoot = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = "remote-players";
    this.players = new Map();
    this.observerPosition = new THREE.Vector3();
    this.labelRoot = labelRoot;
    this.labelPoint = new THREE.Vector3();
  }

  applyPresence(message) {
    const id = message?.clientId;
    const data = message?.presence;
    if (!id || !data || !Number.isFinite(data.x) || !Number.isFinite(data.z)) return;
    const y = data.y ?? 0, yaw = data.yaw ?? 0;
    if (!Number.isFinite(y) || !Number.isFinite(yaw)) return;
    let player = this.players.get(id);
    if (!player) {
      // Each peer reuses the local model with its own skeleton and animation mixer.
      const angler = new SnejAngler();
      player = {
        angler,
        model: angler.group,
        previousPosition: new THREE.Vector3(),
        target: new THREE.Vector3(data.x, y, data.z),
        yaw,
        id: Number(data.id) || 0,
        name: String(data.name || "Player"),
        rank: String(data.rank || "player"),
        lastSeen: performance.now()
      };
      player.model.position.copy(player.target);
      player.model.rotation.y = player.yaw;
      player.model.userData.materials = materialsOf(player.model);
      this.players.set(id, player);
      this.group.add(player.model);
      if (this.labelRoot) {
        player.label = this.labelRoot.ownerDocument.createElement("span");
        player.label.className = "player-nameplate";
        player.label.dataset.i18nSkip = "true";
        player.label.hidden = true;
        this.labelRoot.appendChild(player.label);
      }
    }
    player.target.set(data.x, y, data.z);
    player.yaw = yaw;
    player.id = Number(data.id) || player.id;
    player.name = String(data.name || player.name);
    player.rank = String(data.rank || player.rank);
    player.lastSeen = performance.now();
    if (player.label) player.label.textContent = `${player.name} #${player.id}`;
  }

  remove(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.group.remove(player.model);
    player.label?.remove();
    player.angler.mixer.stopAllAction();
    player.angler.mixer.uncacheRoot(player.angler.rig);
    player.angler.skeleton.dispose();
    const geometries = new Set();
    player.model.traverse((part) => { if (part.geometry) geometries.add(part.geometry); });
    for (const geometry of geometries) geometry.dispose();
    for (const material of player.model.userData.materials) material.dispose();
    this.players.delete(id);
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
  }

  listPeers() {
    return [...this.players.values()]
      .map((player) => ({ id: player.id, name: player.name, rank: player.rank }))
      .filter((player) => player.id > 0)
      .sort((a, b) => a.id - b.id);
  }

  update(dt, observerCamera, viewport) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const alpha = 1 - Math.exp(-12 * dt);
    if (observerCamera) observerCamera.getWorldPosition(this.observerPosition);
    if (observerCamera && viewport) observerCamera.updateMatrixWorld();
    // Membership ends with a server leave or transport loss, never with a paused animation.
    for (const player of this.players.values()) {
      player.previousPosition.copy(player.model.position);
      player.model.position.lerp(player.target, alpha);
      const turn = player.yaw - player.model.rotation.y;
      player.model.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * alpha;
      const directionX = player.model.position.x - player.previousPosition.x;
      const directionZ = player.model.position.z - player.previousPosition.z;
      player.angler.update(dt, {
        state: "playing",
        speed: dt > 0 ? Math.min(9, Math.hypot(directionX, directionZ) / dt) : 0,
        directionX, directionZ,
        cameraMode: "third-person", viewBlend: 1, depth: 0
      });
      // Shared spawn points must not put another player's face inside the camera.
      const dx = this.observerPosition.x - player.model.position.x;
      const dz = this.observerPosition.z - player.model.position.z;
      const eyeHeight = this.observerPosition.y - player.model.position.y;
      player.model.visible = !observerCamera || dx * dx + dz * dz >= 0.16 || eyeHeight < 0 || eyeHeight > 1.95;
      if (player.label) {
        const point = this.labelPoint.copy(player.model.position);
        point.y += 2.15;
        if (observerCamera) point.project(observerCamera);
        const visible = Boolean(viewport && observerCamera && player.model.visible
          && point.z >= -1 && point.z <= 1 && Math.abs(point.x) < 0.94 && Math.abs(point.y) < 0.94);
        player.label.hidden = !visible;
        if (visible) {
          player.label.style.left = `${(point.x + 1) * viewport.width / 2}px`;
          player.label.style.top = `${(1 - point.y) * viewport.height / 2}px`;
        }
      }
    }
  }
}
