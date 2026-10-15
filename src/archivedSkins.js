import { createUploadedSkin } from "./uploadedSkin.js?v=man-glb-1";
import { SKIN_DATA as ELISE_DATA } from "./assets/elise-skin/skinData.js?v=skin-assets-1";
import { SKIN_DATA as ZUBENKO_DATA } from "./assets/zubenko-skin/skinData.js?v=skin-assets-1";

// Retained for asset regression tests, not imported by the game or offered to players.
export function createEliseSkin(skeleton) {
  return createUploadedSkin(skeleton, { data: ELISE_DATA, assetFolder: "elise-skin", name: "EliseAnglerModel", cutouts: true, fingertipWeights: true });
}
export function createZubenkoSkin(skeleton) {
  return createUploadedSkin(skeleton, { data: ZUBENKO_DATA, assetFolder: "zubenko-skin", name: "ZubenkoAnglerModel" });
}
