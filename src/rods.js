export const RODS = Object.freeze([
  Object.freeze({ id: "rod.bamboo.4m", kind: "rod", name: "Bamboo 4m",
    description: "A short, light bamboo rod. Beginner-friendly.", length: 4, range: 8,
    price: 0, unlocked: true, color: 0xc8a868 }),
  Object.freeze({ id: "rod.fiberglass.5m", kind: "rod", name: "Fiberglass 5m",
    description: "Mid-range rod. A bit longer, a bit further.", length: 5, range: 10,
    price: 50, unlocked: true, color: 0x7a8b9a }),
  Object.freeze({ id: "rod.carbon.6m", kind: "rod", name: "Carbon 6m",
    description: "Stiff, light, long reach. For patient anglers.", length: 6, range: 12,
    price: 200, unlocked: true, color: 0x2a2a32 })
]);

export const rodForLength = (length) => RODS.find((rod) => rod.length === Number(length)) || RODS[0];

export const rodById = (id) => RODS.find((rod) => rod.id === id) || RODS[0];
