// Writes cpp/generated/nodes.cpp, every node kind as C++, and prints the kinds left out as GLSL-only. Safe to run twice.
// Run with `node scripts/gen-cpp-unit.ts`; Vite's module runner resolves the `@/` imports the graph module uses.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const root = new URL('../', import.meta.url)
const { module } = await runnerImport<{ cppUnit: () => { code: string; excluded: string[] } }>('/src/lib/graph/compile/cpp-unit.ts', {
  configFile: false,
  root: fileURLToPath(root),
  resolve: { alias: { '@': fileURLToPath(new URL('src', root)) } },
  logLevel: 'warn',
})
const { code, excluded } = module.cppUnit()
mkdirSync(new URL('cpp/generated/', root), { recursive: true })
writeFileSync(new URL('cpp/generated/nodes.cpp', root), code)
console.log(`GLSL-only kinds left out of cpp/generated/nodes.cpp: ${excluded.join(', ')}`)
