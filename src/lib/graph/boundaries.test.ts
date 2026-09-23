import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const GRAPH = 'src/lib/graph'
const FIXTURES = `${GRAPH}/boundaries.fixtures`
const DEFINE_OUTSIDE = ['@/lib/shader/glsl', '@/lib/audio/dsp', '@/lib/engine/midi', '@/lib/engine/output']

// midi-osc reads FrameBinding until program/pure-resolve-7 moves it out of compile/
const ALLOWED = ['nodes: nodes/control/midi-osc.ts imports @/lib/graph/compile/frame']

function nodesAllow(file: string, from: string): boolean {
  if (from.startsWith('./')) return true
  if (from.startsWith('.')) return false
  if (!from.startsWith('@/lib/graph')) return true
  if (from === '@/lib/graph/authoring' || from.startsWith('@/lib/graph/nodes/glsl/')) return true
  return file.endsWith('.test.ts') && (from === '@/lib/graph' || from === '@/lib/graph/testing')
}

const defineAllows = (file: string, from: string) =>
  from.startsWith('./') || DEFINE_OUTSIDE.includes(from) || (file.endsWith('.test.ts') && from === 'vitest')

const stageAllows = (file: string, from: string) =>
  file.startsWith('compile/') || !/(^|\/)compile\/(compilation|streams|control-plan|emit|width)$/.test(from)

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
  expect(violations(GRAPH)).toEqual(ALLOWED)
  expect(ALLOWED).toHaveLength(1)
})

it('reports a forbidden import in a node file', () => {
  expect(violations(FIXTURES)).toEqual([
    'nodes: nodes/leak.ts imports @/lib/graph/compile/emit',
    'compile stages: nodes/leak.ts imports @/lib/graph/compile/emit',
  ])
})
