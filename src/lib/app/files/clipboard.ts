export type ClipboardWriter = (text: string) => void | Promise<void>

let writer: ClipboardWriter = (text) => { void navigator.clipboard.writeText(text) }

/** Lets a test capture what gets copied instead of exercising the real OS clipboard. */
export function setClipboardWriter(next: ClipboardWriter): void {
  writer = next
}

export function copyText(text: string): void | Promise<void> {
  return writer(text)
}
