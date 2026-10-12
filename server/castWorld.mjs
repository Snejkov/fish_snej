import { resolveLake } from "../src/lakeValidator.js";
import { SNEJ_FIXED_SEED, WATER_REGION, WORLD_SIZE } from "../src/lake.js";

const lake = resolveLake(SNEJ_FIXED_SEED);
const grids = new Map();
function grid(quality) {
  const n = quality === "low" ? 120 : quality === "high" ? 220 : 170;
  if (!grids.has(n)) {
    const heights = new Float32Array((n + 1) ** 2);
    for (let z = 0; z <= n; z += 1) for (let x = 0; x <= n; x += 1) {
      heights[z * (n + 1) + x] = lake.heightAt(Math.fround(x * (WORLD_SIZE / n) - WORLD_SIZE / 2),
        Math.fround(z * (WORLD_SIZE / n) - WORLD_SIZE / 2));
    }
    grids.set(n, heights);
  }
  return { n, heights: grids.get(n) };
}

// The client renders coarse shoreline triangles, so the server uses the same grid.
export function castGroundHeight(x, z, quality = "mid") {
  const { n, heights } = grid(quality);
  const gx = Math.max(0, Math.min(n, (x / WORLD_SIZE + 0.5) * n));
  const gz = Math.max(0, Math.min(n, (z / WORLD_SIZE + 0.5) * n));
  const ix = Math.min(Math.floor(gx), n - 1), iz = Math.min(Math.floor(gz), n - 1);
  const fx = gx - ix, fz = gz - iz, a = iz * (n + 1) + ix;
  const y00 = heights[a], y10 = heights[a + 1], y01 = heights[a + n + 1], y11 = heights[a + n + 2];
  return fx + fz <= 1 ? y00 * (1 - fx - fz) + y10 * fx + y01 * fz
    : y11 * (fx + fz - 1) + y10 * (1 - fz) + y01 * (1 - fx);
}

export function isCastWater(x, z, quality) {
  if (Math.abs(x) > WATER_REGION / 2 || Math.abs(z) > WATER_REGION / 2 || castGroundHeight(x, z, quality) >= 0) return false;
  const dock = lake.dockLocal(x, z);
  if (dock.along >= -0.5 && dock.along <= lake.dockLength + 0.5 && Math.abs(dock.side) <= lake.dockWidth * 0.5 + 0.1) return false;
  return !lake.structures.some(s => s.kind === "rock" && lake.depthAt(s.x, s.z) < 0.5
    && lake.heightAt(s.x, s.z) + s.h >= 0 && Math.hypot(x - s.x, z - s.z) <= s.r + 0.3);
}
