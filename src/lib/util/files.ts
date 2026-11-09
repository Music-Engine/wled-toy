/** Lowercase, without the dot; empty when the name has none. */
export const extension = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')

export const baseName = (path: string) => path.split(/[\\/]/).pop()!
