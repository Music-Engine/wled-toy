/** A deep copy through JSON, which also unwraps the reactive proxies Vue leaves nested in data that structuredClone rejects. */
export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** Equal serializations, so key order counts: `{ a, b }` and `{ b, a }` differ. */
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
