export const RODS = Object.freeze([
  Object.freeze({ length: 4, range: 20 }),
  Object.freeze({ length: 5, range: 25 }),
  Object.freeze({ length: 6, range: 30 })
]);

export const rodForLength = (length) => RODS.find((rod) => rod.length === Number(length)) || RODS[0];
