import { afterEach, expect, it, vi } from 'vitest'
import { downloadText } from './download'

afterEach(() => vi.unstubAllGlobals())

it('downloads the text under the name with the MIME type, and releases the URL', async () => {
  const blobs: Blob[] = []
  const revoked: string[] = []
  const anchor = { href: '', download: '', click: vi.fn() }
  vi.stubGlobal('document', { createElement: () => anchor })
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      blobs.push(blob)
      return 'blob:fake'
    },
    revokeObjectURL: (url: string) => void revoked.push(url),
  })

  downloadText('show.json', '{"a":1}', 'application/json')

  expect(anchor).toMatchObject({ href: 'blob:fake', download: 'show.json' })
  expect(anchor.click).toHaveBeenCalledOnce()
  expect(blobs[0].type).toBe('application/json')
  expect(await blobs[0].text()).toBe('{"a":1}')
  expect(revoked).toEqual(['blob:fake'])
})
