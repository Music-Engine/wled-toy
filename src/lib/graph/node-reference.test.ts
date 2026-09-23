import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { CATEGORIES } from '@/lib/shader/glsl'
import { placement, type NodeItem, type NodeShape, type Socket } from './define/shape'
import { allItems } from './registry'
import { isImplicit, type EnumOption } from './define/types'

const FILE = 'graphs/AUTHORING.md'
const MARKER = '<!-- generated: node reference. Everything below is rewritten by src/lib/graph/node-reference.test.ts -->'

const optionsOf = (socket: Socket) => ((socket.type.props?.options ?? []) as EnumOption[]).map((o) => o.value)

function inputLine(socket: Socket, values: Record<string, unknown>): string {
  const props = typeof socket.props === 'function' ? socket.props(values) : socket.props
  const range = ['min', 'max', 'step'].filter((key) => typeof props[key] === 'number').map((key) => `${key} ${props[key]}`).join(', ')
  const fallback = isImplicit(socket.default) ? `unlinked it reads \`${socket.default.label}\`` : `default \`${JSON.stringify(socket.default)}\``
  const kind = socket.type.id === 'enum' ? `one of ${optionsOf(socket).map((v) => `\`${v}\``).join(' ')}` : socket.type.label
  return `  - in \`${socket.name}\`${socket.label && socket.label.toLowerCase() !== socket.name.toLowerCase() ? ` "${socket.label}"` : ''}: ${kind}, ${socket.linkable ? 'linkable' : 'stored only'}, ${fallback}${range ? `, ${range}` : ''}`
}

const rate = (shape: NodeShape) => (!shape.exec && !shape.run ? 'settled while compiling (streams only)'
  : { pixel: 'GLSL per pixel (exec)', frame: `control-rate, CPU once per frame (run)${shape.state ? ', stateful' : ''}`, either: 'either: CPU per frame when something is linked in and every link is per frame, else GLSL per pixel (exec + run)' }[placement(shape)])

const sockets = (shape: NodeShape, base: NodeShape) => `${shape.inputs.filter((s) => s.linkable || !base.inputs.some((known) => known.name === s.name)).map((s) => `${s.name}${s.label ? ` "${s.label}"` : ''}${isImplicit(s.default) ? '' : `=${JSON.stringify(s.default)}`}`).join(', ')} -> ${shape.outputs.map((s) => s.name).join(', ')}`

/** Options of each stored Option input that give the node other sockets than its defaults do, grouped by the sockets they give. */
function variants(item: NodeItem): string[] {
  return item.base.inputs.filter((socket) => socket.type.id === 'enum').flatMap((socket) => {
    const groups = new Map<string, string[]>()
    for (const value of optionsOf(socket)) {
      const key = sockets(item.shape({ [socket.name]: value }), item.base)
      groups.set(key, [...(groups.get(key) ?? []), value])
    }
    if (groups.size < 2) return []
    return [`  - sockets by \`${socket.name}\`:`, ...[...groups].map(([key, values]) => `    - ${values.map((v) => `\`${v}\``).join(' ')}: ${key}`)]
  })
}

function reference(): string {
  const lines = ['## Node reference', '', 'Generated from the registry (`allItems()` in `src/lib/graph/registry.ts`). The heading is the `data.kind` to write. Socket names are the handles edges use and the keys of `data.values`.', '']
  for (const category of CATEGORIES) {
    const items = allItems().filter((item) => item.category === category.id)
    if (!items.length) continue
    lines.push(`### Category: ${category.label}`, '')
    for (const item of items) {
      lines.push(`#### \`${item.id}\` (${item.title})`, '', `${item.description}`, '', `  - runs: ${rate(item.base)}${item.base.isOutput ? '; a sink, compiled even when nothing reads it' : ''}`)
      lines.push(...item.base.inputs.map((socket) => inputLine(socket, {})))
      lines.push(...item.base.outputs.map((out) => `  - out \`${out.name}\`${out.label.toLowerCase() !== out.name.toLowerCase() ? ` "${out.label}"` : ''}: ${out.type.label}`))
      lines.push(...variants(item), '')
    }
  }
  return lines.join('\n')
}

it.runIf(process.env.GRAPH_REFERENCE === '1')('writes the node reference into the authoring guide', () => {
  const head = existsSync(FILE) ? readFileSync(FILE, 'utf8').split(MARKER)[0] : ''
  writeFileSync(FILE, `${head}${MARKER}\n\n${reference()}`)
})

it('registers every node kind and catalog item', () => {
  expect(allItems()).toHaveLength(91)
})

it('gives every socket type one of the three kinds', () => {
  for (const item of allItems()) {
    for (const socket of [...item.base.inputs, ...item.base.outputs]) {
      expect(['value', 'param', 'stream'], `${item.id}.${socket.name}`).toContain(socket.type.kind)
    }
  }
})
