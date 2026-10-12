// Fishing UI uses two world units per displayed meter. Network and physics stay in world units.
export const FISHING_WORLD_UNITS_PER_METER = 2;
export const fishingMeters = (world) => world / FISHING_WORLD_UNITS_PER_METER;
export const fishingWorld = (meters) => meters * FISHING_WORLD_UNITS_PER_METER;
