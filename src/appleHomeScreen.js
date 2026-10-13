export function appleHomeScreenState(environment = globalThis) {
  const navigator = environment.navigator || {};
  const appleMobile = /iPhone|iPad/.test(navigator.userAgent || "")
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // iPad can request a desktop UA. Touch-capable Windows PCs are not iPads.
  const standalone = appleMobile && (navigator.standalone === true
    || environment.matchMedia?.("(display-mode: standalone)")?.matches === true);
  return { appleMobile, standalone };
}

export function configureAppleHomeScreen(environment = globalThis) {
  const state = appleHomeScreenState(environment), document = environment.document;
  document?.documentElement?.classList.toggle("apple-home-screen", state.standalone);
  for (const guide of document?.querySelectorAll(".apple-home-guide") || []) {
    guide.hidden = !state.appleMobile || state.standalone;
  }
  return state;
}
