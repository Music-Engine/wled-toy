import { layoutPositions, type Layout } from '@/lib/engine/layout'
import { ShaderRenderer } from '@/lib/engine/renderer'
import { generateGlsl, type GeneratedShader } from '@/lib/graph/compile/compile'
import { FrameRunner } from '@/lib/graph/compile/frame'
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

/** A 0..1 channel as the byte an LED would get with no post-processing. */
export const toByte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255)

export interface RenderedGraph {
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
  runner.load(shader.control)
  renderer.setControls(runner.step({ time, dt, frameIndex: frame }))
  const colors = renderer.renderLeds({ time, frame, ledCount: leds, scanY })
  renderer.dispose()
  return { shader, compileError: null, leds: Array.from({ length: leds }, (_, i) => [...colors.subarray(i * 3, i * 3 + 3)].map(toByte)) }
}
