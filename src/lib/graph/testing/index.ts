import { layoutPositions, type Layout } from '@/lib/engine/output/layout'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import { createGlslCompiler, createUsermodCompiler, type GlslProgram, type GraphIssue, type UsermodProgram } from '@/lib/graph/compile/compilers'
import type { NodeItem } from '@/lib/graph/define/shape'
import { Color } from '@/lib/graph/define/socket-types'
import { canCast } from '@/lib/graph/define/types'
import { GRAPH_NODE_TYPE, GRAPH_VERSION, type NodeGraph, type SocketValue, type StoredEdge, type StoredNode } from '@/lib/graph/model/doc'
import type { UsermodOptions } from './cpp'
import { FPS } from './offline'

/** Usermod unit on a plain strip, frame i at i / FPS: last frame's [r, g, b] per LED, 0 to 255, and the issues. Browser tests only */
export async function renderGraph(doc: NodeGraph, { leds = 8, frames = 1 }: { leds?: number; frames?: number } = {}): Promise<RenderedGraph> {
  const { program, issues } = createUsermodCompiler(leds).compile(doc)
  if (!program) return { program, issues, leds: [] }
  // Imported here: scripts load this module outside a browser
  const { commands } = await import('vitest/browser')
  return { program, issues, leds: (await commands.runUsermod(program.code, { leds, frames })).at(-1)! }
}

interface RenderedGraph {
  program: UsermodProgram | null
  issues: GraphIssue[]
  /** Empty when the graph didn't compile */
  leds: number[][]
}

interface TickOptions {
  leds?: number
  frames?: number
  layout?: Layout | null
  /** Before each tick, e.g. to feed audio */
  beforeTick?: (renderer: ShaderRenderer, program: GlslProgram, time: number) => void
}

/** Runtime over real WebGL2, frame i at i / FPS: per frame, [r, g, b] per LED, 0 to 255; throws when the graph doesn't compile */
export function tickGraph(doc: NodeGraph, { leds = 8, frames = 1, layout = null, beforeTick }: TickOptions = {}): number[][][] {
  const { program, slots, issues } = createGlslCompiler().compile(doc)
  if (!program) throw new Error(issues.map((issue) => issue.message).join('; '))
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  try {
    renderer.setLayout(layout && layoutPositions(layout))
    const runtime = new Runtime(renderer)
    runtime.load(program, slots)
    return Array.from({ length: frames }, (_, frame) => {
      beforeTick?.(renderer, program, frame / FPS)
      const colors = runtime.tick({ time: frame / FPS, dt: 1 / FPS, frame, ledCount: leds, scanY: 0.5 })
      return Array.from({ length: leds }, (_, i) => [...colors.subarray(i * 3, i * 3 + 3)].map(toByte))
    })
  } finally {
    renderer.dispose()
  }
}

export const node = (id: string, kind: string, values: Record<string, SocketValue> = {}): StoredNode => ({
  id,
  type: GRAPH_NODE_TYPE,
  position: { x: 0, y: 0 },
  data: { kind, values },
})

/** `link('uv.x', 'math.a')` */
export function link(from: string, to: string): StoredEdge {
  const [source, sourceHandle] = from.split('.')
  const [target, targetHandle] = to.split('.')
  return { id: `${from}-${to}`, source, sourceHandle, target, targetHandle }
}

export const graph = (nodes: StoredNode[], links: [string, string][] = []): NodeGraph => ({
  version: GRAPH_VERSION,
  nodes,
  edges: links.map(([from, to]) => link(from, to)),
})

/** Kind alone, wired to an Output when its first output draws: how the gate compiles every kind */
export function placeAlone(item: NodeItem): NodeGraph {
  if (item.id === 'output') return graph([node('n', 'output')])
  const out = item.base.outputs[0]
  const drawable = out && canCast(out.type, Color)
  return graph([node('n', item.id), node('o', 'output')], drawable ? [[`n.${out.name}`, 'o.color']] : [])
}

/** LED byte w/o post-processing */
export const toByte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255)

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** First of g++ and c++ on the test server's PATH */
    cppCompiler: () => Promise<string | null>
    runUsermod: (code: string, options: UsermodOptions) => Promise<number[][][]>
  }
}
