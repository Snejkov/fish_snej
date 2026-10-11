import { SnejFishingGame } from "./game.js?v=0.0.4-hf4";

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("game-canvas");
  let bootstrapSnejkov = false;
  try {
    bootstrapSnejkov = localStorage.getItem("snejfishing-bootstrap-v1") === "snejkov";
  } catch {
    bootstrapSnejkov = false;
  }
  window.snejFishing = new SnejFishingGame(canvas, { bootstrapSnejkov });
});
