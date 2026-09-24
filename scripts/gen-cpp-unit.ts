// Writes cpp/generated/nodes.cpp, every node kind as C++, and cpp/generated/parity.cpp, the op tables' numeric parity
// check, and prints the kinds left out as GLSL-only. Safe to run twice.
// Run with `node scripts/gen-cpp-unit.ts`; Vite's module runner resolves the `@/` imports the graph module uses.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const root = new URL('../', import.meta.url)
const load = async <T>(path: string) =>
  (await runnerImport<T>(path, {
    configFile: false,
    root: fileURLToPath(root),
    resolve: { alias: { '@': fileURLToPath(new URL('src', root)) } },
    logLevel: 'warn',
  })).module
const { cppUnit } = await load<typeof import('@/lib/graph/compile/cpp-unit')>('/src/lib/graph/compile/cpp-unit.ts')
const { cppParity } = await load<typeof import('@/lib/graph/compile/cpp-parity')>('/src/lib/graph/compile/cpp-parity.ts')
const { code, excluded } = cppUnit()
const parity = cppParity()
mkdirSync(new URL('cpp/generated/', root), { recursive: true })
writeFileSync(new URL('cpp/generated/nodes.cpp', root), code)
writeFileSync(new URL('cpp/generated/parity.cpp', root), parity.code)
console.log(`GLSL-only kinds left out of cpp/generated/nodes.cpp: ${excluded.join(', ')}`)
console.log(`Operations in cpp/generated/parity.cpp: ${parity.ops.length}`)
