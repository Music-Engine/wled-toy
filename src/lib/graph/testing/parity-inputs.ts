// Dyadic fractions, exact in a float and in a GLSL literal's four decimals: negatives, zero, zero divisor or range,
// and the equal operands step() edges turn on
export const MATH_INPUTS: [number, number, number][] = [
  [-2.5, 2, 0.5],
  [-0.75, -1.5, 0.25],
  [0, 0.5, 0],
  [0.375, 0, 1.25],
  [0.75, 0.25, 0.5],
  [1.25, 3, -0.75],
  [3, -2, 2.5],
  [-1.25, 0.5, 0.5],
  [0.25, 0.375, 1],
  [0.5, 0.5, 0.125],
  [2, 1, 0.25],
]

export const VECTOR_INPUTS: { a: [number, number, number]; b: [number, number, number]; c: [number, number, number]; scale: number }[] = [
  { a: [-2.5, 0.375, 1.25], b: [0.5, -1.5, 2], c: [1, 0.25, -0.75], scale: 2 },
  { a: [0, 0, 0], b: [0.25, 0, -0.5], c: [0.5, 0.5, 0.5], scale: -0.75 },
  { a: [3, -0.75, 0.5], b: [-1.25, 2, 0.25], c: [-1.25, 3, 0.25], scale: 0 },
  { a: [0.75, -2, -0.375], b: [1, 1, 1], c: [0, -0.5, 1.5], scale: 0.5 },
  { a: [1.25, 0.5, -1], b: [-0.75, 0.25, 0.5], c: [2, 1, 0], scale: -1.5 },
  { a: [1.25, -0.5, 0.75], b: [0, 0, 0], c: [0.25, -1, 2], scale: 3 },
]
