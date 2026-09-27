// Lists the kinds whose alone-graph still plans frame steps when compiled standalone. Run from the repo root.
import { runnerImport } from 'vite'

const root = `${process.cwd()}/`
const load = async (path: string) =>
  (await runnerImport(path, { configFile: false, root, resolve: { alias: { '@': `${root}src` } }, logLevel: 'warn' })).module as any
const { allItems } = await load('/src/lib/graph/registry.ts')
const { alone } = await load('/src/lib/graph/testing/index.ts')
const { buildProgram } = await load('/src/lib/graph/compile/compile.ts')
for (const item of allItems()) {
  const program = buildProgram(alone(item), { standalone: true, controls: () => 0.5 })
  if (program.frame.length) console.log(item.id, program.frame.map((step: any) => step.nodeId))
}
