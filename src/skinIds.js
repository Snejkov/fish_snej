export const DEFAULT_SKIN_ID = "man";
export const SKIN_OPTIONS = Object.freeze([
  Object.freeze({ id: "man", name: "New Angler", portrait: "./src/assets/man-skin/portrait.png" })
]);

export function normalizeSkinId(value) {
  return SKIN_OPTIONS.some((skin) => skin.id === value) ? value : DEFAULT_SKIN_ID;
}

const PREFERENCE_KEY = "snejfishing-skin-v1";
export function readSkinPreference() {
  try { return normalizeSkinId(globalThis.localStorage?.getItem(PREFERENCE_KEY)); }
  catch { return DEFAULT_SKIN_ID; }
}

export function saveSkinPreference(value) {
  const skinId = normalizeSkinId(value);
  try { globalThis.localStorage?.setItem(PREFERENCE_KEY, skinId); } catch { /* Storage can be unavailable in private browsing. */ }
  return skinId;
}
