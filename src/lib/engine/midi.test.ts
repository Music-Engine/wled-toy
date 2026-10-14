import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { MidiKnob } from './midi'

vi.stubGlobal('navigator', {})
const { MidiService, bindKnobs, parseMidi } = await import('./midi')

describe('parseMidi', () => {
  it('reads controllers and notes with their channel', () => {
    expect(parseMidi(Uint8Array.of(0xb0, 74, 64))).toEqual({ kind: 'cc', channel: 1, number: 74, value: 64 / 127 })
    expect(parseMidi(Uint8Array.of(0x95, 60, 127))).toEqual({ kind: 'note', channel: 6, number: 60, value: 1 })
  })

  it('treats note-off and note-on with velocity 0 alike, and ignores the rest', () => {
    expect(parseMidi(Uint8Array.of(0x80, 60, 40))?.value).toBe(0)
    expect(parseMidi(Uint8Array.of(0x90, 60, 0))?.value).toBe(0)
    expect(parseMidi(Uint8Array.of(0xe0, 0, 64))).toBeNull()
    expect(parseMidi(Uint8Array.of(0xf8))).toBeNull()
  })
})

describe('MidiService', () => {
  it('keeps the latest value per channel and for "any channel", and tells listeners', () => {
    const midi = new MidiService()
    const seen: number[] = []
    const stop = midi.onMessage((m) => seen.push(m.number))
    midi.receive(Uint8Array.of(0xb2, 74, 64))
    expect(midi.value('cc', 3, 74)).toBeCloseTo(0.504, 3)
    expect(midi.value('cc', 0, 74)).toBeCloseTo(0.504, 3)
    expect(midi.value('cc', 1, 74)).toBe(0)
    stop()
    midi.receive(Uint8Array.of(0xb2, 75, 1))
    expect(seen).toEqual([74])
  })

  it('reports that Web MIDI is missing instead of throwing', async () => {
    const midi = new MidiService()
    expect(midi.state.available).toBe(false)
    await midi.enable()
    expect(midi.state.enabled).toBe(false)
  })
})

describe('bindKnobs', () => {
  function setup(knobs: MidiKnob[], learningId: string | null = null) {
    const midi = new MidiService()
    const learning = ref(learningId)
    const patches: [string, object][] = []
    const set = (id: string, patch: { cc: number } | { value: number }) => {
      patches.push([id, patch])
      Object.assign(knobs.find((k) => k.id === id)!, patch)
    }
    const stop = bindKnobs(midi, { knobs: () => knobs, learning, set })
    return { midi, learning, patches, stop }
  }

  it('moves a bound knob across its range, rounded to four places', () => {
    const { midi, patches } = setup([
      { id: 'a', min: 0, max: 2, cc: 74 },
      { id: 'b', min: 0, max: 1, cc: -1 },
    ])
    midi.receive(Uint8Array.of(0xb0, 74, 64))
    expect(patches).toEqual([['a', { value: 1.0079 }]])
  })

  it('binds the learning knob to the controller and moves it with the same message', () => {
    const { midi, learning, patches } = setup([{ id: 'a', min: 0, max: 1, cc: -1 }], 'a')
    midi.receive(Uint8Array.of(0xb0, 20, 127))
    expect(patches).toEqual([
      ['a', { cc: 20 }],
      ['a', { value: 1 }],
    ])
    expect(learning.value).toBeNull()
  })

  it('ignores notes, and nothing moves once unbound', () => {
    const { midi, patches, stop } = setup([{ id: 'a', min: 0, max: 1, cc: 60 }])
    midi.receive(Uint8Array.of(0x90, 60, 127))
    stop()
    midi.receive(Uint8Array.of(0xb0, 60, 127))
    expect(patches).toEqual([])
  })
})
