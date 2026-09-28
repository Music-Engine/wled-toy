import { extension } from '@/lib/util/files'

export type TrackCheck = { ok: true; seconds: number } | { ok: false; reason: string }

const EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm']

/** Seconds of audio the browser can play from the blob; rejects when it cannot decode it. */
export function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const element = new Audio()
    const finish = (settle: () => void) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      settle()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('timed out'))), 8000)
    element.onloadedmetadata = () => finish(() => resolve(element.duration))
    element.onerror = () => finish(() => reject(new Error(element.error?.message || 'decode error')))
    element.preload = 'metadata'
    element.src = url
  })
}

/** Whether a picked file can stand in for the built-in track: an audio type or extension, not empty, and decodable here. */
export async function checkTrackFile(file: { blob: Blob; name: string }, probe = probeDuration): Promise<TrackCheck> {
  // a file dropped in from the desktop app or an odd server often has no type, so the extension counts too
  if (!file.blob.type.startsWith('audio/') && !EXTENSIONS.includes(extension(file.name))) {
    return {
      ok: false,
      reason: `${file.name} is not an audio file (${file.blob.type || 'unknown type'}). Use ${EXTENSIONS.slice(0, 6).join(', ')} or another format this system plays.`,
    }
  }
  if (file.blob.size === 0) return { ok: false, reason: `${file.name} is empty.` }
  try {
    const seconds = await probe(file.blob)
    if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, reason: `${file.name} has no playable audio in it.` }
    return { ok: true, seconds }
  } catch {
    return { ok: false, reason: `${file.name} could not be decoded. The format may not be supported here, or the file is damaged.` }
  }
}
