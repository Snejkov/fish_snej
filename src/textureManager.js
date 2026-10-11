const DB_NAME = "snejfishing-media";
const STORE_NAME = "mediaTextures";
const MANIFEST_SCHEMA = "snejfishing-texture-manifest-v1";
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_DIMENSION = 32;
const MAX_DIMENSION = 4096;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `texture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function cleanName(value) {
  return String(value || "Custom Texture").trim().slice(0, 96) || "Custom Texture";
}

export class SnejTextureManager {
  constructor() {
    this.dbPromise = null;
    this.urls = new Map();
    this.fallbacks = new Map();
  }

  open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open texture storage."));
    });
    return this.dbPromise;
  }

  async request(mode, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = action(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Texture storage request failed."));
    });
  }

  async put(record) {
    await this.request("readwrite", (store) => store.put(record));
    return record;
  }

  async hashBlob(blob) {
    return hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  }

  async list() {
    const records = await this.request("readonly", (store) => store.getAll());
    for (const record of records) {
      if (!record.hash && record.blob) {
        record.hash = await this.hashBlob(record.blob);
        await this.put(record);
      }
    }
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id) {
    return (await this.request("readonly", (store) => store.get(id))) || null;
  }

  async add(file) {
    if (!ALLOWED_TYPES.has(file.type)) throw new Error("Use a PNG, JPG, or WEBP image.");
    if (file.size > MAX_BYTES) throw new Error("Texture files must be 8 MB or smaller.");
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    if (width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new Error("Texture dimensions must be between 32 and 4096 pixels.");
    }
    const hash = await this.hashBlob(file);
    const existing = (await this.list()).find((record) => record.hash === hash);
    if (existing) return existing;
    return this.put({
      id: makeId(),
      name: cleanName(file.name),
      mime: file.type,
      blob: file,
      width,
      height,
      createdAt: Date.now(),
      hash,
      missingBlob: false
    });
  }

  async rename(id, name) {
    const record = await this.get(id);
    if (!record) throw new Error("Texture not found.");
    record.name = cleanName(name);
    return this.put(record);
  }

  async remove(id) {
    await this.request("readwrite", (store) => store.delete(id));
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
    this.fallbacks.delete(id);
  }

  async exportManifest(exportedBy, exportedById) {
    const entries = (await this.list()).map((record) => ({
      id: record.id,
      name: record.name,
      mime: record.mime,
      width: record.width,
      height: record.height,
      createdAt: record.createdAt,
      hash: record.hash || ""
    }));
    return {
      schema: MANIFEST_SCHEMA,
      exportedAt: Date.now(),
      exportedBy: String(exportedBy || "Player"),
      exportedById: Math.max(1, Math.floor(Number(exportedById)) || 1),
      entries
    };
  }

  async importManifest(input) {
    const manifest = typeof input === "string" ? JSON.parse(input) : input;
    if (!manifest || manifest.schema !== MANIFEST_SCHEMA || !Array.isArray(manifest.entries)) {
      throw new Error("This is not a SnejFishing texture manifest.");
    }
    const existing = await this.list();
    const hashes = new Set(existing.map((record) => record.hash).filter(Boolean));
    const ids = new Set(existing.map((record) => record.id));
    let added = 0;
    let skipped = 0;
    for (const entry of manifest.entries) {
      const hash = String(entry?.hash || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash) || hashes.has(hash)) {
        skipped += 1;
        continue;
      }
      let id = String(entry?.id || makeId()).slice(0, 128);
      if (!id || ids.has(id)) id = makeId();
      await this.put({
        id,
        name: cleanName(entry?.name),
        mime: ALLOWED_TYPES.has(entry?.mime) ? entry.mime : "image/png",
        width: Math.max(1, Math.floor(Number(entry?.width)) || 1),
        height: Math.max(1, Math.floor(Number(entry?.height)) || 1),
        createdAt: Number(entry?.createdAt) || Date.now(),
        hash,
        missingBlob: true
      });
      ids.add(id);
      hashes.add(hash);
      added += 1;
    }
    return { added, skipped };
  }

  fallbackUrl(record) {
    if (this.fallbacks.has(record.id)) return this.fallbacks.get(record.id);
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    const color = `#${String(record.hash || "4c7080").slice(0, 6).padEnd(6, "0")}`;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 96, 96);
    ctx.fillStyle = "rgba(12, 22, 25, 0.42)";
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if ((x + y) % 2 === 0) ctx.fillRect(x * 24, y * 24, 24, 24);
      }
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 48, 48);
    const url = canvas.toDataURL("image/png");
    this.fallbacks.set(record.id, url);
    return url;
  }

  urlFor(record) {
    if (!record) return "";
    if (!record.blob) return this.fallbackUrl(record);
    if (!this.urls.has(record.id)) this.urls.set(record.id, URL.createObjectURL(record.blob));
    return this.urls.get(record.id);
  }
}
