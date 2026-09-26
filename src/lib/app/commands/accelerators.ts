import { isMac } from '@/lib/app/platform'

export interface Accelerator {
  mod: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

export function parseAccelerator(text: string): Accelerator {
  const parts = text.split('+')
  const key = parts.pop()!.toLowerCase()
  return { mod: parts.includes('Mod'), ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), key }
}

const keyName = (key: string) => (key === 'numpaddecimal' ? 'Numpad .' : key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1))

/** `⌃⌥⇧⌘K` on macOS, `Ctrl+Alt+Shift+K` elsewhere. */
export function formatAccelerator(text: string, mac = isMac()): string {
  const { mod, ctrl, shift, alt, key } = parseAccelerator(text)
  if (mac) return `${ctrl ? '⌃' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${mod ? '⌘' : ''}${({ enter: '↩', backspace: '⌫', delete: '⌦', home: '↖' } as Record<string, string>)[key] ?? keyName(key)}`
  return [...(mod || ctrl ? ['Ctrl'] : []), ...(alt ? ['Alt'] : []), ...(shift ? ['Shift'] : []), keyName(key)].join('+')
}

/** The accelerator as the key names `UKbd` and the `kbds` props of Nuxt UI take. */
export function acceleratorKbds(text: string): string[] {
  const { mod, ctrl, shift, alt, key } = parseAccelerator(text)
  return [...(mod ? ['meta'] : []), ...(ctrl ? ['ctrl'] : []), ...(alt ? ['alt'] : []), ...(shift ? ['shift'] : []), key === 'numpaddecimal' ? keyName(key) : key]
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

function eventKey(e: KeyLike): string {
  // with NumLock off the numpad period sends Delete, which must not delete nodes; the numpad digits stay digits
  if (e.code === 'NumpadDecimal') return 'numpaddecimal'
  // Shift turns a digit into a symbol and Option on macOS does the same to a letter, so the physical key stands in for both
  const digit = /^Digit(\d)$/.exec(e.code)
  if (digit) return digit[1]
  const letter = e.altKey ? /^Key([A-Z])$/.exec(e.code) : null
  if (letter) return letter[1].toLowerCase()
  return e.key === ' ' ? 'space' : e.key.toLowerCase()
}

export function matchesAccelerator(e: KeyLike, accelerator: Accelerator, mac = isMac()): boolean {
  const [cmd, ctrl] = mac ? [accelerator.mod, accelerator.ctrl] : [false, accelerator.mod || accelerator.ctrl]
  return e.metaKey === cmd && e.ctrlKey === ctrl && e.shiftKey === accelerator.shift && e.altKey === accelerator.alt && eventKey(e) === accelerator.key
}

/** True when the key or click belongs to a text field or the code editor rather than to the app. */
export const inEditableTarget = (e: Event) => !!(e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor')
