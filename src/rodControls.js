export const DEFAULT_ROD_SPEED = 2;
export const MIN_ROD_SPEED = 0.25;
export const MAX_ROD_SPEED = 4;

export function normalizeRodSpeed(value) {
  return Number.isFinite(value) ? Math.min(MAX_ROD_SPEED, Math.max(MIN_ROD_SPEED, value)) : DEFAULT_ROD_SPEED;
}
