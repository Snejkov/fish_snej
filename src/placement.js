import * as THREE from "three";

const SURFACE_OFFSETS = { land: 0.005, bed: 0.003, dock: 0.008 };
const SURFACES = new Set(Object.keys(SURFACE_OFFSETS));
const TOOLS = new Set(["paint", "erase", "move"]);

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `placement-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clonePlacements(items) {
  return items.map((item) => ({ ...item }));
}

export class SnejPlacementSystem {
  constructor(game, textureManager) {
    this.game = game;
    this.textureManager = textureManager;
    this.group = new THREE.Group();
    this.group.name = "custom-placements";
    this.placements = [];
    this.committed = [];
    this.meshes = new Map();
    this.materials = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tool = "paint";
    this.surface = "land";
    this.textureId = null;
    this.dragId = null;
    this.fallbackMaterial = this.makeFallbackMaterial();
  }

  makeFallbackMaterial() {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = "#171717";
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillRect(16, 16, 16, 16);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map, roughness: 0.86, side: THREE.DoubleSide, transparent: true });
  }

  setTool(tool) {
    if (TOOLS.has(tool)) this.tool = tool;
  }

  setSurface(surface) {
    if (SURFACES.has(surface)) this.surface = surface;
  }

  setTexture(id) {
    this.textureId = id || null;
  }

  beginSession() {
    this.committed = clonePlacements(this.placements);
  }

  commit() {
    this.committed = clonePlacements(this.placements);
  }

  async discard() {
    await this.setPlacements(this.committed, true);
  }

  serialize() {
    return clonePlacements(this.placements);
  }

  serializeCommitted() {
    return clonePlacements(this.committed);
  }

  async setPlacements(items, keepCommitted = false) {
    this.clearMeshes();
    this.placements = Array.isArray(items)
      ? items.filter((item) => item && SURFACES.has(item.surface) && typeof item.textureId === "string").map((item) => ({ ...item }))
      : [];
    for (const placement of this.placements) this.createMesh(placement);
    if (!keepCommitted) this.committed = clonePlacements(this.placements);
  }

  clearMeshes() {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.meshes.clear();
  }

  createMesh(placement) {
    const size = Number(placement.scale) || 3.2;
    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, this.fallbackMaterial);
    mesh.position.set(placement.x, this.surfaceHeight(placement.surface, placement.x, placement.z), placement.z);
    mesh.rotation.y = placement.yaw || 0;
    mesh.receiveShadow = true;
    mesh.userData.placementId = placement.id;
    this.meshes.set(placement.id, mesh);
    this.group.add(mesh);
    this.loadMaterial(placement.textureId).then((material) => {
      if (this.meshes.get(placement.id) === mesh) mesh.material = material;
    });
    return mesh;
  }

  async loadMaterial(textureId) {
    if (this.materials.has(textureId)) return this.materials.get(textureId);
    const pending = this.textureManager.get(textureId).then(async (record) => {
      if (!record?.blob) return this.fallbackMaterial;
      const bitmap = await createImageBitmap(record.blob);
      const map = new THREE.CanvasTexture(bitmap);
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = THREE.ClampToEdgeWrapping;
      map.wrapT = THREE.ClampToEdgeWrapping;
      map.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map, roughness: 0.86, side: THREE.DoubleSide, transparent: true });
    }).catch(() => this.fallbackMaterial);
    this.materials.set(textureId, pending);
    return pending;
  }

  surfaceHeight(surface, x, z) {
    if (surface === "dock") return this.game.lake.dockY + 0.14 + SURFACE_OFFSETS.dock;
    return this.game.terrain.heightAt(x, z) + SURFACE_OFFSETS[surface];
  }

  pointerFromEvent(event) {
    const rect = this.game.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.game.camera);
  }

  pointForSurface(event, surface = this.surface) {
    this.pointerFromEvent(event);
    if (surface === "dock") {
      const hit = this.raycaster.intersectObject(this.game.terrain.dockDeck, false)[0];
      if (!hit) return null;
      return { x: hit.point.x, z: hit.point.z };
    }
    const hit = this.raycaster.intersectObject(this.game.terrain.groundMesh, false)[0];
    if (!hit) return null;
    const depth = this.game.terrain.depthAt(hit.point.x, hit.point.z);
    if (surface === "land" && depth > 0.05) return null;
    if (surface === "bed" && depth <= 0.05) return null;
    return { x: hit.point.x, z: hit.point.z };
  }

  placementAt(event) {
    this.pointerFromEvent(event);
    const hits = this.raycaster.intersectObjects([...this.meshes.values()], false);
    return hits[0]?.object.userData.placementId || null;
  }

  handlePointerDown(event) {
    if (event.button !== 0) return;
    if (this.tool === "erase") {
      const id = this.placementAt(event);
      if (id) this.remove(id);
      return;
    }
    if (this.tool === "move") {
      this.dragId = this.placementAt(event);
      if (this.dragId) this.moveDragged(event);
      return;
    }
    if (!this.textureId) {
      this.game.ui.showToast("Upload and select a texture first.");
      return;
    }
    const point = this.pointForSurface(event);
    if (!point) {
      this.game.ui.showToast(`Aim at the selected ${this.surface} surface.`);
      return;
    }
    const placement = {
      id: makeId(),
      textureId: this.textureId,
      surface: this.surface,
      x: point.x,
      z: point.z,
      yaw: this.game.yaw,
      scale: 3.2,
      createdAt: Date.now(),
      createdBy: this.game.playerName || "Player"
    };
    this.placements.push(placement);
    this.createMesh(placement);
  }

  handlePointerMove(event) {
    if (this.tool === "move" && this.dragId) this.moveDragged(event);
  }

  handlePointerUp() {
    this.dragId = null;
  }

  moveDragged(event) {
    const placement = this.placements.find((item) => item.id === this.dragId);
    if (!placement) return;
    const point = this.pointForSurface(event, placement.surface);
    if (!point) return;
    placement.x = point.x;
    placement.z = point.z;
    const mesh = this.meshes.get(placement.id);
    if (mesh) mesh.position.set(point.x, this.surfaceHeight(placement.surface, point.x, point.z), point.z);
  }

  remove(id) {
    const index = this.placements.findIndex((item) => item.id === id);
    if (index < 0) return;
    this.placements.splice(index, 1);
    const mesh = this.meshes.get(id);
    if (mesh) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
      this.meshes.delete(id);
    }
  }

  removeByTexture(textureId) {
    for (const item of [...this.placements]) {
      if (item.textureId === textureId) this.remove(item.id);
    }
    this.committed = this.committed.filter((item) => item.textureId !== textureId);
    this.materials.delete(textureId);
  }
}
