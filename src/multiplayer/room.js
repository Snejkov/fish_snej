import * as THREE from "three";

function makeRemoteModel() {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x70b7d6, roughness: 0.75, transparent: true });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xcaa47e, roughness: 0.7, transparent: true });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 1.18, 5, 10), bodyMaterial);
  torso.position.y = 0.96;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 9), skinMaterial);
  head.position.y = 1.55;
  group.add(torso, head);
  group.userData.materials = [bodyMaterial, skinMaterial];
  return group;
}

export class SnejRemotePlayerRoom {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = "remote-players";
    this.players = new Map();
  }

  applyPresence(message) {
    const id = message.clientId;
    const data = message.presence;
    if (!id || !data || !Number.isFinite(data.x) || !Number.isFinite(data.z)) return;
    let player = this.players.get(id);
    if (!player) {
      player = {
        model: makeRemoteModel(),
        target: new THREE.Vector3(data.x, data.y || 0, data.z),
        yaw: data.yaw || 0,
        id: Number(data.id) || 0,
        name: String(data.name || "Player"),
        rank: String(data.rank || "player"),
        lastSeen: performance.now()
      };
      player.model.position.copy(player.target);
      this.players.set(id, player);
      this.group.add(player.model);
    }
    player.target.set(data.x, data.y || 0, data.z);
    player.yaw = data.yaw || 0;
    player.id = Number(data.id) || player.id;
    player.name = String(data.name || player.name);
    player.rank = String(data.rank || player.rank);
    player.lastSeen = performance.now();
  }

  remove(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.group.remove(player.model);
    player.model.traverse((part) => { if (part.geometry) part.geometry.dispose(); });
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

  update(dt) {
    // Membership ends with a server leave or transport loss, never with a paused animation.
    for (const player of this.players.values()) {
      const alpha = 1 - Math.exp(-12 * dt);
      player.model.position.lerp(player.target, alpha);
      player.model.rotation.y += (player.yaw - player.model.rotation.y) * alpha;
    }
  }
}
