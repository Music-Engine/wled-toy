import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickFile } from './pick-file'

afterEach(() => vi.unstubAllGlobals())

interface FakeInput {
  type?: string
  accept?: string
  hidden?: boolean
  files?: File[]
  onchange: (() => void) | null
  oncancel: (() => void) | null
  click(): void
  remove(): void
}

function fakeDocument(user: (input: FakeInput) => void) {
  const body: FakeInput[] = []
  const input: FakeInput = {
    onchange: null,
    oncancel: null,
    click: () => {
      // the input must be in the document by the time the dialog opens, or WebKit never reports the choice
      expect(body).toContain(input)
      user(input)
    },
    remove: () => void body.splice(body.indexOf(input), 1),
  }
  vi.stubGlobal('document', { createElement: () => input, body: { append: (node: FakeInput) => body.push(node) } })
  return { input, body }
}

describe('pickFile', () => {
  it('resolves to the chosen file and takes its input out of the document', async () => {
    const file = { name: 'song.mp3' } as File
    const { input, body } = fakeDocument((el) => {
      el.files = [file]
      el.onchange!()
    })
    await expect(pickFile('audio/*')).resolves.toBe(file)
    expect(input).toMatchObject({ type: 'file', accept: 'audio/*', hidden: true })
    expect(body).toEqual([])
  })

  it('resolves to null when the user cancels, and takes its input out of the document', async () => {
    const { body } = fakeDocument((el) => el.oncancel!())
    await expect(pickFile('image/*')).resolves.toBeNull()
    expect(body).toEqual([])
  })
})
