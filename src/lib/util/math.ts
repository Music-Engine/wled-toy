export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Clamps between two bounds given in either order */
export const clampBetween = (value: number, a: number, b: number) => clamp(value, Math.min(a, b), Math.max(a, b))
