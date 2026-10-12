import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "three") return { url: new URL("../vendor/three.module.min.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { SnejTerrain } = await import("../src/terrain.js");
const { SnejFishingGame: Game } = await import("../src/game.js");
const { resolveLake } = await import("../src/lakeValidator.js");
const { SNEJ_FIXED_SEED } = await import("../src/lake.js");
const { castGroundHeight, isCastWater } = await import("../server/castWorld.mjs");
const THREE = await import("three");

test("server water validation matches the actual rendered shoreline at all three qualities", () => {
  for (const quality of ["low", "mid", "high"]) {
    const lake = resolveLake(SNEJ_FIXED_SEED), terrain = new SnejTerrain(lake, { quality });
    const game = Object.create(Game.prototype);
    Object.assign(game, { lake, terrain, castSurfacePoint: new THREE.Vector3(), water: { surfaceY: () => 0 } });
    for (let i = 0; i < 240; i += 1) {
      const a = i * 0.927, radius = lake.shoreRadius(a) + Math.sin(i * 2.14) * 5;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      assert.ok(Math.abs(castGroundHeight(x, z, quality) - game.renderedTerrainHeight({ x, z })) < 0.000001);
      assert.equal(isCastWater(x, z, quality), game.isCastWater(x, z));
    }
    terrain.group.traverse(node => { node.geometry?.dispose(); });
  }
});
