import { categoryById, type CategoryId } from '@/lib/shader/glsl'
import { directory, leaf, separator, type MenuDirectory, type MenuEntry, type MenuFs, type MenuItem, type MenuPreset } from '@/lib/shader/menu-fs'
import { CATALOG_FUNCTIONS, CATALOG_UNIFORMS } from '@/lib/graph/nodes/catalog'
import type { NodeItem } from '@/lib/graph/define/shape'
import * as nodes from '@/lib/graph/nodes'
import { MATH_OP_OPTIONS } from '@/lib/graph/nodes/converter/math'
import { VECTOR_OP_OPTIONS } from '@/lib/graph/nodes/converter/vector-math'
import { isGlslType, type LinkType } from '@/lib/graph/define/types'

/** A directory themed after a category: the graph's own nodes first, then the injected GLSL functions of that category. */
function categoryDirectory(id: CategoryId, own: NodeItem[] = [], extra: MenuItem<NodeItem>[] = []): MenuDirectory<NodeItem> {
  const category = categoryById.get(id)!
  const rest = [...CATALOG_FUNCTIONS.filter((item) => item.category === id).map((n) => leaf(n)), ...extra]
  const items = own.length && rest.length ? [...own.map((n) => leaf(n)), separator, ...rest] : [...own.map((n) => leaf(n)), ...rest]
  return directory(category.label, items, { icon: category.icon, color: category.color })
}

export const GRAPH_FS: MenuFs<NodeItem> = {
  title: 'Add',
  items: [
    categoryDirectory('input', [nodes.uvNode, nodes.ledLayoutNode, nodes.timeNode, nodes.valueNode, nodes.vector2Node, nodes.colorNode, nodes.knobNode, nodes.midiInNode, nodes.oscInNode, nodes.sceneSwitchNode], [
      directory('Uniforms', CATALOG_UNIFORMS.map((n) => leaf(n)), { description: 'Values the engine updates every frame.' }),
    ]),
    categoryDirectory('output', [nodes.outputNode], [
      directory('Feedback', [nodes.trailsNode, nodes.stripBlurNode, nodes.previousFrameNode].map((n) => leaf(n)), { description: 'Nodes that read what the Output showed on the previous frame.' }),
    ]),
    categoryDirectory('noise', [
      nodes.noiseTextureNode, nodes.whiteNoiseNode, nodes.voronoiNode, nodes.waveTextureNode, nodes.magicTextureNode, nodes.gradientTextureNode, nodes.checkerTextureNode, nodes.brickTextureNode,
    ]),
    categoryDirectory('image', [nodes.imageTextureNode]),
    categoryDirectory('color', [
      nodes.colorMixNode, nodes.layerMixNode, nodes.maskNode, nodes.colorRampNode, nodes.paletteNode, nodes.hueSaturationNode, nodes.brightnessCeilingNode, nodes.brightnessContrastNode, nodes.gammaNode, nodes.invertNode, nodes.hsvToRgbNode, nodes.rgbToHsvNode,
    ]),
    categoryDirectory('converter', [nodes.mathNode, nodes.vectorMathNode, nodes.mixNode, nodes.clampNode, nodes.mapRangeNode, nodes.curveNode, nodes.randomNode, nodes.combineXyzNode, nodes.separateXyzNode, nodes.separateColorNode, nodes.combineColorNode], [
      // every operation is its own entry, so "sine" or "ping-pong" finds Math set to it
      directory('Math Operations', [...new Set(MATH_OP_OPTIONS.map((o) => o.group))].map((group) =>
        directory(group, MATH_OP_OPTIONS.filter((o) => o.group === group).map((o) => leaf(nodes.mathNode, { title: o.label, values: { op: o.value } })))),
      ),
      directory('Vector Math Operations', VECTOR_OP_OPTIONS.map((o) => leaf(nodes.vectorMathNode, { title: o.label, values: { op: o.value } }))),
    ]),
    categoryDirectory('signal', [nodes.waveNode, nodes.integratorNode, nodes.viewerNode], [
      directory('Smoothing', [nodes.envelopeFollowerNode, nodes.peakHoldNode, nodes.slewLimiterNode].map((n) => leaf(n))),
      directory('Triggers', [nodes.schmittTriggerNode, nodes.envelopeNode, nodes.sampleHoldNode, nodes.counterNode, nodes.toggleNode, nodes.clockDividerNode, nodes.stepSequencerNode].map((n) => leaf(n))),
    ]),
    categoryDirectory('math', [nodes.mappingNode, nodes.polarNode, nodes.mirrorNode, nodes.tileNode, nodes.rotateNode, nodes.segmentSplitNode, nodes.rangeSelectNode, nodes.fromCenterNode]),
    categoryDirectory('strip'),
    categoryDirectory('animation'),
    categoryDirectory('audio', [nodes.audioSourceNode, nodes.fftNode, nodes.audioNode, nodes.audioSignalNode, nodes.bandsNode, nodes.bandSplitNode, nodes.spectrumNode, nodes.waveformNode, nodes.chromaNode]),
    categoryDirectory('builtin'),
  ],
}

const uniforms = new Set(CATALOG_UNIFORMS)

export function describeNodeItem(item: NodeItem, preset?: MenuPreset): MenuEntry {
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
    inputs: shape.inputs.map((s) => ({ label: s.label || s.type.label, type: isGlslType(s.type) ? s.type.glsl : s.type.label, color: s.connectable ? (s.type as LinkType).color : '' })),
    outputs: shape.outputs.map((s) => ({ label: s.label, color: s.type.color })),
    note: uniforms.has(item) ? 'uniform' : undefined,
  }
}
