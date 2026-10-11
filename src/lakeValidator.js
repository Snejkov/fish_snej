import { HOLE_DOCK_MAX, HOLE_DOCK_MIN, MAX_DEPTH, SnejLake } from "./lake.js";

function pushIf(errors, condition, name) {
  if (condition) errors.push(name);
}

export function validateLake(lake) {
  const errors = [];
  const bands = { shallow: false, mid: false, deep: false, veryDeep: false };
  let landInLake = 0;
  let minLakeDepth = Infinity;
  let maxDepth = -Infinity;
  let startVeryDeep = 0;
  let startTotal = 0;
  const samples = 72;

  for (let ai = 0; ai < samples; ai += 1) {
    const a = (ai / samples) * Math.PI * 2;
    const shore = lake.shoreRadius(a);
    for (let ri = 1; ri <= 18; ri += 1) {
      const r = shore * (ri / 19);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const d = lake.depthAt(x, z);
      if (d <= 0) landInLake += 1;
      if (ri < 17) minLakeDepth = Math.min(minLakeDepth, d);
      maxDepth = Math.max(maxDepth, d);
      bands.shallow ||= d >= 1 && d <= 4;
      bands.mid ||= d >= 5 && d <= 10;
      bands.deep ||= d >= 12 && d <= 18;
      bands.veryDeep ||= d >= 20;
      if (Math.hypot(x - lake.start.x, z - lake.start.z) < 18) {
        startTotal += 1;
        if (d > 20) startVeryDeep += 1;
      }
    }
  }

  const shoreR0 = lake.shoreRadius(0);
  const dockTipDepth = lake.depthAt(lake.dockEnd.x, lake.dockEnd.z);
  const holeDepth = lake.depthAt(lake.mainHole.x, lake.mainHole.z);
  const holeFromDock = Math.hypot(lake.mainHole.x - lake.dockEnd.x, lake.mainHole.z - lake.dockEnd.z);
  const holeInfo = lake.radialInfo(lake.mainHole.x, lake.mainHole.z);
  const flatDepth = lake.depthAt(lake.mainFlat.x, lake.mainFlat.z);
  const flatInfo = lake.radialInfo(lake.mainFlat.x, lake.mainFlat.z);
  const holeFlatGap = Math.hypot(lake.mainHole.x - lake.mainFlat.x, lake.mainHole.z - lake.mainFlat.z);
  const structNearDock = lake.structures.filter((s) => Math.hypot(s.x - lake.dockEnd.x, s.z - lake.dockEnd.z) <= 42).length;
  const startVeryDeepFrac = startTotal ? startVeryDeep / startTotal : 0;

  pushIf(errors, !(shoreR0 > 60 && shoreR0 < 200), "shoreR0");
  pushIf(errors, !(dockTipDepth >= 6 && dockTipDepth <= 19), "dockTipDepth");
  pushIf(errors, !bands.shallow || !bands.mid || !bands.deep || !bands.veryDeep, "depthBands");
  pushIf(errors, landInLake > 0, "landInLake");
  pushIf(errors, minLakeDepth < 0.25 || maxDepth < 20 || minLakeDepth > 3, "depthRange");
  pushIf(errors, lake.maxFromDockReach() < 12, "maxFromDock");
  pushIf(errors, !(holeDepth >= 20 && holeDepth <= 34), "holeDepth");
  pushIf(errors, !(holeFromDock > HOLE_DOCK_MIN && holeFromDock <= HOLE_DOCK_MAX), "holeFromDock");
  pushIf(errors, holeInfo.shore - holeInfo.r < 18, "holeInset");
  pushIf(errors, !(flatDepth >= 1.4 && flatDepth <= 4.6), "flatDepth");
  pushIf(errors, flatInfo.shore - flatInfo.r < 6, "flatInset");
  pushIf(errors, holeFlatGap < 45, "holeFlatGap");
  pushIf(errors, lake.shoreSlopeSamples() > 1.4, "shoreSlope");
  pushIf(errors, lake.dockClearance() < 0.25, "dockClearance");
  pushIf(errors, lake.structures.length < 7, "structures");
  pushIf(errors, structNearDock < 2, "structNearDock");
  pushIf(errors, startVeryDeepFrac > 0.06, "startVeryDeepFrac");

  return {
    ok: errors.length === 0,
    errors,
    metrics: {
      shoreR0,
      dockTipDepth,
      minLakeDepth,
      maxDepth: Math.min(maxDepth, MAX_DEPTH + 8),
      holeDepth,
      holeFromDock,
      flatDepth,
      structures: lake.structures.length,
      structNearDock
    }
  };
}

export function resolveLake(seed = 12345) {
  let current = seed >>> 0;
  for (let i = 0; i < 40; i += 1) {
    const lake = new SnejLake(current);
    const validation = validateLake(lake);
    if (validation.ok) {
      lake.validation = validation;
      return lake;
    }
    current = (current + 1) >>> 0;
  }
  const lake = new SnejLake(seed >>> 0);
  lake.validation = validateLake(lake);
  return lake;
}
