import { categoryById, type CategoryId } from '@/lib/shader/glsl'
import { directory, leaf, separator, type MenuDirectory, type MenuEntry, type MenuFs, type MenuItem, type MenuPreset } from '@/lib/shader/menu-fs'
import { glslForm } from '@/lib/graph/compile/compile'
import type { NodeItem } from '@/lib/graph/define/shape'
import { itemFor } from '@/lib/graph/registry'
import type { DataType } from '@/lib/graph/define/types'

function kind(id: string): NodeItem {
  const item = itemFor(id)
  if (!item) throw new Error(`The Add menu names unknown node kind "${id}"`)
  return item
}

const leaves = (ids: string[]) => ids.map((id) => leaf(kind(id)))

/** A directory themed after a category: the graph's own nodes, a separator, then the injected GLSL functions and sub-directories. */
function categoryDirectory(id: CategoryId, own: string[], rest: MenuItem<NodeItem>[] = []): MenuDirectory<NodeItem> {
  const category = categoryById.get(id)!
  const items: MenuItem<NodeItem>[] = leaves(own)
  if (own.length && rest.length) items.push(separator)
  items.push(...rest)
  return directory(category.label, items, { icon: category.icon, color: category.color })
}

/** Every preset of a kind as its own entry, filed under the preset's group when it has one. */
function presetDirectory(id: string): MenuDirectory<NodeItem> {
  const item = kind(id)
  const presets = item.presets ?? []
  if (!presets.length) throw new Error(`The Add menu lists presets of "${id}", which has none`)
  const presetLeaves = (group?: string) => presets.filter((preset) => preset.group === group).map((preset) => leaf(item, preset))
  const groups = [...new Set(presets.map((preset) => preset.group))]
  return directory(`${item.title} Operations`, groups.flatMap((group): MenuItem<NodeItem>[] => (group ? [directory(group, presetLeaves(group))] : presetLeaves())))
}

const UNIFORMS = ['iResolution', 'iLedCount', 'iScanY', 'iAudio', 'iImage']

export const GRAPH_FS: MenuFs<NodeItem> = {
  title: 'Add',
  items: [
    categoryDirectory('input', ['uv', 'ledLayout', 'time', 'value', 'vector2', 'color', 'knob', 'midiIn', 'oscIn', 'sceneSwitch'], [
      directory('Uniforms', leaves(UNIFORMS), { description: 'Values the engine updates every frame.' }),
    ]),
    categoryDirectory('output', ['output'], [
      directory('Feedback', leaves(['trails', 'stripBlur', 'previousFrame']), { description: 'Nodes that read what the Output showed on the previous frame.' }),
    ]),
    categoryDirectory('noise', ['noiseTexture', 'whiteNoise', 'voronoi', 'waveTexture', 'magicTexture', 'gradientTexture', 'checkerTexture', 'brickTexture']),
    categoryDirectory('image', ['imageTexture']),
    categoryDirectory('color', [
      'colorMix', 'layerMix', 'mask', 'colorRamp', 'gradientPalette', 'hueSaturation', 'brightnessCeiling', 'brightnessContrast', 'gamma', 'invert', 'hsv2rgb', 'rgb2hsv',
    ], leaves(['palette', 'luminance', 'kelvin'])),
    categoryDirectory('converter', ['math', 'vectorMath', 'mix', 'clamp', 'remap', 'curve', 'random', 'combineXYZ', 'separateXYZ', 'separateColor', 'combineColor'], [
      presetDirectory('math'),
      presetDirectory('vectorMath'),
    ]),
    categoryDirectory('signal', ['wave', 'integrator', 'viewer'], [
      directory('Smoothing', leaves(['envelopeFollower', 'peakHold', 'slewLimiter'])),
      directory('Triggers', leaves(['schmittTrigger', 'envelope', 'sampleHold', 'counter', 'toggle', 'clockDivider', 'stepSequencer'])),
    ]),
    categoryDirectory('math', ['mapping', 'polar', 'mirror', 'tile', 'rotate', 'segmentSplit', 'rangeSelect', 'fromCenter']),
    categoryDirectory('strip', [], leaves(['stripes', 'chase', 'scanner', 'sparkle'])),
    categoryDirectory('animation', []),
    categoryDirectory('audio', ['audioSource', 'fft', 'audio', 'audioSignal', 'bands', 'bandSplit', 'spectrum', 'waveform', 'chroma'], leaves(['bandLevel'])),
    categoryDirectory('builtin', [], leaves(['smoothstep', 'texture'])),
  ],
}

const uniforms = new Set(UNIFORMS)

/** `socketColor` comes from the editor, which owns how a socket type is drawn. */
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
    inputs: shape.inputs.map((s) => ({ label: s.label || s.type.label, type: s.type.kind === 'value' ? glslForm(s.type).type : s.type.label, color: s.linkable ? socketColor(s.type) : '' })),
    outputs: shape.outputs.map((s) => ({ label: s.label, color: socketColor(s.type) })),
    note: uniforms.has(item.id) ? 'uniform' : undefined,
  }
}
