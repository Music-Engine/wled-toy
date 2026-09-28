import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { CATEGORIES } from '@/lib/shader/catalog'
import type { NodeItem, NodeShape, Socket } from './define/shape'
import { listItems } from './registry'
import { isImplicit, type EnumOption } from './define/types'

const FILE = 'graphs/AUTHORING.md'
const MARKER = '<!-- generated: node reference. Everything below is rewritten by src/lib/graph/node-reference.test.ts -->'

it.runIf(process.env.GRAPH_REFERENCE === '1')('writes the node reference into the authoring guide', () => {
  const head = existsSync(FILE) ? readFileSync(FILE, 'utf8').split(MARKER)[0] : ''
  writeFileSync(FILE, `${head}${MARKER}\n\n${writeReference()}`)
})

it('registers every node kind and catalog item', () => {
  expect(listItems()).toHaveLength(91)
})

it('gives every socket type one of the three kinds', () => {
  for (const item of listItems()) {
    for (const socket of [...item.base.inputs, ...item.base.outputs]) {
      expect(['value', 'param', 'stream'], `${item.id}.${socket.name}`).toContain(socket.type.kind)
    }
  }
})

function writeReference(): string {
  const lines = ['## Node reference', '', 'Generated from the registry (`listItems()` in `src/lib/graph/registry.ts`). The heading is the `data.kind` to write. Socket names are the handles edges use and the keys of `data.values`.', '']
  for (const category of CATEGORIES) {
    const items = listItems().filter((item) => item.category === category.id)
    if (!items.length) continue
    lines.push(`### Category: ${category.label}`, '')
    for (const item of items) {
      lines.push(`#### \`${item.id}\` (${item.title})`, '', `${item.description}`, '', `  - runs: ${describePass(item.base)}${item.base.isOutput ? '; a sink, compiled even when nothing reads it' : ''}`)
      lines.push(...item.base.inputs.map((socket) => describeInput(socket, {})))
      lines.push(...item.base.outputs.map((out) => `  - out \`${out.name}\`${out.label.toLowerCase() !== out.name.toLowerCase() ? ` "${out.label}"` : ''}: ${out.type.label}`))
      lines.push(...listVariants(item), '')
    }
  }
  return lines.join('\n')
}

function describePass(shape: NodeShape): string {
  if (!shape.body) return 'no code of its own: settled while compiling (streams, or uniforms the host writes)'
  const pass = shape.varies === 'pixel' ? 'per pixel' : 'per frame or per pixel, as its inputs decide'
  return `${pass}${shape.state ? ', stateful' : ''}${shape.probe ? `, \`${shape.probe}\` read back by the host` : ''}`
}

function describeInput(socket: Socket, values: Record<string, unknown>): string {
  const props = typeof socket.props === 'function' ? socket.props(values) : socket.props
  const range = ['min', 'max', 'step'].filter((key) => typeof props[key] === 'number').map((key) => `${key} ${props[key]}`).join(', ')
  const fallback = isImplicit(socket.default) ? `unlinked it reads \`${socket.default.label}\`` : `default \`${JSON.stringify(socket.default)}\``
  const kind = socket.type.id === 'enum' ? `one of ${listEnumValues(socket).map((value) => `\`${value}\``).join(' ')}` : socket.type.label
  return `  - in \`${socket.name}\`${socket.label && socket.label.toLowerCase() !== socket.name.toLowerCase() ? ` "${socket.label}"` : ''}: ${kind}, ${socket.linkable ? 'linkable' : 'stored only'}, ${fallback}${range ? `, ${range}` : ''}`
}

/** Options that give the node other sockets than its defaults, grouped by those sockets */
function listVariants(item: NodeItem): string[] {
  return item.base.inputs.filter((socket) => socket.type.id === 'enum').flatMap((socket) => {
    const groups = new Map<string, string[]>()
    for (const value of listEnumValues(socket)) {
      const key = listSockets(item.shape({ [socket.name]: value }), item.base)
      groups.set(key, [...(groups.get(key) ?? []), value])
    }
    if (groups.size < 2) return []
    return [`  - sockets by \`${socket.name}\`:`, ...[...groups].map(([key, values]) => `    - ${values.map((value) => `\`${value}\``).join(' ')}: ${key}`)]
  })
}

const listSockets = (shape: NodeShape, base: NodeShape) => `${shape.inputs.filter((socket) => socket.linkable || !base.inputs.some((known) => known.name === socket.name)).map((socket) => `${socket.name}${socket.label ? ` "${socket.label}"` : ''}${isImplicit(socket.default) ? '' : `=${JSON.stringify(socket.default)}`}`).join(', ')} -> ${shape.outputs.map((output) => output.name).join(', ')}`

const listEnumValues = (socket: Socket) => ((socket.type.props?.options ?? []) as EnumOption[]).map((option) => option.value)
