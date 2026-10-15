import { createUploadedSkin } from "./uploadedSkin.js?v=man-glb-2";
import { SKIN_DATA as MAN_DATA } from "./assets/man-skin/skinData.js?v=man-glb-2";

export function skinFactory() {
  return createManSkin;
}

export function createManSkin(skeleton) {
  return createUploadedSkin(skeleton, { data: MAN_DATA, assetFolder: "man-skin", name: "ManAnglerModel", gltfTextures: true });
}
