import { shallowRef } from 'vue'
import { log, report } from '@/lib/app/logs'
import { launchScreen } from '@/lib/app/settings/preferences'
import type { Mode } from '@/lib/app/workspace'
import { extension } from '@/lib/util/files'

export type DropKind = 'audio' | 'image' | 'graph' | 'shader' | 'config' | 'unknown'

export interface DroppedFile {
  name: string
  type: string
}

const byMime = (type: string): DropKind =>
  type.startsWith('audio/') ? 'audio' : type.startsWith('image/') ? 'image' : type === 'application/json' ? 'config' : 'unknown'

/** The extension decides first: a .webm or .ogg arrives as video/*, and a .wledgraph may arrive as application/json. */
export function classifyFile(file: DroppedFile): DropKind {
  const ext = extension(file.name)
  if (['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm'].includes(ext)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) return 'image'
  if (ext === 'wledgraph') return 'graph'
  if (['glsl', 'frag', 'fs'].includes(ext)) return 'shader'
  if (ext === 'json') return 'config'
  return byMime(file.type)
}

export interface DropPlan<F extends DroppedFile> {
  /** In the order to run them: documents last, since opening one switches modes. */
  steps: { kind: Exclude<DropKind, 'unknown'>; file: F }[]
  /** A second file of a kind that was taken already. */
  skipped: F[]
  unknown: F[]
}

export function planDrop<F extends DroppedFile>(files: readonly F[]): DropPlan<F> {
  const first = new Map<DropKind, F>()
  const skipped: F[] = []
  const unknown: F[] = []
  for (const file of files) {
    const kind = classifyFile(file)
    if (kind === 'unknown') unknown.push(file)
    else if (first.has(kind)) skipped.push(file)
    else first.set(kind, file)
  }
  const steps = (['config', 'audio', 'image', 'shader', 'graph'] as const).flatMap((kind) => (first.has(kind) ? [{ kind, file: first.get(kind)! }] : []))
  return { steps, skipped, unknown }
}

/**
 * The line shown while files hover over the window. A drag exposes the media type of each item and never its name,
 * so a .wledgraph or .glsl, which has no registered type, reads as an empty string and gets the neutral wording.
 */
export function dragHint(types: readonly string[], mode: Mode): string {
  const kinds = new Set(
    types.map((type) => {
      // text/plain and octet-stream are what some systems report for a shader or a graph file
      if (!type || type.startsWith('text/') || type === 'application/octet-stream') return null
      return byMime(type)
    }),
  )
  const [kind] = kinds
  if (kinds.size !== 1 || kind === null) return types.length > 1 ? 'Drop files' : 'Drop file'
  if (kind === 'audio') return 'Drop to use as the audio track'
  if (kind === 'image') return mode === 'graph' ? 'Drop to add an Image Texture here' : 'Drop to use as the image texture'
  if (kind === 'config') return 'Drop to import settings'
  return 'This file type is not supported'
}

/** A WLEDtoy config export, as opposed to any other JSON (a .wledgraph envelope carries `formatVersion`). */
export const isConfigExport = (raw: unknown) => !!raw && typeof raw === 'object' && (raw as { app?: unknown }).app === 'wledtoy' && !('formatVersion' in raw)

/** A saved graph whatever it is called on disk: a .wledgraph that was renamed to .json still opens as one. */
export const isGraphEnvelope = (raw: unknown) =>
  !!raw && typeof raw === 'object' && (raw as { app?: unknown }).app === 'wledtoy' && 'formatVersion' in raw && 'graph' in raw

type Point = { x: number; y: number }
type AddImageNode = (imageId: string, title: string, at: Point) => void

/** Bound by the graph page while it is mounted: puts an Image Texture node showing a library image at a screen point, or centered when the point is off the canvas. */
export const graphImageDrop = shallowRef<AddImageNode | null>(null)

/** What a drop acts on, passed in so the routing runs without a window, a router or a GPU. */
export interface DropTargets {
  /** Read per step: a settings drop that turns out to be a graph switches modes before the image step runs. */
  mode(): Mode
  /** Navigates to the page for `mode` and resolves with its document once the page is mounted, or with nothing when it did not come up. */
  openPage(mode: 'graph' | 'shader'): Promise<{ openFile(file: { name: string; text: string }): Promise<unknown> } | null | undefined>
  /** Resolves with the graph page's image drop once it is bound, or with nothing when it was not. */
  imageDrop(): Promise<AddImageNode | null | undefined>
  useImage(file: { blob: Blob; name: string }): Promise<unknown>
  addImage(blob: Blob, name: string): Promise<{ id: string; name: string }>
  /** False when the file is not playable audio; the engine has logged why. */
  useSong(file: { blob: Blob; name: string }): Promise<boolean>
  playFromFile(): Promise<unknown>
  importData(raw: unknown): object
}

async function openDocument(mode: 'graph' | 'shader', file: File, targets: DropTargets) {
  const text = await file.text()
  const session = await targets.openPage(mode)
  if (!session) return log(`${file.name} was not opened: ${mode} mode did not come up`, 'error')
  // a dropped file comes without a handle to write back to, so it opens under its name and Save asks where to put it
  await session.openFile({ name: file.name, text })
}

async function useAsImage(file: File, at: Point, targets: DropTargets) {
  if (targets.mode() !== 'graph') {
    await targets.useImage({ blob: file, name: file.name })
    return log(`Using your image: ${file.name}`)
  }
  const addNode = await targets.imageDrop()
  if (!addNode) return log(`${file.name} was not added: the graph is not ready`, 'error')
  const image = await targets.addImage(file, file.name)
  addNode(image.id, image.name, at)
}

async function useAsTrack(file: File, targets: DropTargets) {
  if (!(await targets.useSong({ blob: file, name: file.name }))) return
  await targets.playFromFile()
  log(`Using your song: ${file.name}`)
}

async function importSettings(file: File, targets: DropTargets) {
  const raw: unknown = await file
    .text()
    .then(JSON.parse)
    .catch((error) => report(error, `${file.name} could not be read as JSON`))
  if (isGraphEnvelope(raw)) return openDocument('graph', file, targets)
  if (!isConfigExport(raw)) return log(`${file.name} is not a WLEDtoy settings file`, 'warn')
  log(`Imported ${file.name} (${Object.keys(targets.importData(raw)).join(', ') || 'nothing usable'})`)
}

/** Runs each step of a drop in turn; a step that fails is reported and the rest still run. `at` is where an image lands on the graph. */
export async function applyDrop(plan: DropPlan<File>, at: Point, targets: DropTargets) {
  for (const file of plan.unknown) log(`${file.name} was not opened: WLEDtoy takes audio, images, .wledgraph, .glsl and settings files`, 'warn')
  for (const file of plan.skipped) log(`Skipped ${file.name}: one ${classifyFile(file)} file per drop`, 'warn')
  if (plan.steps.length) launchScreen.open = false
  for (const { kind, file } of plan.steps) {
    try {
      if (kind === 'audio') await useAsTrack(file, targets)
      else if (kind === 'image') await useAsImage(file, at, targets)
      else if (kind === 'config') await importSettings(file, targets)
      else await openDocument(kind, file, targets)
    } catch (err) {
      report(err, `${file.name} could not be used`)
    }
  }
}
