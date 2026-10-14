import { categoryById, type CategoryId } from '@/lib/shader/catalog'
import { directory, leaf, separator, type MenuDirectory, type MenuEntry, type MenuFs, type MenuItem, type MenuPreset } from '@/lib/shader/menu-fs'
import { toGlslForm } from '@/lib/graph/compile/compilers'
import type { NodeItem } from '@/lib/graph/define/shape'
import { findNodeItem } from '@/lib/graph/registry'
import type { DataType } from '@/lib/graph/define/types'

const UNIFORMS = ['iResolution', 'iLedCount', 'iScanY', 'iAudio', 'iImage']
const uniforms = new Set(UNIFORMS)

const toLeaves = (ids: string[]) => ids.map((id) => leaf(findKind(id)))

export const GRAPH_FS: MenuFs<NodeItem> = {
  title: 'Add',
  items: [
    buildCategoryDirectory(
      'input',
      ['uv', 'ledLayout', 'time', 'value', 'vector2', 'color', 'knob', 'midiIn', 'oscIn', 'sceneSwitch'],
      [directory('Uniforms', toLeaves(UNIFORMS), { description: 'Values the engine updates every frame.' })],
    ),
    buildCategoryDirectory(
      'output',
      ['output'],
      [
        directory('Feedback', toLeaves(['trails', 'stripBlur', 'previousFrame']), {
          description: 'Nodes that read what the Output showed on the previous frame.',
        }),
      ],
    ),
    buildCategoryDirectory('noise', [
      'noiseTexture',
      'whiteNoise',
      'voronoi',
      'waveTexture',
      'magicTexture',
      'gradientTexture',
      'checkerTexture',
      'brickTexture',
    ]),
    buildCategoryDirectory('image', ['imageTexture']),
    buildCategoryDirectory(
      'color',
      [
        'colorMix',
        'layerMix',
        'mask',
        'colorRamp',
        'gradientPalette',
        'hueSaturation',
        'brightnessCeiling',
        'brightnessContrast',
        'gamma',
        'invert',
        'hsv2rgb',
        'rgb2hsv',
      ],
      toLeaves(['palette', 'luminance', 'kelvin']),
    ),
    buildCategoryDirectory(
      'converter',
      ['math', 'vectorMath', 'mix', 'clamp', 'remap', 'curve', 'random', 'combineXYZ', 'separateXYZ', 'separateColor', 'combineColor'],
      [buildPresetDirectory('math'), buildPresetDirectory('vectorMath')],
    ),
    buildCategoryDirectory(
      'signal',
      ['wave', 'integrator', 'viewer'],
      [
        directory('Smoothing', toLeaves(['envelopeFollower', 'peakHold', 'slewLimiter'])),
        directory('Triggers', toLeaves(['schmittTrigger', 'envelope', 'sampleHold', 'counter', 'toggle', 'clockDivider', 'stepSequencer'])),
      ],
    ),
    buildCategoryDirectory('math', ['mapping', 'polar', 'mirror', 'tile', 'rotate', 'segmentSplit', 'rangeSelect', 'fromCenter']),
    buildCategoryDirectory('strip', [], toLeaves(['stripes', 'chase', 'scanner', 'sparkle'])),
    buildCategoryDirectory('animation', []),
    buildCategoryDirectory(
      'audio',
      ['audioSource', 'fft', 'audio', 'audioSignal', 'bands', 'bandSplit', 'spectrum', 'waveform', 'chroma'],
      toLeaves(['bandLevel']),
    ),
    buildCategoryDirectory('builtin', [], toLeaves(['smoothstep', 'texture'])),
  ],
}

/** `socketColor` from the editor, which owns how socket types are drawn */
export function describeNodeItem(item: NodeItem, preset: MenuPreset | undefined, socketColor: (type: DataType<any>) => string): MenuEntry {
  const category = categoryById.get(item.category)!
  const shape = preset ? item.shape(preset.values) : item.base
  return {
    id: preset ? `${item.id}:${preset.title}` : item.id,
    title: preset?.title ?? item.title,
    of: preset && item.title,
    description: item.description,
    signature: shape.signature,
    keywords: item.id,
    color: category.color,
    icon: category.icon,
    inputs: shape.inputs.map((socket) => ({
      label: socket.label || socket.type.label,
      type: socket.type.kind === 'value' ? toGlslForm(socket.type).type : socket.type.label,
      color: socket.linkable ? socketColor(socket.type) : '',
    })),
    outputs: shape.outputs.map((socket) => ({ label: socket.label, color: socketColor(socket.type) })),
    note: uniforms.has(item.id) ? 'uniform' : undefined,
  }
}

/** Category-themed directory: own nodes, separator, then injected GLSL functions and sub-directories */
function buildCategoryDirectory(id: CategoryId, own: string[], rest: MenuItem<NodeItem>[] = []): MenuDirectory<NodeItem> {
  const category = categoryById.get(id)!
  const items: MenuItem<NodeItem>[] = toLeaves(own)
  if (own.length && rest.length) items.push(separator)
  items.push(...rest)
  return directory(category.label, items, { icon: category.icon, color: category.color })
}

/** Each preset its own entry, under its group if any */
function buildPresetDirectory(id: string): MenuDirectory<NodeItem> {
  const item = findKind(id)
  const presets = item.presets ?? []
  if (!presets.length) throw new Error(`The Add menu lists presets of "${id}", which has none`)
  const toPresetLeaves = (group?: string) => presets.filter((preset) => preset.group === group).map((preset) => leaf(item, preset))
  const groups = [...new Set(presets.map((preset) => preset.group))]
  return directory(
    `${item.title} Operations`,
    groups.flatMap((group): MenuItem<NodeItem>[] => (group ? [directory(group, toPresetLeaves(group))] : toPresetLeaves())),
  )
}

function findKind(id: string): NodeItem {
  const item = findNodeItem(id)
  if (!item) throw new Error(`The Add menu names unknown node kind "${id}"`)
  return item
}
