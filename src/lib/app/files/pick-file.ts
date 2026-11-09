/** Resolves to the chosen file, or to null when the user cancels. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    // WebKit (the desktop app's webview) never fires change on an input that is not in the document
    input.hidden = true
    document.body.append(input)
    const settle = (file: File | null) => {
      input.remove()
      resolve(file)
    }
    input.onchange = () => settle(input.files?.[0] ?? null)
    input.oncancel = () => settle(null)
    input.click()
  })
}
