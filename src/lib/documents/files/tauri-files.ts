export interface FileFilter {
  name: string
  /** Without the dot. */
  extensions: string[]
}

/** The dialogs and file calls of the Tauri plugins the app uses; a picker resolves to an absolute path, or null when the user cancels. */
export interface TauriFiles {
  pickOpen(filter: FileFilter): Promise<string | null>
  pickSave(defaultPath: string, filter: FileFilter): Promise<string | null>
  readTextFile(path: string): Promise<string>
  writeTextFile(path: string, text: string): Promise<void>
}

/** Imported on first use, so a browser never fetches the plugins. */
export async function loadTauriFiles(): Promise<TauriFiles> {
  const [dialog, fs] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
  return {
    pickOpen: (filter) => dialog.open({ multiple: false, directory: false, filters: [filter] }),
    pickSave: (defaultPath, filter) => dialog.save({ defaultPath, filters: [filter] }),
    readTextFile: (path) => fs.readTextFile(path),
    writeTextFile: (path, text) => fs.writeTextFile(path, text),
  }
}
