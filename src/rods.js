export const RODS = Object.freeze([
  Object.freeze({ length: 4, range: 8 }),
  Object.freeze({ length: 5, range: 10 }),
  Object.freeze({ length: 6, range: 12 })
]);

export const rodForLength = (length) => RODS.find((rod) => rod.length === Number(length)) || RODS[0];
