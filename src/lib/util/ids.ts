export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => (n % 36).toString(36)).join('')
}
