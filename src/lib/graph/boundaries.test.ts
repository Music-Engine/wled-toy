import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const GRAPH = 'src/lib/graph'
const FIXTURES = `${GRAPH}/boundaries.fixtures`
const DEFINE_OUTSIDE = ['@/lib/shader/glsl', '@/lib/audio/dsp', '@/lib/engine/midi', '@/lib/engine/output']

// a node reaches the graph only through authoring; a helper two categories need lives in nodes/shared (or nodes/glsl for
// GLSL chunks) rather than being imported from one of them, so categories stay independent of each other
function nodesAllow(file: string, from: string): boolean {
  if (from.startsWith('./')) return true
  if (from.startsWith('.')) return false
  if (!from.startsWith('@/lib/graph')) return true
  if (from === '@/lib/graph/authoring' || from.startsWith('@/lib/graph/nodes/glsl/') || from.startsWith('@/lib/graph/nodes/shared/')) return true
  return file.endsWith('.test.ts') && (from === '@/lib/graph' || from === '@/lib/graph/testing')
}

const defineAllows = (file: string, from: string) =>
  from.startsWith('./') || DEFINE_OUTSIDE.includes(from) || (file.endsWith('.test.ts') && from === 'vitest')

const stageAllows = (file: string, from: string) =>
  file.startsWith('compile/') || !/(^|\/)compile\/(program|front-end|streams|placement|width|frame-plan|pixel-plan|uniforms|glsl|js|cpp)$/.test(from)

const RULES = [
  { rule: 'nodes', covers: (file: string) => file.startsWith('nodes/'), allows: nodesAllow },
  { rule: 'define', covers: (file: string) => file.startsWith('define/'), allows: defineAllows },
  { rule: 'compile stages', covers: () => true, allows: stageAllows },
]

function importsUnder(root: string): { file: string; from: string }[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.startsWith('boundaries.fixtures/'))
    .flatMap((file) =>
      [...readFileSync(`${root}/${file}`, 'utf8').matchAll(/^(?:import|export)\s+(?:[\w*{}\s,]+?\s+from\s+)?'([^']+)'|\bimport\(\s*'([^']+)'/gm)]
        .map((match) => ({ file, from: match[1] ?? match[2] })),
    )
}

const violations = (root: string) =>
  importsUnder(root).flatMap(({ file, from }) =>
    RULES.filter((r) => r.covers(file) && !r.allows(file, from)).map((r) => `${r.rule}: ${file} imports ${from}`),
  )

it('graph files import only across the boundaries the module allows', () => {
  expect(violations(GRAPH)).toEqual([])
})

it('reports a forbidden import in a node file', () => {
  expect(violations(FIXTURES)).toEqual([
    'nodes: nodes/leak.ts imports @/lib/graph/compile/glsl',
    'compile stages: nodes/leak.ts imports @/lib/graph/compile/glsl',
  ])
})
