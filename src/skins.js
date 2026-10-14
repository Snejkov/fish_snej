import { createUploadedSkin } from "./uploadedSkin.js?v=skin-choice-1";
import { SKIN_DATA as ELISE_DATA } from "./assets/elise-skin/skinData.js?v=skin-assets-1";
import { SKIN_DATA as ZUBENKO_DATA } from "./assets/zubenko-skin/skinData.js?v=skin-assets-1";
import { normalizeSkinId } from "./skinIds.js?v=skin-choice-2";

export function createEliseSkin(skeleton) {
  return createUploadedSkin(skeleton, { data: ELISE_DATA, assetFolder: "elise-skin", name: "EliseAnglerModel", cutouts: true, fingertipWeights: true });
}

export function skinFactory(skinId) {
  const id = normalizeSkinId(skinId);
  if (id === "zubenko") return createZubenkoSkin;
  return id === "elise" ? createEliseSkin : createUploadedSkin;
}

export function createZubenkoSkin(skeleton) {
  return createUploadedSkin(skeleton, { data: ZUBENKO_DATA, assetFolder: "zubenko-skin", name: "ZubenkoAnglerModel" });
}
