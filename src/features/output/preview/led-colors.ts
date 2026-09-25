// The bytes are PWM duty, which an LED turns into light linearly while a screen applies its own curve: shown raw, a strip
// at 10% looks nearly off here and clearly lit in the room. The monitors show what the eye gets.
export const SEEN = Uint8Array.from({ length: 256 }, (_, v) => Math.round(255 * (v / 255) ** (1 / 2.2)))
