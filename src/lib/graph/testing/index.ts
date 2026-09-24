import { layoutPositions, type Layout } from '@/lib/engine/layout'
import { ShaderRenderer } from '@/lib/engine/renderer'
import { generateGlsl, type GeneratedShader } from '@/lib/graph/compile/compile'
import { FrameRunner } from '@/lib/graph/compile/frame'
export { initialState } from '@/lib/graph/compile/frame'
import type { NodeItem } from '@/lib/graph/define/shape'
import { Color } from '@/lib/graph/define/socket-types'
import { canCast } from '@/lib/graph/define/types'
import { GRAPH_NODE_TYPE, GRAPH_VERSION, type NodeGraph, type SocketValue, type StoredEdge, type StoredNode } from '@/lib/graph/model/doc'

export const node = (id: string, kind: string, values: Record<string, SocketValue> = {}): StoredNode =>
  ({ id, type: GRAPH_NODE_TYPE, position: { x: 0, y: 0 }, data: { kind, values } })

/** `link('uv.x', 'math.a')` */
export function link(from: string, to: string): StoredEdge {
  const [source, sourceHandle] = from.split('.')
  const [target, targetHandle] = to.split('.')
  return { id: `${from}-${to}`, source, sourceHandle, target, targetHandle }
}

export const graph = (nodes: StoredNode[], links: [string, string][] = []): NodeGraph =>
  ({ version: GRAPH_VERSION, nodes, edges: links.map(([from, to]) => link(from, to)) })

/** A node of one kind on its own, wired to an Output when its first output can be drawn: how the gate compiles every kind. */
export function alone(item: NodeItem): NodeGraph {
  if (item.id === 'output') return graph([node('n', 'output')])
  const out = item.base.outputs[0]
  const drawable = out && canCast(out.type, Color)
  return graph([node('n', item.id), node('o', 'output')], drawable ? [[`n.${out.name}`, 'o.color']] : [])
}

/** A 0..1 channel as the byte an LED would get with no post-processing. */
export const toByte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255)

interface RenderedGraph {
  shader: GeneratedShader
  /** GLSL info log when the generated code did not compile. */
  compileError: string | null
  /** One [r, g, b] per LED, 0 to 255. */
  leds: number[][]
}

/** Compiles a graph through a real WebGL2 context and renders one LED frame. Browser tests only. */
export function renderGraph(doc: NodeGraph, { leds = 8, time = 0, frame = 0, scanY = 0.5, dt = 1 / 30, layout = null as Layout | null } = {}): RenderedGraph {
  const shader = generateGlsl(doc)
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  try {
    renderer.compile(shader.code)
  } catch (e) {
    return { shader, compileError: (e as Error).message, leds: [] }
  }
  renderer.setLayout(layout && layoutPositions(layout))
  const runner = new FrameRunner()
  runner.load(shader.frame)
  renderer.setControls(runner.step({ time, dt, frameIndex: frame, audio: undefined, midi: undefined, osc: undefined }))
  const colors = renderer.renderLeds({ time, frame, ledCount: leds, scanY })
  renderer.dispose()
  return { shader, compileError: null, leds: Array.from({ length: leds }, (_, i) => [...colors.subarray(i * 3, i * 3 + 3)].map(toByte)) }
}
