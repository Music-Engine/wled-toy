// Prints what each front-end pass settles for one graph in graphs/, the Program's pixel entries, frame steps,
// uniforms and state, and what cpp() says in both modes. Run from the repo root: node scripts/graph-pass-dump.ts high-contrast-music
import { readFileSync } from 'node:fs'
import { runnerImport } from 'vite'

const root = `${process.cwd()}/`
const load = async (path: string) =>
  (await runnerImport(path, { configFile: false, root, resolve: { alias: { '@': `${root}src` } }, logLevel: 'warn' })).module as any

const name = process.argv[2] ?? 'high-contrast-music'
const { readGraphFile } = await load('/src/lib/graph/model/file.ts')
const { FrontEnd } = await load('/src/lib/graph/compile/front-end/front-end.ts')
const { placeNodes } = await load('/src/lib/graph/compile/front-end/placement.ts')
const { inferWidths } = await load('/src/lib/graph/compile/front-end/width.ts')
const { buildProgram } = await load('/src/lib/graph/compile/compile.ts')
const { cpp } = await load('/src/lib/graph/compile/cpp/cpp.ts')
const { nodeItem } = await load('/src/lib/graph/registry.ts')

const { doc } = readGraphFile(readFileSync(`${root}graphs/${name}.wledgraph`, 'utf8'))
const c = new FrontEnd(doc, {})
const sinks = doc.nodes.filter((n: any) => nodeItem(n.data.kind)?.base.isOutput).map((n: any) => n.id)
placeNodes(c, sinks)
console.log('sinks', sinks)
console.log('placement', Object.fromEntries(c.placement))
console.log('changesPerPixel', [...c.changesPerPixel])
inferWidths(c, sinks)
console.log('widths', Object.fromEntries(c.widths))

const program = buildProgram(doc, {})
console.log('pixel entries')
for (const entry of program.pixel) console.log(' ', JSON.stringify(entry))
console.log('frame steps', program.frame.map((s: any) => s.nodeId))
console.log('uniforms', JSON.stringify(program.uniforms))
console.log('state', JSON.stringify(program.state))
console.log('resources', JSON.stringify(program.resources))
console.log('json round trip equal', JSON.stringify(JSON.parse(JSON.stringify(program))) === JSON.stringify(program))
for (const standalone of [false, true]) {
  try {
    cpp(buildProgram(doc, standalone ? { standalone: true, controls: () => 0.5 } : {}), { leds: 60 })
    console.log(`cpp standalone=${standalone}: accepted`)
  } catch (e: any) {
    console.log(`cpp standalone=${standalone}: ${e.message} (node ${e.nodeId})`)
  }
}
