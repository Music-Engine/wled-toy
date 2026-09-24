/** Fraction of the way to move toward a target this frame so that 63% is covered after `seconds`, at any frame rate. */
export const approach = (dt: number, seconds: number) => (seconds <= 0 ? 1 : 1 - Math.exp(-dt / seconds))
