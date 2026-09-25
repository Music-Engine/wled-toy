import { shallowRef } from 'vue'
import type { Mode } from './workspace'
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
  const kinds = new Set(types.map((type) => {
    // text/plain and octet-stream are what some systems report for a shader or a graph file
    if (!type || type.startsWith('text/') || type === 'application/octet-stream') return null
    return byMime(type)
  }))
  const [kind] = kinds
  if (kinds.size !== 1 || kind === null) return types.length > 1 ? 'Drop files' : 'Drop file'
  if (kind === 'audio') return 'Drop to use as the audio track'
  if (kind === 'image') return mode === 'graph' ? 'Drop to add an Image Texture here' : 'Drop to use as the image texture'
  if (kind === 'config') return 'Drop to import settings'
  return 'This file type is not supported'
}

/** A WLEDtoy config export, as opposed to any other JSON (a .wledgraph envelope carries `formatVersion`). */
export const isConfigExport = (raw: unknown) =>
  !!raw && typeof raw === 'object' && (raw as { app?: unknown }).app === 'wledtoy' && !('formatVersion' in raw)

/** A saved graph whatever it is called on disk: a .wledgraph that was renamed to .json still opens as one. */
export const isGraphEnvelope = (raw: unknown) =>
  !!raw && typeof raw === 'object' && (raw as { app?: unknown }).app === 'wledtoy' && 'formatVersion' in raw && 'graph' in raw

/** Bound by the graph page while it is mounted: puts an Image Texture node showing a library image at a screen point, or centered when the point is off the canvas. */
export const graphImageDrop = shallowRef<((imageId: string, title: string, at: { x: number; y: number }) => void) | null>(null)
