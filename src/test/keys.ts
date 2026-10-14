import { isMac, parseAccelerator } from '@/lib/app/commands'

/** The keydown the browser sends for an accelerator, dispatched on `target`. */
export function press(text: string, target: EventTarget = document.body) {
  const { mod, ctrl, shift, alt, key } = parseAccelerator(text)
  const name = key === 'space' ? ' ' : key === 'numpaddecimal' ? '.' : key.length > 1 ? key[0].toUpperCase() + key.slice(1) : shift ? key.toUpperCase() : key
  const event = new KeyboardEvent('keydown', {
    key: name,
    code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : key === 'numpaddecimal' ? 'NumpadDecimal' : '',
    shiftKey: shift,
    altKey: alt,
    bubbles: true,
    cancelable: true,
    ...(mod ? (isMac() ? { metaKey: true } : { ctrlKey: true }) : {}),
    ...(ctrl ? { ctrlKey: true } : {}),
  })
  target.dispatchEvent(event)
  return event
}
