// Where a pixel consumer reads a per-frame output: a slot in the uniform block, allocated in the order the walk first
// reads each output, or, standalone, the GLSL backend's stand-in for that output or its last value frozen into the code.
import { CONTROL_VECTORS } from '@/lib/shader/glsl'
import type { FrontEnd } from './front-end'
import { planStep } from './frame-plan'
import { standaloneExpr } from './glsl'
import { GraphError, type PixelSource } from './program'

/** Only outputs the shader links to get a slot; undefined when the output carries no number. */
export function perFrameSource(c: FrontEnd, id: string, output: string): PixelSource | undefined {
  const key = `${id}:${output}`
  const known = c.perFrameSources.get(key)
  if (known) return known
  const source = c.standalone ? bakedSource(c, id, output) : uniformSource(c, id, output)
  if (source) c.perFrameSources.set(key, source)
  return source
}

function uniformSource(c: FrontEnd, id: string, output: string): PixelSource | undefined {
  const step = planStep(c, id)
  const dim = c.dims.get(id)![output]
  if (dim === undefined) return undefined
  const last = c.program.uniforms.at(-1)
  const slot = last ? last.slot + last.dim : 0
  if (slot + dim > CONTROL_VECTORS * 4) throw new GraphError('Too many per-frame values reach the shader', id)
  c.program.uniforms.push({ step, output, slot, dim })
  return { uniform: slot, dim }
}

function bakedSource(c: FrontEnd, id: string, output: string): PixelSource | undefined {
  const { node, shape } = c.lookup(id)
  const out = shape.outputs.find((o) => o.name === output)
  if (!out || out.type.kind !== 'value') return undefined
  c.record(id)
  if (standaloneExpr(node.data.kind, output)) return { standalone: id, output }
  c.program.pixel.push({ frozen: id, output, value: c.options.controls?.(id, output) ?? 0 })
  return { frozen: id, output }
}
