import { DEFAULT_OUTPUT } from '@/lib/engine/output'
import { Color, defineNode, Enum, Float, Int } from '@/lib/graph/authoring'

const PROTOCOLS = [
  { value: 'settings', label: 'Protocol from Settings' }, { value: 'ddp', label: 'DDP' }, { value: 'dnrgb', label: 'WLED DNRGB' },
  { value: 'artnet', label: 'Art-Net' }, { value: 'sacn', label: 'sACN (E1.31)' },
] as const
const DITHERING = [{ value: 'off', label: 'No Dithering' }, { value: 'temporal', label: 'Temporal Dithering' }] as const

export const outputNode = defineNode('output', {
  title: 'Output',
  description: 'Final LED color, and how it gets to the wire. These settings travel with the graph and replace the ones in Settings while the graph is running.',
  category: 'output',
  signature: 'c = vec4(color, 1.0);',
  isOutput: true,
  input: {
    color: { type: Color, default: [1, 0.45, 0.1] },
    protocol: { type: Enum(PROTOCOLS), label: '', default: DEFAULT_OUTPUT.protocol, connectable: false, props: { label: 'Protocol' } },
    universe: { type: Int, label: 'First Universe', default: DEFAULT_OUTPUT.universe, connectable: false, props: { min: 0, max: 32767, step: 1, decimals: 0 } },
    fps: { type: Int, label: 'FPS (0 = Settings)', default: DEFAULT_OUTPUT.fps, connectable: false, props: { min: 0, max: 120, step: 1, decimals: 0 } },
    gamma: { type: Float, default: DEFAULT_OUTPUT.gamma, connectable: false, props: { min: 0.1, max: 4, step: 0.1, decimals: 2 } },
    ceiling: { type: Float, label: 'Brightness Ceiling', default: DEFAULT_OUTPUT.ceiling, connectable: false, props: { min: 0, max: 1, decimals: 2 } },
    powerBudgetMa: { type: Float, label: 'Power Budget (mA, 0 = off)', default: DEFAULT_OUTPUT.powerBudgetMa, connectable: false, props: { min: 0, step: 100, decimals: 0 } },
    maPerChannel: { type: Float, label: 'mA per Channel', default: DEFAULT_OUTPUT.maPerChannel, connectable: false, props: { min: 1, max: 100, decimals: 0 } },
    dithering: { type: Enum(DITHERING), label: '', default: DEFAULT_OUTPUT.dithering, connectable: false, props: { label: 'Dithering' } },
  },
  output: {},
  exec: ({ color, ...settings }, ctx) => {
    ctx.emit(`c = vec4(${color.expr}, 1.0);`)
    ctx.output(settings)
    return {}
  },
})

