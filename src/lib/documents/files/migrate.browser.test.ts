import { effectScope } from 'vue'
import { afterEach, expect, it } from 'vitest'
import { createGlslCompiler } from '@/lib/graph/compile/compilers'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { createGraphDocument } from '@/lib/graph/model/document'
import { logs } from '@/lib/app/logs'
import type { FileBackend } from './file-backends'
import demoFile from '/graphs/liquid-nebula.wledgraph?raw'

const scope = effectScope()
afterEach(() => localStorage.clear())

const noDisk: FileBackend = {
  open: async () => null,
  save: async () => undefined,
  saveAs: async () => null,
}

function openAtVersion(version: number) {
  const envelope = JSON.parse(demoFile)
  envelope.graph.version = version
  let loaded: NodeGraph | null = null
  const session = scope.run(() => createGraphDocument({ backend: noDisk, getSnapshot: () => loaded!, onLoad: (doc) => (loaded = doc) }))!
  return session.openFile({ name: 'nebula.wledgraph', text: JSON.stringify(envelope) }).then(() => ({ session, loaded }))
}

it('opens a version 3 demo file as version 4 and compiles it', async () => {
  const { session, loaded } = await openAtVersion(3)
  expect(session.error.value).toBeNull()
  expect(loaded!.version).toBe(4)
  expect(logs.value.map((entry) => entry.message)).toContain('Graph file: migrated from version 3 to 4')
  const result = createGlslCompiler().compile(loaded!)
  expect(result.issues).toEqual([])
  expect(result.program).not.toBeNull()
})

it('refuses a version 5 file with one message', async () => {
  const { session, loaded } = await openAtVersion(5)
  expect(loaded).toBeNull()
  expect(session.error.value).toBe('Open failed: This graph was saved by a newer version (5); this app reads version 4.')
})

it('refuses a version 2 (rc2) file with one message', async () => {
  const { session, loaded } = await openAtVersion(2)
  expect(loaded).toBeNull()
  expect(session.error.value).toBe('Open failed: This graph was saved by an older version (2); this app reads version 4.')
})
