import { reactive, type Ref } from 'vue'
import { log } from '@/lib/app/logs'

export interface MidiMessage {
  kind: 'cc' | 'note'
  /** 1 to 16. */
  channel: number
  /** Controller or note number, 0 to 127. */
  number: number
  /** 0 to 1. For a note: its velocity, or 0 when released. */
  value: number
}

/** Reads what nodes ask for: the latest value of a controller or note. Channel 0 matches any channel. */
export interface MidiReader {
  value(kind: MidiMessage['kind'], channel: number, number: number): number
}

export function parseMidi(data: Uint8Array): MidiMessage | null {
  const [status = 0, number = 0, raw = 0] = data
  const channel = (status & 0x0f) + 1
  const type = status & 0xf0
  if (type === 0xb0) return { kind: 'cc', channel, number, value: raw / 127 }
  // a note-on with velocity 0 is how many keyboards send note-off
  if (type === 0x90) return { kind: 'note', channel, number, value: raw / 127 }
  if (type === 0x80) return { kind: 'note', channel, number, value: 0 }
  return null
}

/** All MIDI inputs of the machine merged into one stream. Web MIDI asks for permission on first use. */
export class MidiService implements MidiReader {
  readonly state = reactive({ available: 'requestMIDIAccess' in navigator, enabled: false, inputs: [] as string[], error: null as string | null })
  private readonly latest = new Map<string, number>()
  private readonly listeners = new Set<(message: MidiMessage) => void>()
  private access: MIDIAccess | null = null

  async enable() {
    if (this.access || !this.state.available) return
    try {
      const access = await navigator.requestMIDIAccess()
      this.access = access
      const attach = () => {
        this.state.inputs = [...access.inputs.values()].map((input) => input.name ?? 'MIDI input')
        access.inputs.forEach((input) => (input.onmidimessage = (event) => event.data && this.receive(event.data)))
      }
      attach()
      access.onstatechange = attach
      this.state.enabled = true
      log(`MIDI enabled: ${this.state.inputs.join(', ') || 'no inputs connected yet'}`)
    } catch (e) {
      this.state.error = (e as Error).name === 'SecurityError' || (e as Error).name === 'NotAllowedError' ? 'MIDI access was refused' : (e as Error).message
      log(`MIDI: ${this.state.error}`, 'error')
    }
  }

  receive(data: Uint8Array) {
    const message = parseMidi(data)
    if (!message) return
    this.latest.set(`${message.kind}:${message.channel}:${message.number}`, message.value)
    this.latest.set(`${message.kind}:0:${message.number}`, message.value)
    this.listeners.forEach((listener) => listener(message))
  }

  value(kind: MidiMessage['kind'], channel: number, number: number): number {
    return this.latest.get(`${kind}:${channel}:${number}`) ?? 0
  }

  /** Every incoming message, for "learn" and for moving bound knobs. Returns the unsubscribe function. */
  onMessage(listener: (message: MidiMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/** A knob a controller can move; `cc` is the controller it is bound to, or -1. */
export interface MidiKnob {
  id: string
  min: number
  max: number
  cc: number
}

/**
 * Knobs follow their controllers: a controller message first binds the knob waiting in `learning`, if any, then moves
 * every knob bound to it across the knob's range. `knobs` is read after the bind, so the knob just bound moves at once.
 * Returns the unsubscribe function.
 */
export function bindKnobs(midi: Pick<MidiService, 'onMessage'>, { knobs, learning, set }: {
  knobs: () => readonly MidiKnob[]
  learning: Ref<string | null>
  set: (id: string, patch: { cc: number } | { value: number }) => void
}): () => void {
  return midi.onMessage((message) => {
    if (message.kind !== 'cc') return
    if (learning.value) {
      set(learning.value, { cc: message.number })
      learning.value = null
    }
    for (const knob of knobs()) {
      if (knob.cc === message.number) set(knob.id, { value: Number((knob.min + (knob.max - knob.min) * message.value).toFixed(4)) })
    }
  })
}
