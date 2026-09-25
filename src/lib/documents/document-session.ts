import { computed, onScopeDispose, ref, shallowReactive, shallowRef, watchEffect, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { getCommand, registerCommands } from '@/lib/app/commands'
import { createDocumentStore, recentId, type DocumentStore, type DocumentStoreOptions } from './documents'
import { log, report } from '@/lib/app/logs'
import { preferences } from '@/lib/app/preferences'
import { workspace, type Mode } from '@/lib/app/workspace'

export type PromptChoice = 'save' | 'discard' | 'cancel' | 'recover'

export interface DocumentPrompt {
  kind: 'unsaved' | 'revert' | 'recovery'
  answer(choice: PromptChoice): void
}

/** A document store plus what a user meets around it: the questions before unsaved work is replaced, the recovery offer, errors and the log. */
export interface DocumentSession<T> {
  store: DocumentStore<T>
  /** What the document is called in a sentence: "graph", "shader". */
  noun: string
  /** The file name, or "Untitled" before the first save. */
  name: ComputedRef<string>
  /** Why the last file action failed; cleared by the next one that works. */
  error: Ref<string | null>
  /** The question the user has to answer before a file action goes on. */
  prompt: ShallowRef<DocumentPrompt | null>
  /** The document as the editor holds it right now. */
  snapshot(): T
  newDocument(): Promise<void>
  open(): Promise<void>
  /** Opens a file that was handed over instead of picked, with the same questions, errors and log line as `open`. */
  openFile(file: { name: string; text: string }): Promise<void>
  openRecent(id: string): Promise<void>
  save(): Promise<void>
  saveAs(): Promise<void>
  revert(): Promise<void>
  /** What a closing window asks first: true when nothing unsaved is left behind, false when the user cancels or a save fails. */
  settleBeforeClose(): Promise<boolean>
}

/** The document each mode edits right now, there from the first visit of its page. */
export const documentSessions = shallowReactive<Partial<Record<Mode, DocumentSession<unknown>>>>({})

/** The document of the mode on screen; the title bar, the window title and the File menu read it. */
export const activeDocument = computed(() => documentSessions[workspace.mode] ?? null)

export const documentTitle = (open: DocumentSession<unknown>) => `${open.name.value}${open.store.dirty.value ? ' (edited)' : ''}`

export interface DocumentSessionOptions<T> extends Omit<DocumentStoreOptions<T>, 'kind' | 'autosaveDebounceMs'> {
  /** The mode whose page edits this document; it is also the document's noun and what namespaces its storage keys. */
  mode: Mode
}

/** Call inside a component or an effect scope: the unload guard and the autosave end with it. */
export function createDocumentSession<T>({ mode, ...storeOptions }: DocumentSessionOptions<T>): DocumentSession<T> {
  const store = createDocumentStore<T>({
    ...storeOptions,
    kind: mode,
    autosaveDebounceMs: () => (preferences.autosave ? preferences.autosaveSeconds * 1000 : null),
  })
  const name = computed(() => store.fileName.value ?? 'Untitled')
  const error = ref<string | null>(null)
  const prompt = shallowRef<DocumentPrompt | null>(null)

  // a native menu or a closing window can ask while a question is still up; the question on screen stays, the new one counts as cancelled
  const ask = (kind: DocumentPrompt['kind']) => (prompt.value ? Promise.resolve<PromptChoice>('cancel') : new Promise<PromptChoice>((resolve) => {
    prompt.value = {
      kind,
      answer(choice) {
        prompt.value = null
        resolve(choice)
      },
    }
  }))

  async function attempt(what: string, action: () => unknown) {
    try {
      await action()
      error.value = null
    } catch (e) {
      error.value = `${what} failed: ${(e as Error).message}`
      report(e, `${what} failed`)
    }
  }

  /** True when the document may be replaced: it was clean, it got saved, or the user gave the changes up. */
  async function unsavedWorkSettled(): Promise<boolean> {
    if (!store.dirty.value) return true
    const choice = await ask('unsaved')
    if (choice === 'save') await store.save()
    // a cancelled save dialog leaves the document dirty, and then nothing may replace it
    return choice === 'discard' || (choice === 'save' && !store.dirty.value)
  }

  // every open and save that went through rewrites the recent list; a cancelled dialog does not
  async function wentThrough(run: () => Promise<void>): Promise<boolean> {
    const before = store.recentFiles.value
    await run()
    return store.recentFiles.value !== before
  }

  const session: DocumentSession<T> = {
    store,
    noun: mode,
    name,
    error,
    prompt,
    snapshot: storeOptions.getSnapshot,
    newDocument: () => attempt(`New ${mode[0].toUpperCase()}${mode.slice(1)}`, async () => {
      if (!(await unsavedWorkSettled())) return
      store.newDocument()
      log(`New ${mode}`)
    }),
    open: () => attempt('Open', async () => {
      if ((await unsavedWorkSettled()) && (await wentThrough(store.open))) log(`Opened ${name.value}`)
    }),
    openFile: (file) => attempt('Open', async () => {
      if (!(await unsavedWorkSettled())) return
      store.openText(file.name, file.text)
      log(`Opened ${name.value}`)
    }),
    openRecent: (recent) => attempt('Open Recent', async () => {
      if (!(await unsavedWorkSettled())) return
      await store.openRecent(recent)
      log(`Opened ${name.value}`)
    }),
    save: () => attempt('Save', async () => {
      if (await wentThrough(store.save)) log(`Saved ${name.value}`)
    }),
    saveAs: () => attempt('Save As', async () => {
      if (await wentThrough(store.saveAs)) log(`Saved ${name.value}`)
    }),
    revert: () => attempt('Revert', async () => {
      if (!store.dirty.value || (await ask('revert')) !== 'discard') return
      store.revert()
      log(`Reverted ${name.value} to its last save`)
    }),
    async settleBeforeClose() {
      if (!preferences.confirmClose) return true
      let settled = false
      await attempt('Save', async () => { settled = await unsavedWorkSettled() })
      return settled
    },
  }

  if (store.hasRecovery.value) {
    void ask('recovery').then((choice) => attempt('Recover', () => {
      if (choice !== 'recover') {
        store.newDocument()
        return
      }
      try {
        store.recoverFromAutosave()
        log(`Recovered the unsaved ${mode} of the last session`)
      } catch (e) {
        // a copy this version cannot read would otherwise be offered again on every launch
        store.discardRecovery()
        throw e
      }
    }))
  }

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (preferences.confirmClose && store.dirty.value) e.preventDefault()
  }
  window.addEventListener('beforeunload', onBeforeUnload)

  documentSessions[mode] = session
  onScopeDispose(() => {
    window.removeEventListener('beforeunload', onBeforeUnload)
    if (documentSessions[mode] === session) delete documentSessions[mode]
  })
  return session
}

if (typeof document !== 'undefined') {
  const baseTitle = document.title
  // one writer for every session: two of them, each naming its own document, would overwrite each other
  watchEffect(() => {
    document.title = activeDocument.value ? `${documentTitle(activeDocument.value)} - ${baseTitle}` : baseTitle
  })
}

registerCommands([
  {
    id: 'file.openRecent',
    list: () => {
      const store = activeDocument.value?.store
      const recent = store?.canReopenRecent ? store.recentFiles.value : []
      // the placeholder row keeps the submenu and its key in place while there is nothing to reopen
      if (!recent.length) {
        return [{
          id: 'file.recent.none',
          title: store && !store.canReopenRecent ? 'Not Available in This Browser' : 'No Recent Files',
          menu: ['File', 'Open Recent'],
          group: 'document',
          accelerator: 'Mod+Shift+O',
          enabled: () => false,
        }]
      }
      return recent.map((file, index) => ({
        id: `file.recent.${recentId(file)}`,
        title: file.name,
        menu: ['File', 'Open Recent'],
        group: 'document',
        accelerator: index === 0 ? 'Mod+Shift+O' : undefined,
        run: () => activeDocument.value?.openRecent(recentId(file)),
      }))
    },
  },
  { ...getCommand('file.revert')!, enabled: () => !!activeDocument.value?.store.dirty.value },
])
