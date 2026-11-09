import { describe, expect, it } from 'vitest'
import { acceleratorKbds, formatAccelerator, matchesAccelerator, parseAccelerator } from './accelerators'

const key = (init: Partial<Record<'key' | 'code', string> & Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>>) => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
})

describe('accelerators', () => {
  it('parses modifiers in any order and lowercases the key', () => {
    expect(parseAccelerator('Mod+Shift+Enter')).toEqual({ mod: true, ctrl: false, shift: true, alt: false, key: 'enter' })
    expect(parseAccelerator('Shift+Alt+Mod+K')).toEqual({ mod: true, ctrl: false, shift: true, alt: true, key: 'k' })
    expect(parseAccelerator('Home')).toEqual({ mod: false, ctrl: false, shift: false, alt: false, key: 'home' })
    expect(parseAccelerator('Mod+,')).toEqual({ mod: true, ctrl: false, shift: false, alt: false, key: ',' })
    expect(parseAccelerator('Ctrl+Space')).toEqual({ mod: false, ctrl: true, shift: false, alt: false, key: 'space' })
  })

  it('formats as glyphs on macOS and as Ctrl+ text elsewhere', () => {
    expect(formatAccelerator('Mod+Shift+Enter', true)).toBe('⇧⌘↩')
    expect(formatAccelerator('Mod+Shift+Enter', false)).toBe('Ctrl+Shift+Enter')
    expect(formatAccelerator('Mod+Alt+Shift+L', true)).toBe('⌥⇧⌘L')
    expect(formatAccelerator('Mod+Alt+Shift+L', false)).toBe('Ctrl+Alt+Shift+L')
    expect(formatAccelerator('Mod+,', true)).toBe('⌘,')
    expect(formatAccelerator('Shift+F1', false)).toBe('Shift+F1')
    expect(formatAccelerator('Space', true)).toBe('Space')
    expect(formatAccelerator('Home', true)).toBe('↖')
    expect(formatAccelerator('Home', false)).toBe('Home')
    expect(formatAccelerator('Ctrl+H', true)).toBe('⌃H')
    expect(formatAccelerator('Ctrl+H', false)).toBe('Ctrl+H')
    expect(formatAccelerator('NumpadDecimal', true)).toBe('Numpad .')
  })

  it('names the keys the way Nuxt UI kbds take them', () => {
    expect(acceleratorKbds('Mod+Alt+Shift+P')).toEqual(['meta', 'alt', 'shift', 'p'])
    expect(acceleratorKbds('Home')).toEqual(['home'])
    expect(acceleratorKbds('Ctrl+Space')).toEqual(['ctrl', 'space'])
    expect(acceleratorKbds('NumpadDecimal')).toEqual(['Numpad .'])
  })

  it('Ctrl is Ctrl on every platform, so on macOS it is not Cmd, and elsewhere it is the same key as Mod', () => {
    const hide = parseAccelerator('Ctrl+H')
    expect(matchesAccelerator(key({ key: 'h', ctrlKey: true }), hide, true)).toBe(true)
    expect(matchesAccelerator(key({ key: 'h', metaKey: true }), hide, true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'h', ctrlKey: true }), hide, false)).toBe(true)
    expect(matchesAccelerator(key({ key: 'h', ctrlKey: true }), parseAccelerator('Mod+H'), true)).toBe(false)
  })

  it('the numpad period is its own key, also when NumLock off makes it Delete, and the numpad digits stay digits', () => {
    for (const sent of ['.', 'Delete']) {
      expect(matchesAccelerator(key({ key: sent, code: 'NumpadDecimal' }), parseAccelerator('NumpadDecimal'), true)).toBe(true)
      expect(matchesAccelerator(key({ key: sent, code: 'NumpadDecimal' }), parseAccelerator('Delete'), true)).toBe(false)
    }
    expect(matchesAccelerator(key({ key: 'Delete', code: 'Delete' }), parseAccelerator('Delete'), true)).toBe(true)
    expect(matchesAccelerator(key({ key: '1', code: 'Numpad1', metaKey: true }), parseAccelerator('Mod+1'), true)).toBe(true)
  })

  it('Mod is Cmd on macOS and Ctrl elsewhere, and the other one never stands in', () => {
    const toggle = parseAccelerator('Mod+B')
    expect(matchesAccelerator(key({ key: 'b', metaKey: true }), toggle, true)).toBe(true)
    expect(matchesAccelerator(key({ key: 'b', ctrlKey: true }), toggle, true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'b', ctrlKey: true }), toggle, false)).toBe(true)
    expect(matchesAccelerator(key({ key: 'b', metaKey: true }), toggle, false)).toBe(false)
    expect(matchesAccelerator(key({ key: 'b', metaKey: true, ctrlKey: true }), toggle, true)).toBe(false)
  })

  it('an extra or a missing modifier is a different accelerator', () => {
    expect(matchesAccelerator(key({ key: 'B', metaKey: true, shiftKey: true }), parseAccelerator('Mod+B'), true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'b' }), parseAccelerator('Mod+B'), true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'Home', metaKey: true }), parseAccelerator('Home'), true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'Home', ctrlKey: true }), parseAccelerator('Home'), true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'Home' }), parseAccelerator('Home'), true)).toBe(true)
  })

  it('reads the physical key where Shift or Option changes the character', () => {
    expect(matchesAccelerator(key({ key: ')', code: 'Digit0', metaKey: true, shiftKey: true }), parseAccelerator('Mod+Shift+0'), true)).toBe(true)
    expect(matchesAccelerator(key({ key: '˚', code: 'KeyK', metaKey: true, altKey: true }), parseAccelerator('Mod+Alt+K'), true)).toBe(true)
    expect(matchesAccelerator(key({ key: ' ', code: 'Space', metaKey: true, shiftKey: true }), parseAccelerator('Mod+Shift+Space'), true)).toBe(true)
    // without Option the character decides, so a remapped layout keeps its letters
    expect(matchesAccelerator(key({ key: 'j', code: 'KeyC', metaKey: true }), parseAccelerator('Mod+J'), true)).toBe(true)
  })

  it('a bare letter does not answer its Shift chord, so Shift+X stays free for a command of its own', () => {
    expect(matchesAccelerator(key({ key: 'x', code: 'KeyX' }), parseAccelerator('X'), true)).toBe(true)
    expect(matchesAccelerator(key({ key: 'X', code: 'KeyX', shiftKey: true }), parseAccelerator('X'), true)).toBe(false)
  })
})
