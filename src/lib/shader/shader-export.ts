import { config } from '@/lib/app/config'
import { documentSessions } from '@/lib/documents/document-session'
import { SHADER_FILES, createBrowserBackend, createTauriBackend, type FileBackend } from '@/lib/documents/file-backends'
import { useEngine } from '@/lib/engine/engine'
import { ref } from 'vue'
import { createDefaultGraph, generateGlsl, normalizeDoc, type FrozenValue, type NodeGraph } from '@/lib/graph'
import { log, report } from '@/lib/app/logs'
import { isTauri } from '@/lib/app/platform'
import { bundleShader } from './shader-bundle'
import { SHADER_FILE_EXTENSION } from './shader-document'
import { loadTauriFiles } from '@/lib/documents/tauri-files'
import { workspace } from '@/lib/app/workspace'

/** Shown above the shader editor after a graph's code arrives there with values that no longer move; null once dismissed. */
export const graphCodeNotice = ref<string | null>(null)

/** What a graph loses when its code leaves the graph: the values that only a running graph computes, and what they were frozen at. */
export function frozenNotice(frozen: FrozenValue[]): string | null {
  if (!frozen.length) return null
  const list = frozen.map((f) => `${f.title} "${f.output}" at ${f.value}`).join(', ')
  return `${frozen.length === 1 ? '1 value is' : `${frozen.length} values are`} frozen in this code: ${list}. ${frozen.length === 1 ? 'It only updates' : 'They only update'} inside a running graph, once per frame, so the shader will not follow ${frozen.length === 1 ? 'it' : 'them'}.`
}

/** The shader of the mode on screen as one self-contained file, and the name to suggest for it. Throws when a graph does not compile. */
export function standaloneGlsl(): { name: string; text: string } {
  const open = documentSessions[workspace.mode]
  const name = `${(open?.store.fileName.value ?? workspace.mode).replace(/\.\w+$/, '')}.standalone${SHADER_FILE_EXTENSION}`
  if (workspace.mode !== 'graph') return { name, text: bundleShader(config.code, name) }
  const doc = (open?.snapshot() as NodeGraph | undefined) ?? normalizeDoc(config.graph ?? createDefaultGraph())
  // standalone code reads no iControl slot: what only the CPU knows is baked in as the value it has right now
  const generated = generateGlsl(doc, { standalone: true, controls: (nodeId, output) => useEngine().controlOutput(nodeId, output) })
  if (generated.error) throw new Error(generated.error)
  const notice = frozenNotice(generated.frozen)
  if (notice) log(notice, 'warn')
  return { name, text: bundleShader(generated.code, name) }
}

let backend: FileBackend | undefined

export async function exportStandaloneGlsl(): Promise<void> {
  try {
    const { name, text } = standaloneGlsl()
    backend ??= isTauri() ? createTauriBackend(loadTauriFiles, SHADER_FILES) : createBrowserBackend(SHADER_FILES)
    const saved = await backend.saveAs(text, name, SHADER_FILE_EXTENSION)
    if (saved) log(`Exported ${saved.handle.name}`)
  } catch (e) {
    report(e, 'Export failed')
  }
}
