export const RANKS = Object.freeze([
  "player",
  "premium",
  "tester",
  "administrator",
  "developer"
]);

export const ASSIGNABLE_RANKS_STAGE3 = Object.freeze(["player", "developer"]);

export const RANK_PERMISSIONS = Object.freeze({
  player: Object.freeze({}),
  premium: Object.freeze({}),
  tester: Object.freeze({}),
  administrator: Object.freeze({}),
  developer: Object.freeze({ buildMode: true })
});

export const SNEJKOV_ID = 1;
export const SNEJKOV_NAME = "Snejkov";

export const DEVELOPER_IDS = new Set([
  SNEJKOV_ID
]);

const NAME_PATTERN = /^[A-Za-z_-][A-Za-z0-9_-]{2,19}$/;
const MAX_ID = 0xffffffff;

function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= MAX_ID;
}

export class SnejAuth {
  validateName(value) {
    const name = String(value || "").trim();
    if (name.length < 3) return { valid: false, name, message: "Use at least 3 characters." };
    if (name.length > 20) return { valid: false, name, message: "Use no more than 20 characters." };
    if (/^[0-9]/.test(name)) return { valid: false, name, message: "The first character cannot be a number." };
    if (!NAME_PATTERN.test(name)) {
      return { valid: false, name, message: "Use letters, numbers, underscores, or hyphens only." };
    }
    return { valid: true, name, message: "Name available." };
  }

  normalizeIdentity(value) {
    if (!value || typeof value !== "object") return null;
    const validation = this.validateName(value.name);
    if (!validation.valid || !validId(value.id)) return null;
    const id = Number(value.id);
    const nextLocalId = validId(value.nextLocalId) && Number(value.nextLocalId) > id
      ? Number(value.nextLocalId)
      : Math.min(MAX_ID, id + 1);
    return {
      name: validation.name,
      id,
      registeredAt: Number(value.registeredAt) || Date.now(),
      nextLocalId
    };
  }

  allocateLocalId(nextLocalId = 1) {
    let id = validId(nextLocalId) ? Number(nextLocalId) : 1;
    if (id === SNEJKOV_ID) id += 1;
    if (id >= MAX_ID) throw new Error("The local ID range is exhausted.");
    return { id, nextLocalId: id + 1 };
  }

  createIdentity(name, nextLocalId = 1) {
    const validation = this.validateName(name);
    if (!validation.valid) throw new Error(validation.message);
    const allocation = this.allocateLocalId(nextLocalId);
    return {
      name: validation.name,
      id: allocation.id,
      registeredAt: Date.now(),
      nextLocalId: allocation.nextLocalId
    };
  }

  createSnejkovIdentity(nextLocalId = SNEJKOV_ID + 1) {
    return {
      name: SNEJKOV_NAME,
      id: SNEJKOV_ID,
      registeredAt: Date.now(),
      nextLocalId: Math.max(SNEJKOV_ID + 1, Number(nextLocalId) || 1)
    };
  }

  rename(identity, name) {
    const current = this.normalizeIdentity(identity);
    const validation = this.validateName(name);
    if (!current) throw new Error("The local identity is invalid.");
    if (!validation.valid) throw new Error(validation.message);
    return { ...current, name: validation.name };
  }

  rollNewId(identity, nextLocalId = identity?.nextLocalId) {
    const current = this.normalizeIdentity(identity);
    if (!current) throw new Error("The local identity is invalid.");
    const allocation = this.allocateLocalId(validId(nextLocalId) ? Number(nextLocalId) : current.nextLocalId);
    return { ...current, id: allocation.id, nextLocalId: allocation.nextLocalId };
  }

  applyGlobalId(identity, assignedId) {
    const current = this.normalizeIdentity(identity);
    if (!current || !validId(assignedId)) return current;
    const id = Number(assignedId);
    if (id === current.id) return current;
    return { ...current, id, nextLocalId: Math.max(current.nextLocalId, Math.min(MAX_ID, id + 1)) };
  }

  rankForId(id) {
    return DEVELOPER_IDS.has(Number(id)) ? "developer" : "player";
  }

  permissionsFor(rank) {
    return RANK_PERMISSIONS[rank] || RANK_PERMISSIONS.player;
  }

  can(rank, permission) {
    return Boolean(this.permissionsFor(rank)[permission]);
  }
}
