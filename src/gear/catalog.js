import { RODS } from "../rods.js?v=0.0.5a";

export { RODS };

export const BAITS = Object.freeze([
  Object.freeze({ id: "bait.earthworm", kind: "bait", name: "Earthworm",
    description: "Universal bait. Attracts most small fish.", price: 2, stackable: true, startingCount: 10 }),
  Object.freeze({ id: "bait.bread", kind: "bait", name: "Bread",
    description: "Soft, cheap. Attracts shy fish but washes off quickly.", price: 1, stackable: true, startingCount: 10 }),
  Object.freeze({ id: "bait.corn", kind: "bait", name: "Sweet Corn",
    description: "Bright, holds on the hook well. Attracts larger fish.", price: 4, stackable: true, startingCount: 5 }),
  Object.freeze({ id: "bait.maggot", kind: "bait", name: "Maggot",
    description: "Strong smell. Attracts bottom feeders.", price: 3, stackable: true, startingCount: 5 })
]);

export const LURES = Object.freeze([
  Object.freeze({ id: "lure.spinner.5g", kind: "lure", name: "Spinner 5g",
    description: "Small spinning lure. Replaces bait for predator fish.", price: 30, unlocked: true })
]);

export const LINES = Object.freeze([
  Object.freeze({ id: "line.mono.0.20", kind: "line", name: "Mono 0.20 mm",
    description: "Thin, low-visibility line. Best for clear water.", price: 0, unlocked: true,
    visibility: 0.5, stretch: 0.05, breakingStrengthKg: 2 }),
  Object.freeze({ id: "line.mono.0.30", kind: "line", name: "Mono 0.30 mm",
    description: "Thicker, more visible. For murky water and bigger fish.", price: 15, unlocked: true,
    visibility: 1, stretch: 0.04, breakingStrengthKg: 5 })
]);

export const HOOKS = Object.freeze([
  Object.freeze({ id: "hook.single.8", kind: "hook", name: "Single Hook #8",
    description: "Small single hook. Standard choice.", price: 0, unlocked: true }),
  Object.freeze({ id: "hook.treble.4", kind: "hook", name: "Treble Hook #4",
    description: "Three points. Better hookup, damages fish more.", price: 20, unlocked: true })
]);

export const CATALOG = Object.freeze({ rod: RODS, bait: BAITS, lure: LURES, line: LINES, hook: HOOKS });
export const findItem = (id) => Object.values(CATALOG).flat().find((item) => item.id === id) || null;
export const defaultItemId = (kind) => CATALOG[kind]?.[0]?.id || null;
