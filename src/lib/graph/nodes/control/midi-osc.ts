import { defineNode, Enum, Float, Int, Text } from '@/lib/graph/authoring'

const KINDS = [{ value: 'cc', label: 'Controller (CC)' }, { value: 'note', label: 'Note' }] as const

export const midiInNode = defineNode('midiIn', {
  title: 'MIDI In',
  description: 'A MIDI controller or key as a 0 to 1 value. Press Learn and move the knob, fader or key to fill in its channel and number. Needs a browser with Web MIDI (Chrome, Edge, Firefox).',
  category: 'input',
  input: {
    kind: { type: Enum(KINDS), label: '', linkable: false, props: { label: 'Message' } },
    channel: { type: Int, label: 'Channel (0 = any)', default: 0, linkable: false, props: { min: 0, max: 16, step: 1, decimals: 0 } },
    number: { type: Int, default: 1, linkable: false, props: { min: 0, max: 127, step: 1, decimals: 0 } },
  },
  output: { value: Float, gate: Float },
  resolve: ({ kind, channel, number }) => {
    const toUniform = (gate: boolean) => ({ kind: 'midi', default: 0, message: kind, channel, number, gate }) as const
    return { uniforms: { value: toUniform(false), gate: toUniform(true) } }
  },
})

export const oscInNode = defineNode('oscIn', {
  title: 'OSC In',
  description: 'Numbers from the latest OSC message sent to Address. The dev server listens on the UDP port; point TouchOSC or a lighting desk at this machine.',
  category: 'input',
  input: {
    port: { type: Int, label: 'UDP Port', default: 9000, linkable: false, props: { min: 1024, max: 65535, step: 1, decimals: 0 } },
    address: { type: Text, label: 'Address', default: '/1/fader1', linkable: false, props: { placeholder: '/1/fader1' } },
  },
  output: { value: Float, second: { type: Float, label: 'Argument 2' }, third: { type: Float, label: 'Argument 3' } },
  // One listener for every OSC In: first port asked for wins
  resolve: ({ port, address }, resources) => {
    const [value, second, third] = [0, 1, 2].map((argument) => ({ kind: 'osc', default: 0, address, argument }) as const)
    const uniforms = { value, second, third }
    const open = resources.osc?.[0]
    if (open !== undefined && open !== port) return { uniforms, issues: [`Another OSC In listens on port ${open}; one port is open at a time, so this one reads that port`] }
    return { uniforms, requires: [{ kind: 'osc', config: port }] }
  },
})
