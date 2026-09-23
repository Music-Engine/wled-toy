import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { allItems } from '@/lib/graph'
import { alone } from '@/lib/graph/testing'
import { buildProgram } from './compile'
import { glsl } from './glsl'

const NODES = 'src/lib/graph/nodes'
// previousFrame is a prelude helper that samples the last frame's texture
const GLSL_ONLY = /\btexture\(|\btexelFetch\(|\bdFdx\(|\bdFdy\(|\bpreviousFrame\(/

/** Each `defineNode('id'` call whose source mentions a GLSL-only construct; a hit outside one is listed by file, so it fails. */
function kindsInSource(): string[] {
  return readdirSync(NODES, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) => readFileSync(`${NODES}/${file}`, 'utf8').split(/(?=defineNode\(')/).map((part) => ({ file, part })))
    .filter(({ part }) => GLSL_ONLY.test(part))
    .map(({ file, part }) => /^defineNode\('(\w+)'/.exec(part)?.[1] ?? `${file} outside a defineNode`)
}

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
  const expected = kindsInSource().sort()
  expect(expected).not.toEqual([])
  expect(kindsMarked().sort()).toEqual(expected)
})
