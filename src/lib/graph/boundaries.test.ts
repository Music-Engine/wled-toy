import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const GRAPH = 'src/lib/graph'
const FIXTURES = `${GRAPH}/boundaries.fixtures`
const DEFINE_OUTSIDE = ['@/lib/shader/catalog', '@/lib/engine/output/output', '@/lib/util/json']

// Nodes reach the graph only via authoring; shared helpers live in nodes/shared or nodes/glsl, so categories stay independent
function nodesAllow(file: string, from: string): boolean {
  if (from.startsWith('./')) return true
  if (from.startsWith('.')) return false
  if (!from.startsWith('@/lib/graph')) return true
  if (from === '@/lib/graph/authoring' || from.startsWith('@/lib/graph/nodes/glsl/') || from.startsWith('@/lib/graph/nodes/shared/')) return true
  return file.endsWith('.test.ts') && (from === '@/lib/graph' || from === '@/lib/graph/testing')
}

const defineAllows = (file: string, from: string) => from.startsWith('./') || DEFINE_OUTSIDE.includes(from) || (file.endsWith('.test.ts') && from === 'vitest')

// Outside compile/, only its entry point
const COMPILE_ENTRIES = /(^|\/)compile\/compilers$/

const stageAllows = (file: string, from: string) => file.startsWith('compile/') || !/(^|\/)compile\//.test(from) || COMPILE_ENTRIES.test(from)

const RULES = [
  { rule: 'nodes', covers: (file: string) => file.startsWith('nodes/'), allows: nodesAllow },
  { rule: 'define', covers: (file: string) => file.startsWith('define/'), allows: defineAllows },
  { rule: 'compile stages', covers: () => true, allows: stageAllows },
]

function listImports(root: string): { file: string; from: string }[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.startsWith('boundaries.fixtures/'))
    .flatMap((file) =>
      [...readFileSync(`${root}/${file}`, 'utf8').matchAll(/^(?:import|export)\s+(?:[\w*{}\s,]+?\s+from\s+)?'([^']+)'|\bimport\(\s*'([^']+)'/gm)].map(
        (match) => ({ file, from: match[1] ?? match[2] }),
      ),
    )
}

const listViolations = (root: string) =>
  listImports(root).flatMap(({ file, from }) => RULES.filter((r) => r.covers(file) && !r.allows(file, from)).map((r) => `${r.rule}: ${file} imports ${from}`))

it('graph files import only across the boundaries the module allows', () => {
  expect(listViolations(GRAPH)).toEqual([])
})

it('reports a forbidden import in a node file', () => {
  expect(listViolations(FIXTURES)).toEqual([
    'nodes: nodes/leak.ts imports @/lib/graph/compile/targets/glsl',
    'compile stages: nodes/leak.ts imports @/lib/graph/compile/targets/glsl',
  ])
})
