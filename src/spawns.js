export const SPAWNS = Object.freeze({
  initial: Object.freeze({ x: 0, y: 1.0, z: 50, yaw: 0, pitch: -0.12 }),
  alpha: Object.freeze({ x: 0, y: 1.0, z: 50, yaw: 0, pitch: -0.12 }),
  bravo: Object.freeze({ x: 50, y: 1.0, z: 50, yaw: Math.PI * 0.5, pitch: -0.12 }),
  charlie: Object.freeze({ x: 50, y: 1.0, z: 0, yaw: Math.PI, pitch: -0.12 }),
  delta: Object.freeze({ x: 80, y: 1.0, z: 80, yaw: Math.PI * 0.25, pitch: -0.12 })
});

export const SPAWN_NAMES = Object.freeze(["initial", "alpha", "bravo", "charlie", "delta"]);
export const SPAWN_INITIAL_NAME = "initial";
