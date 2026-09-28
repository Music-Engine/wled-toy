// Where each node's slots live: its declared state in pixel state or global state after its pass, and in global state
// every frame output the pixel pass or the host reads. A node that keeps its id and slot types keeps its offsets from
// the previous table; everything else is handed out in topo order after the last slot kept.
import type { DataType } from '@/lib/graph/define/types'
import { GraphError } from '@/lib/graph/compile/front-end/program'
import type { Annotation, CompileContext, CompiledNode, Pass, Slots } from '@/lib/graph/compile/next/context'
import { linkedOutput, linkedUniform } from '@/lib/graph/compile/next/sockets'

export const state = (): Annotation => ({
  name: 'state',
  reads: ['resources', 'width', 'pass'],
  annotate: (ctx) => {
    const wanted = wantedSlots(ctx)
    ctx.slots = { pixel: allocate(wanted.pixel, ctx.previous.pixel), global: allocate(wanted.global, ctx.previous.global) }
    for (const id of ctx.order) {
      const node = ctx.nodes[id]
      node.state = offsets(ctx.slots[tableName(node.pass!)][id])
      const exported = node.shape.outputs.map((o) => o.name).filter((output) => ctx.slots.global[`${id}:${output}`])
      node.exports = Object.fromEntries(exported.map((output) => [output, ctx.slots.global[`${id}:${output}`][output].offset]))
    }
  },
})

/** A table entry before it has offsets: slot name to type id and component count. */
type Wanted = { key: string; slots: Record<string, { type: string; dim: number }> }

function wantedSlots(ctx: CompileContext): Record<'pixel' | 'global', Wanted[]> {
  const wanted: Record<'pixel' | 'global', Wanted[]> = { pixel: [], global: [] }
  const read = readAcrossPasses(ctx)
  for (const id of ctx.order) {
    const node = ctx.nodes[id]
    const declared = Object.entries(node.shape.state ?? {})
    if (declared.length > 0) wanted[tableName(node.pass!)].push({ key: id, slots: Object.fromEntries(declared.map(([name, type]) => [name, { type: type.id, dim: type.dim! }])) })
    for (const output of exportedOutputs(node, read)) wanted.global.push({ key: `${id}:${output}`, slots: { [output]: exportedSlot(node, output) } })
  }
  return wanted
}

const tableName = (pass: Pass) => (pass === 'pixel' ? 'pixel' : 'global')

/** `id:output` for every frame output a pixel node links to, but those that read a uniform, which either pass reads. */
function readAcrossPasses(ctx: CompileContext): Set<string> {
  const read = new Set<string>()
  for (const node of Object.values(ctx.nodes).filter((n) => n.pass === 'pixel')) {
    for (const socket of node.shape.inputs) {
      const linked = linkedOutput(ctx, node, socket)
      if (linked && ctx.nodes[linked.source.id].pass === 'frame' && !linkedUniform(ctx, linked.source)) read.add(`${linked.source.id}:${linked.source.output}`)
    }
  }
  return read
}

/** The frame outputs written to global state, in declaration order; a probe on a pixel node has no frame value to read back. */
function exportedOutputs(node: CompiledNode, read: Set<string>): string[] {
  const { probe, title } = node.shape
  if (probe && node.pass === 'pixel') throw new GraphError(`${title} is read back once per frame, so it cannot take a value that changes per pixel`, node.id)
  if (node.pass !== 'frame') return []
  return node.shape.outputs.filter((o) => o.name === probe || read.has(`${node.id}:${o.name}`)).map((o) => o.name)
}

/** A generic output is as wide as the node; its type id is the concrete type of that width, so a width change moves it. */
function exportedSlot(node: CompiledNode, output: string): { type: string; dim: number } {
  const { type } = node.shape.outputs.find((o) => o.name === output)!
  if (type.id === 'genType') return { type: ['float', 'vec2', 'vec3', 'vec4'][node.width! - 1], dim: node.width! }
  if (!storable(type)) throw new GraphError(`${node.shape.title} puts out ${type.label} once per frame, which the pixel pass cannot read`, node.id)
  return { type: type.id, dim: type.dim! }
}

// state floats sit four to a layer or texel, so a slot holds a number or a vector
const storable = (type: DataType<any>) => type.kind === 'value' && type.dim !== undefined && type.dim >= 1 && type.dim <= 4

/**
 * Kept entries first fix where the new ones may start; then every entry in `wanted` order takes its kept offsets or
 * the next free floats. A vector that would straddle two layers starts the next one, since a slot is read as one run.
 */
function allocate(wanted: Wanted[], previous: Record<string, Slots>): Record<string, Slots> {
  const kept = new Set(wanted.filter((w) => sameTypes(previous[w.key], w)).map((w) => w.key))
  let next = Math.max(0, ...wanted.filter((w) => kept.has(w.key)).flatMap((w) => Object.entries(previous[w.key]).map(([name, slot]) => slot.offset + w.slots[name].dim)))
  const table: Record<string, Slots> = {}
  for (const w of wanted) {
    if (kept.has(w.key)) {
      table[w.key] = previous[w.key]
      continue
    }
    const slots: Slots = {}
    for (const [name, { type, dim }] of Object.entries(w.slots)) {
      const start = (next % 4) + dim > 4 ? Math.ceil(next / 4) * 4 : next
      slots[name] = { type, offset: start }
      next = start + dim
    }
    table[w.key] = slots
  }
  return table
}

function sameTypes(previous: Slots | undefined, wanted: Wanted): boolean {
  const names = Object.keys(wanted.slots)
  return previous !== undefined && Object.keys(previous).length === names.length && names.every((name) => previous[name]?.type === wanted.slots[name].type)
}

const offsets = (slots: Slots | undefined): Record<string, number> => Object.fromEntries(Object.entries(slots ?? {}).map(([name, slot]) => [name, slot.offset]))
