import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { allItems } from '@/lib/graph'
import { Sampler2D } from '@/lib/graph/authoring'
import { CATALOG_FUNCTIONS } from '@/lib/graph/nodes/catalog'
import { alone } from '@/lib/graph/testing'
import { buildProgram } from '@/lib/graph/compile/compile'
import { cppUnit } from '@/lib/graph/compile/cpp/cpp-unit'
import { glsl } from './glsl'

const NODES = 'src/lib/graph/nodes'
// prelude helpers that sample a texture: the last frame, the spectrum history, the pitch classes, the raw waveform
const GLSL_ONLY = /\btexture\(|\btexelFetch\(|\bdFdx\(|\bdFdy\(|\bpreviousFrame\(|\bhistoryAt\(|\bchromaAt\(|\bwaveformAt\(/

/** Each `defineNode('id'` call whose source mentions a GLSL-only construct; a hit outside one is listed by file, so it fails. */
function kindsInSource(): string[] {
  return readdirSync(NODES, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) => readFileSync(`${NODES}/${file}`, 'utf8').split(/(?=defineNode\(')/).map((part) => ({ file, part })))
    .filter(({ part }) => GLSL_ONLY.test(part))
    .map(({ file, part }) => /^defineNode\('(\w+)'/.exec(part)?.[1] ?? `${file} outside a defineNode`)
}

// a catalog node's body is the call `name(...)`, so its name is its source
const catalogKinds = () => CATALOG_FUNCTIONS.map((item) => item.id).filter((id) => GLSL_ONLY.test(`${id}(`))

const expectedKinds = () => [...kindsInSource(), ...catalogKinds()].sort()

// standalone runs every node with GLSL in the shader, so every pixel body is invoked
function kindsMarked(): string[] {
  return allItems()
    .filter((item) => {
      const program = buildProgram(alone(item), { standalone: true, controls: () => 0.5 })
      glsl(program)
      return program.nodes.n?.requires?.includes('glsl')
    })
    .map((item) => item.id)
}

it('marks exactly the bodies whose source samples a texture or takes a derivative', () => {
  const expected = expectedKinds()
  expect(expected).not.toEqual([])
  expect(kindsMarked().sort()).toEqual(expected)
})

it('leaves exactly the marked bodies out of the C++ unit', () => {
  expect(cppUnit().excluded.sort()).toEqual(expectedKinds())
})

// a sampler reaches pixels only through a node that samples it, so the sampler uniforms (iAudio, iImage) stay unmarked
it('marks every kind that takes a sampler', () => {
  const sampling = allItems().filter((item) => item.base.inputs.some((socket) => socket.linkable && socket.type === Sampler2D)).map((item) => item.id)
  expect(sampling).not.toEqual([])
  expect(kindsMarked()).toEqual(expect.arrayContaining(sampling))
})

it('writes the same C++ unit every time', () => {
  expect(cppUnit().code).toBe(cppUnit().code)
})
