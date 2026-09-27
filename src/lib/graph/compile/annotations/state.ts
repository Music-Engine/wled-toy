import { keepsInShader } from '@/lib/graph/define/define'
import { vectorType } from '@/lib/graph/define/value'
import type { Annotation, CompileContext, CompiledNode, Pass, Slots } from '@/lib/graph/compile/context'
import { findLinkedOutput, findLinkedUniform } from '@/lib/graph/compile/sockets'

/** Kept entries keep prev offsets; the rest go out in topo order, freed floats first */
export const allocateState = (): Annotation => ({
  name: 'state',
  reads: ['resources', 'width', 'pass'],
  annotate: (ctx) => {
    const wanted = collectWantedSlots(ctx)
    ctx.slots = { pixel: allocateTable(wanted.pixel, ctx.previous.pixel), global: allocateTable(wanted.global, ctx.previous.global) }
    for (const id of ctx.order) {
      const node = ctx.nodes[id]
      node.state = toOffsets(ctx.slots[toTableName(node.pass!)][id])
      const exported = node.shape.outputs.map((output) => output.name).filter((output) => ctx.slots.global[`${id}:${output}`])
      node.exports = Object.fromEntries(exported.map((output) => [output, ctx.slots.global[`${id}:${output}`][output].offset]))
    }
  },
})

/** Table entry before offsets */
type Wanted = { key: string; kind: string; slots: Record<string, { type: string; dim: number }> }

function collectWantedSlots(ctx: CompileContext): Record<'pixel' | 'global', Wanted[]> {
  const wanted: Record<'pixel' | 'global', Wanted[]> = { pixel: [], global: [] }
  const read = collectCrossPassReads(ctx)
  for (const id of ctx.order) {
    const node = ctx.nodes[id]
    const declared = Object.entries(node.shape.state ?? {})
    if (declared.length > 0) wanted[toTableName(node.pass!)].push({ key: id, kind: node.kind, slots: Object.fromEntries(declared.map(([name, type]) => [name, { type: type.id, dim: type.dim! }])) })
    for (const output of listExportedOutputs(node, read)) wanted.global.push({ key: `${id}:${output}`, kind: node.kind, slots: { [output]: toExportedSlot(node, output) } })
  }
  return wanted
}

/** `id:output` of every frame output a pixel node links to, bar uniforms, which either pass reads */
export function collectCrossPassReads(ctx: CompileContext): Set<string> {
  const read = new Set<string>()
  for (const node of Object.values(ctx.nodes).filter((node) => node.pass === 'pixel')) {
    for (const socket of node.shape.inputs) {
      const linked = findLinkedOutput(ctx, node, socket)
      if (linked && ctx.nodes[linked.source.id].pass === 'frame' && !findLinkedUniform(ctx, linked.source)) read.add(`${linked.source.id}:${linked.source.output}`)
    }
  }
  return read
}

/** Frame outputs a slot can hold; `checkExportableOutputs` reports the rest */
const listExportedOutputs = (node: CompiledNode, read: Set<string>) => listReadBack(node, read).filter((output) => isExportable(node, output))

/** Frame outputs the pixel pass or host reads */
export function listReadBack(node: CompiledNode, read: Set<string>): string[] {
  if (node.pass !== 'frame') return []
  return node.shape.outputs.filter((output) => output.name === node.shape.probe || read.has(`${node.id}:${output.name}`)).map((output) => output.name)
}

/** Generic output as wide as its node */
function toExportedSlot(node: CompiledNode, output: string): { type: string; dim: number } {
  const { type } = node.shape.outputs.find((socket) => socket.name === output)!
  return type.id === 'genType' ? { type: vectorType(node.width!), dim: node.width! } : { type: type.id, dim: type.dim! }
}

export function isExportable(node: CompiledNode, output: string): boolean {
  const { type } = node.shape.outputs.find((socket) => socket.name === output)!
  return type.id === 'genType' || keepsInShader(type)
}

/**
 * Unkept entries take first free floats below prev table's reach (runtime cleared them on load), else next floats
 * after both; a vector never straddles layers since a slot is read as one run
 */
function allocateTable(wanted: Wanted[], previous: Record<string, Slots>): Record<string, Slots> {
  const kept = new Set(wanted.filter((entry) => hasSameSlots(previous[entry.key], entry)).map((entry) => entry.key))
  const taken = new Set(wanted.filter((entry) => kept.has(entry.key)).flatMap((entry) => Object.values(previous[entry.key]).flatMap((slot) => listFloats(slot.offset, slot.dim))))
  const reach = 4 * Math.max(0, ...Object.values(previous).flatMap((slots) => Object.values(slots).map((slot) => Math.floor(slot.offset / 4) + 1)))
  const cursor = { next: Math.max(reach, ...[...taken].map((float) => float + 1)) }
  const table: Record<string, Slots> = {}
  for (const entry of wanted) table[entry.key] = kept.has(entry.key) ? previous[entry.key] : placeSlots(entry, reach, taken, cursor)
  return table
}

function placeSlots(wanted: Wanted, reach: number, taken: Set<number>, cursor: { next: number }): Slots {
  const slots: Slots = {}
  for (const [name, { type, dim }] of Object.entries(wanted.slots)) {
    let start = findFreeStart(reach, dim, taken)
    if (start === undefined) {
      start = (cursor.next % 4) + dim > 4 ? Math.ceil(cursor.next / 4) * 4 : cursor.next
      cursor.next = start + dim
    }
    listFloats(start, dim).forEach((float) => taken.add(float))
    slots[name] = { type, dim, offset: start, kind: wanted.kind }
  }
  return slots
}

const listFloats = (offset: number, dim: number) => Array.from({ length: dim }, (_, i) => offset + i)

/** First free run of `dim` floats below `reach` within one layer */
function findFreeStart(reach: number, dim: number, taken: Set<number>): number | undefined {
  for (let start = 0; start + dim <= reach; start++) {
    if ((start % 4) + dim <= 4 && listFloats(start, dim).every((float) => !taken.has(float))) return start
  }
  return undefined
}

/** Same kind, slot names and types only: another kind reads the floats differently */
function hasSameSlots(previous: Slots | undefined, wanted: Wanted): boolean {
  const names = Object.keys(wanted.slots)
  return previous !== undefined && Object.keys(previous).length === names.length
    && names.every((name) => previous[name]?.type === wanted.slots[name].type && previous[name].kind === wanted.kind)
}

const toOffsets = (slots: Slots | undefined): Record<string, number> => Object.fromEntries(Object.entries(slots ?? {}).map(([name, slot]) => [name, slot.offset]))

const toTableName = (pass: Pass) => (pass === 'pixel' ? 'pixel' : 'global')
