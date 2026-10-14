import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const root = new URL('../', import.meta.url)
// Vite's module runner resolves the graph module's `@/` imports under plain node
const load = async <T>(path: string) =>
  (
    await runnerImport<T>(path, {
      configFile: false,
      root: fileURLToPath(root),
      resolve: { alias: { '@': fileURLToPath(new URL('src', root)) } },
      logLevel: 'warn',
    })
  ).module
const { writeNodesUnit, writeParityUnit } = await load<typeof import('@/lib/graph/testing/cpp-units')>('/src/lib/graph/testing/cpp-units.ts')
// Every kind alone and the op parity check; safe to run twice
const { code, excluded } = writeNodesUnit()
const parity = writeParityUnit()
mkdirSync(new URL('cpp/generated/', root), { recursive: true })
writeFileSync(new URL('cpp/generated/nodes.cpp', root), code)
writeFileSync(new URL('cpp/generated/parity.cpp', root), parity.code)
console.log(`Kinds left out of cpp/generated/nodes.cpp: ${excluded.join(', ')}`)
console.log(`Operations in cpp/generated/parity.cpp: ${parity.ops.length}`)
