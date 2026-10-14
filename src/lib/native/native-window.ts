import { watchEffect } from 'vue'
import { runCommand } from '@/lib/app/commands'
import { activeDocument, documentSessions, documentTitle } from '@/lib/documents/sessions/document-session'
import { workspace, type Mode } from '@/lib/app/workspace'

/**
 * What a browser tab does with `document.title` and `beforeunload`, for a Tauri window: the title is hidden under the overlay
 * title bar but Mission Control and the Window menu show it, and a close request waits for Save, Discard or Cancel.
 */
export async function installNativeWindow(): Promise<void> {
  const appWindow = (await import('@tauri-apps/api/window')).getCurrentWindow()
  watchEffect(() => {
    const open = activeDocument.value
    void appWindow.setTitle(open ? `${documentTitle(open)} - WLEDtoy` : 'WLEDtoy')
  })
  await appWindow.onCloseRequested(async (event) => {
    const modes = Object.keys(documentSessions) as Mode[]
    for (const mode of [...modes.filter((m) => m === workspace.mode), ...modes.filter((m) => m !== workspace.mode)]) {
      const open = documentSessions[mode]!
      // the question is part of the document's page, which is off screen in the other modes
      if (open.store.dirty.value) runCommand(`mode.${mode}`)
      if (!(await open.settleBeforeClose())) {
        event.preventDefault()
        return
      }
    }
  })
}
