import { importConfig } from '@/lib/app/settings/config'
import { useEngine } from '@/lib/engine/engine'
import { log, report } from '@/lib/app/logs'
import { pickFile } from '@/lib/app/files/pick-file'
import { isTauri } from '@/lib/app/platform'
import { loadTauriFiles } from '@/lib/documents/files/tauri-files'
import { baseName } from '@/lib/util/files'

export async function chooseSong() {
  const file = await pickFile('audio/*')
  if (!file) return
  const engine = useEngine()
  if (!(await engine.useSong({ blob: file, name: file.name }))) return
  await engine.audio.configure({ source: 'file' })
  log(`Using your song: ${file.name}`)
}

export async function chooseImage() {
  const file = await pickFile('image/*')
  if (!file) return
  await useEngine().useImage({ blob: file, name: file.name })
  log(`Using your image: ${file.name}`)
}

// a song or an image stays with the webview's file input: a file read through the fs plugin has no media type, which a blob URL needs to play
async function pickConfigFile(): Promise<File | null> {
  if (!isTauri()) return pickFile('application/json')
  const files = await loadTauriFiles()
  const path = await files.pickOpen({ name: 'WLEDtoy config', extensions: ['json'] })
  return path === null ? null : new File([await files.readTextFile(path)], baseName(path))
}

export async function chooseConfig() {
  const file = await pickConfigFile()
  if (!file) return
  try {
    const picked = await importConfig(file)
    log(`Imported ${file.name} (${Object.keys(picked).join(', ') || 'nothing usable'})`)
  } catch (e) {
    report(e, 'Import failed')
  }
}
