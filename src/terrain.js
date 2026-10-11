import * as THREE from "three";
import { WORLD_SIZE } from "./lake.js";
import { clamp } from "./util.js";

export class SnejTerrain {
  constructor(lake, settings) {
    this.lake = lake;
    this.settings = settings;
    this.group = new THREE.Group();
    this.obstacles = [];
    this.treeGroup = new THREE.Group();
    this.underwaterGroup = new THREE.Group();
    this.groundMesh = null;
    this.dockGroup = null;
    this.dockDeck = null;
    this.build();
  }

  build() {
    this.group.clear();
    this.treeGroup.clear();
    this.underwaterGroup.clear();
    this.obstacles.length = 0;
    this.groundMesh = this.buildGround();
    this.dockGroup = this.buildDock();
    this.group.add(this.groundMesh, this.dockGroup, this.treeGroup, this.underwaterGroup);
    this.buildStructures();
    this.buildTrees();
  }

  buildGround() {
    const seg = this.settings.quality === "low" ? 120 : this.settings.quality === "high" ? 220 : 170;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      const depth = this.depthAt(x, z);
      const bed = this.bedAt(x, z).kind;
      if (depth > 0) {
        if (bed === "rock") c.setRGB(0.35, 0.34, 0.31);
        else if (bed === "sand") c.setRGB(0.56, 0.48, 0.34);
        else c.setRGB(0.22, 0.27, 0.22);
      } else {
        const h = clamp(y / 26, 0, 1);
        c.setRGB(0.14 + h * 0.12, 0.26 + h * 0.12, 0.16 + h * 0.06);
      }
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = "terrain-ground";
    return mesh;
  }

  buildDock() {
    const group = new THREE.Group();
    const lake = this.lake;
    const deckGeo = new THREE.BoxGeometry(lake.dockLength, 0.28, lake.dockWidth);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6b4e33, roughness: 0.75 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(
      lake.dockStart.x + lake.dockDir.x * lake.dockLength * 0.5,
      lake.dockY,
      lake.dockStart.z + lake.dockDir.z * lake.dockLength * 0.5
    );
    deck.rotation.y = -lake.dockAngle;
    deck.castShadow = true;
    deck.receiveShadow = true;
    deck.name = "dock-deck";
    this.dockDeck = deck;
    group.add(deck);
    for (let i = 0; i <= 5; i += 1) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.16, lake.dockY + 2.2, 8),
          new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.8 })
        );
        const along = lake.dockLength * (i / 5);
        post.position.set(
          lake.dockStart.x + lake.dockDir.x * along + lake.dockSide.x * side * lake.dockWidth * 0.42,
          (lake.dockY - 1.1) * 0.5,
          lake.dockStart.z + lake.dockDir.z * along + lake.dockSide.z * side * lake.dockWidth * 0.42
        );
        post.castShadow = true;
        group.add(post);
      }
    }
    return group;
  }

  buildStructures() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x53535a, roughness: 0.9 });
    const snagMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.85 });
    for (const s of this.lake.structures) {
      const y = this.heightAt(s.x, s.z) + s.h * 0.5;
      let mesh;
      if (s.kind === "rock") {
        mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(s.r, 0), rockMat);
        mesh.scale.set(1.2, clamp(s.h / Math.max(0.1, s.r), 0.35, 1.6), 0.8);
      } else {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, s.h, 7), snagMat);
        mesh.rotation.x = 0.25;
        mesh.rotation.z = -0.18;
      }
      mesh.position.set(s.x, y, s.z);
      mesh.rotation.y = s.rot;
      mesh.castShadow = true;
      this.underwaterGroup.add(mesh);
    }
  }

  buildTrees() {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3424, roughness: 0.8 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1e4a2d, roughness: 0.9 });
    for (let i = 0; i < 90; i += 1) {
      const a = (i * 2.399963 + this.lake.seed * 0.001) % (Math.PI * 2);
      const shore = this.lake.shoreRadius(a);
      const r = shore + 28 + (i % 7) * 13;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) > WORLD_SIZE * 0.48 || Math.abs(z) > WORLD_SIZE * 0.48) continue;
      const h = 5.5 + (i % 5) * 1.2;
      const y = this.heightAt(x, z);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, h, 7), trunkMat);
      trunk.position.y = h * 0.5;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.7 + (i % 3) * 0.35, h * 0.95, 8), leafMat);
      crown.position.y = h * 0.95;
      tree.position.set(x, y, z);
      tree.add(trunk, crown);
      this.treeGroup.add(tree);
      this.obstacles.push({ x, z, r: 1.25, top: y + h * 1.45, kind: "tree" });
    }
    for (const s of this.lake.structures.filter((item) => item.kind === "rock")) {
      if (this.depthAt(s.x, s.z) < 0.5) {
        this.obstacles.push({ x: s.x, z: s.z, r: s.r + 0.3, top: this.heightAt(s.x, s.z) + s.h, kind: "rock" });
      }
    }
  }

  depthAt(x, z) { return this.lake.depthAt(x, z); }
  heightAt(x, z) { return this.lake.heightAt(x, z); }
  bedAt(x, z) { return this.lake.bedAt(x, z); }

  structureNear(x, z, r = 4.5) {
    let best = null;
    let bestD = r;
    for (const s of this.lake.structures) {
      const d = Math.hypot(x - s.x, z - s.z) - s.r;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  dockBlocksSegment(x0, y0, z0, x1, y1, z1) {
    return this.lake.dockBlocksSegment(x0, y0, z0, x1, y1, z1);
  }

  distToDock(x, z) { return this.lake.distToDock(x, z); }
  dockLocal(x, z, out) { return this.lake.dockLocal(x, z, out); }

  blockedAt(x, z, rad = 0.32, y = 1.0) {
    if (Math.abs(x) > WORLD_SIZE * 0.49 || Math.abs(z) > WORLD_SIZE * 0.49) return true;
    for (const obstacle of this.obstacles) {
      if (obstacle.top >= y && Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.r + rad) return true;
    }
    return false;
  }

  obstacleTopAt(x, z) {
    let top = -Infinity;
    for (const obstacle of this.obstacles) {
      if (Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.r + 0.3) top = Math.max(top, obstacle.top);
    }
    return top;
  }

  updateWind(time) { this.treeGroup.rotation.y = Math.sin(time * 0.18) * 0.002; }
  updateTrees() {}
  updateLamp() {}

  updateUnderwaterProps(time) {
    this.underwaterGroup.visible = true;
    this.underwaterGroup.rotation.y = Math.sin(time * 0.08) * 0.001;
  }

  updateShore() {}
}
