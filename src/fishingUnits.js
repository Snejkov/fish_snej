// Pole meshes, fixed line, depth and fishing readouts share one world unit per meter.
export const FISHING_WORLD_UNITS_PER_METER = 1;
export const FISHING_UNITS_VERSION = 2;
export const fishingMeters = (world) => world / FISHING_WORLD_UNITS_PER_METER;
export const fishingWorld = (meters) => meters * FISHING_WORLD_UNITS_PER_METER;

// Legacy depth was stored at twice its displayed value. Preserve that choice exactly once.
export function migrateFishingSettings(settings = {}) {
  const next = { ...settings, fishingUnitsVersion: FISHING_UNITS_VERSION };
  if (settings.fishingUnitsVersion !== FISHING_UNITS_VERSION && Number.isFinite(settings.floatDepth)) {
    next.floatDepth = settings.floatDepth / 2;
  }
  return next;
}
