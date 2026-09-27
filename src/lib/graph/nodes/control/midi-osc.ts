import type { FrameBinding } from '@/lib/graph/compile/frame'
import { defineNode, Enum, Float, Int, Text } from '@/lib/graph/authoring'

const KINDS = [{ value: 'cc', label: 'Controller (CC)' }, { value: 'note', label: 'Note' }] as const

export const midiInNode = defineNode('midiIn', {
  title: 'MIDI In',
  description: 'A MIDI controller or key as a 0 to 1 value. Press Learn and move the control to fill in its channel and number. Needs a browser with Web MIDI (Chrome, Edge, Firefox).',
  category: 'input',
  input: {
    kind: { type: Enum(KINDS), label: '', connectable: false, props: { label: 'Message' } },
    channel: { type: Int, label: 'Channel (0 = any)', default: 0, connectable: false, props: { min: 0, max: 16, step: 1, decimals: 0 } },
    number: { type: Int, default: 1, connectable: false, props: { min: 0, max: 127, step: 1, decimals: 0 } },
  },
  output: { value: Float, gate: Float },
  run: ({ kind, channel, number }, _, { midi }) => {
    const value = midi?.value(kind, channel, number) ?? 0
    return { value, gate: Number(value > 0) }
  },
})

export const oscInNode = defineNode('oscIn', {
  title: 'OSC In',
  description: 'Numbers from the latest OSC message sent to Address. The dev server listens on the UDP port; point TouchOSC or a lighting desk at this machine.',
  category: 'input',
  input: {
    port: { type: Int, label: 'UDP Port', default: 9000, connectable: false, props: { min: 1024, max: 65535, step: 1, decimals: 0 } },
    address: { type: Text, label: 'Address', default: '/1/fader1', connectable: false, props: { placeholder: '/1/fader1' } },
  },
  output: { value: Float, second: { type: Float, label: 'Argument 2' }, third: { type: Float, label: 'Argument 3' } },
  run: ({ address }, _, { osc }) => {
    const [value = 0, second = 0, third = 0] = osc?.(address) ?? []
    return { value, second, third }
  },
})

/** The port an OSC In node asks the bridge to listen on. One listener serves every OSC node, so the first decides. */
export const oscPortFrom = (inputs: Record<string, FrameBinding>) => (inputs.port as { constant: number }).constant
