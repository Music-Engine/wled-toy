// The per-frame side: which nodes run on the CPU, in what order, with which inputs, and how the shader reads their
// results from the uniform block (or, when compiling standalone, as GLSL of their own or a frozen literal).
import { CONTROL_VECTORS } from '@/lib/shader/glsl'
import { fallsBackToImplicit, isLinkable, isStreamSocket, type NodeShape } from '@/lib/graph/define/shape'
import { isGlslType } from '@/lib/graph/define/types'
import { componentCount, floatLiteral, vectorType, vectorLiteral, type Value } from '@/lib/graph/define/value'
import { GraphError, isGenericSocket, type Compilation } from './compilation'
import type { FrameBinding } from './frame'
import { settledInputs } from './streams'

/** Adds the node (and what feeds it) to the CPU plan; returns its step index. */
export function planControl(c: Compilation, id: string): number {
  const planned = c.steps.get(id)
  if (planned !== undefined) return planned
  const { node, shape } = c.lookup(id)
  c.enter(id)

  const inputs: Record<string, FrameBinding> = {}
  const inputDims: Record<string, number> = {}
  for (const [name, constant] of Object.entries(settledInputs(c, id, shape))) inputs[name] = { constant }
  for (const socket of shape.inputs) {
    if (isStreamSocket(socket)) continue
    if (!isLinkable(socket)) {
      inputs[socket.name] = { constant: c.storedValue(id, node.data, socket) }
      continue
    }
    const source = c.linkSource(id, socket)
    if (source) {
      if (c.changesPerPixel.has(source.id)) {
        throw new GraphError(`${socket.label} needs one value per frame, but ${c.lookup(source.id).shape.title} changes per pixel`, id)
      }
      inputs[socket.name] = { step: planControl(c, source.id), output: source.output }
    } else if (fallsBackToImplicit(node.data.values, socket) && socket.default.frame) {
      inputs[socket.name] = { frame: socket.default.frame }
    } else if (fallsBackToImplicit(node.data.values, socket)) {
      throw new GraphError(`${socket.label} needs a value or a link; its default (${socket.default.label}) only exists per pixel`, id)
    } else {
      inputs[socket.name] = { constant: c.storedValue(id, node.data, socket) }
    }
    if (!isGenericSocket(socket)) inputDims[socket.name] = componentCount(socket.type.glsl) ?? 1
  }
  const gen = componentCount(c.widths.get(id)!)!
  for (const socket of shape.inputs.filter(isGenericSocket)) inputDims[socket.name] = gen
  c.dims.set(id, outputDims(shape, gen))

  c.leave(id)
  const index = c.plan.steps.push({ nodeId: id, kind: node.data.kind, run: shape.run!, state: shape.state, inputs, dims: inputDims }) - 1
  c.steps.set(id, index)
  return index
}

/** Components per numeric output; stream outputs are not numbers and never reach the uniform block. */
function outputDims(shape: NodeShape, gen: number): Record<string, number> {
  const dims: Record<string, number> = {}
  for (const out of shape.outputs) {
    if (!isGlslType(out.type)) continue
    dims[out.name] = out.type.glsl === 'genType' ? gen : componentCount(out.type.glsl) ?? 1
  }
  return dims
}

/**
 * One output of a per-frame node as the shader sees it: a read from the uniform block, or, standalone, the node's own
 * GLSL for that output or its last value frozen into a literal. Only outputs the shader links to get a slot.
 */
export function controlOutput(c: Compilation, id: string, output: string): Value | undefined {
  const key = `${id}:${output}`
  const known = c.exported.get(key)
  if (known) return known
  const value = c.standalone ? bakedOutput(c, id, output) : exportedOutput(c, id, output)
  if (value) c.exported.set(key, value)
  return value
}

function exportedOutput(c: Compilation, id: string, output: string): Value | undefined {
  const step = planControl(c, id)
  const dim = c.dims.get(id)![output]
  if (dim === undefined) return undefined
  if (c.nextSlot + dim > CONTROL_VECTORS * 4) throw new GraphError('Too many control values reach the shader', id)
  const slot = c.nextSlot
  c.nextSlot += dim
  c.plan.exports.push({ step, output, slot, dim })
  const reads = Array.from({ length: dim }, (_, i) => `iControl[${Math.floor((slot + i) / 4)}].${'xyzw'[(slot + i) % 4]}`)
  return { expr: dim === 1 ? reads[0] : `${vectorType(dim)}(${reads.join(', ')})`, type: vectorType(dim) }
}

function bakedOutput(c: Compilation, id: string, output: string): Value | undefined {
  const { shape } = c.lookup(id)
  const out = shape.outputs.find((o) => o.name === output)
  if (!out || !isGlslType(out.type)) return undefined
  const glsl = shape.standalone[output]
  if (glsl) return { expr: glsl, type: out.type.glsl === 'genType' ? 'float' : out.type.glsl }
  const value = c.options.controls?.(id, output) ?? 0
  const baked = Array.isArray(value) ? vectorLiteral(value) : floatLiteral(value)
  c.emit(id, `// ${shape.title} "${out.label}" runs per frame; frozen at ${baked.expr} when this code was taken`)
  c.frozen.push({ nodeId: id, title: shape.title, output: out.label, value: baked.expr })
  return baked
}
