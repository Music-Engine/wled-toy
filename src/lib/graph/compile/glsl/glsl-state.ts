// The pixel-scope state layers: the render targets a shader writes its per-pixel state to, and where each slot sits in them.
import type { NodeShape } from '@/lib/graph/define/shape'
import { vectorType, type Value } from '@/lib/graph/define/value'
import type { Program, ProgramState } from '@/lib/graph/compile/front-end/program'

/** Layers the pixel-scope slots reach; a slot never straddles two, so its first float says which one it is in. */
export function stateLayers(program: Program): number {
  const offsets = Object.values(program.state).flatMap((state) => (state.scope === 'pixel' ? Object.values(state.offsets) : []))
  return offsets.reduce((layers, offset) => Math.max(layers, Math.floor(offset / 4) + 1), 0)
}

export function stateTargets(layers: number): string[] {
  if (layers === 0) return []
  return ['uniform highp sampler2DArray iState;', ...Array.from({ length: layers }, (_, i) => `layout(location = ${i + 1}) out vec4 outState${i + 1};`), '']
}

// every layer starts as last frame's, so a slot keeps its value, and padding its float, unless a body assigns it
export function stateLoads(layers: number): string[] {
  return Array.from({ length: layers }, (_, i) => `  outState${i + 1} = texelFetch(iState, ivec3(gl_FragCoord.xy, ${i}), 0);`)
}

/** A pixel-scope slot is its components of `outState<layer + 1>`, which holds last frame's value until the body assigns it. */
export function stateSlots(state: ProgramState | undefined, shape: NodeShape): Record<string, Value> {
  if (state?.scope !== 'pixel') return {}
  return Object.fromEntries(Object.entries(state.offsets).map(([name, offset]) => [name, stateSlot(offset, shape.state![name].dim!)]))
}

function stateSlot(offset: number, dim: number): Value {
  const first = offset % 4
  return { expr: `outState${Math.floor(offset / 4) + 1}.${'xyzw'.slice(first, first + dim)}`, type: vectorType(dim) }
}
