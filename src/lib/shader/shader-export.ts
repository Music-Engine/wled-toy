import { config } from '@/lib/app/settings/config'
import { documentSessions } from '@/lib/documents/sessions/document-session'
import { SHADER_FILES, createBrowserBackend, createTauriBackend, type FileBackend } from '@/lib/documents/files/file-backends'
import { ref } from 'vue'
import { createDefaultGraph, createGlslCompiler, normalizeDoc, type NodeGraph } from '@/lib/graph'
import { log, report } from '@/lib/app/logs'
import { isTauri } from '@/lib/app/platform'
import { bundleShader } from './shader-bundle'
import { SHADER_FILE_EXTENSION } from './shader-document'
import { loadTauriFiles } from '@/lib/documents/files/tauri-files'
import { workspace } from '@/lib/app/workspace'

/** Shown above the shader editor when a graph's code arrives w/ values that no longer move; null once dismissed */
export const graphCodeNotice = ref<string | null>(null)

let backend: FileBackend | undefined

export async function exportStandaloneGlsl(): Promise<void> {
  try {
    const { name, text } = bundleStandaloneGlsl()
    backend ??= isTauri() ? createTauriBackend(loadTauriFiles, SHADER_FILES) : createBrowserBackend(SHADER_FILES)
    const saved = await backend.saveAs(text, name, SHADER_FILE_EXTENSION)
    if (saved) log(`Exported ${saved.handle.name}`)
  } catch (e) {
    report(e, 'Export failed')
  }
}

/** Self-contained shader of the mode on screen and a name for it; throws when a graph doesn't compile */
export function bundleStandaloneGlsl(): { name: string; text: string } {
  const open = documentSessions[workspace.mode]
  const name = `${(open?.store.fileName.value ?? workspace.mode).replace(/\.\w+$/, '')}.standalone${SHADER_FILE_EXTENSION}`
  if (workspace.mode !== 'graph') return { name, text: bundleShader(config.code, name) }
  const doc = (open?.snapshot() as NodeGraph | undefined) ?? normalizeDoc(config.graph ?? createDefaultGraph())
  return { name, text: bundleShader(compileStandaloneGlsl(doc).code, name) }
}

/**
 * Graph as one hostless shader; the notice names what it loses (state memory, live knob, MIDI and OSC values), the
 * issues the live graph has too are logged as they are. Throws when the graph doesn't compile
 */
export function compileStandaloneGlsl(doc: NodeGraph): { code: string; notice: string | null } {
  const { program, issues } = createGlslCompiler({ standalone: true }).compile(doc)
  if (!program) throw new Error(issues.at(-1)?.message ?? 'The graph did not compile')
  // Only what the live compile lacks describes the difference
  const live = new Set(
    createGlslCompiler()
      .compile(doc)
      .issues.map((issue) => issue.message),
  )
  for (const issue of issues.filter((issue) => live.has(issue.message))) log(issue.message, 'warn')
  const lost = issues.filter((issue) => !live.has(issue.message))
  const notice = lost.length > 0 ? `This code differs from the running graph: ${lost.map((issue) => issue.message).join('; ')}.` : null
  if (notice) log(notice, 'warn')
  return { code: program.pixel, notice }
}
