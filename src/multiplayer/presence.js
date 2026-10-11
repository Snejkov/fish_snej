export function makePresence(game, seq) {
  return {
    seq,
    id: game.identity?.id || 0,
    name: game.playerName || "Player",
    rank: game.currentRank || "player",
    x: game.pos.x,
    y: game.pos.y,
    z: game.pos.z,
    yaw: game.yaw,
    pitch: game.pitch,
    view: game.cameraMode,
    moving: game.moveAmt || 0,
    sentAt: Date.now()
  };
}
