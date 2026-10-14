import { expect, it } from 'vitest'
import { clearMedia, loadMedia, saveMedia } from './media-store'

it('keeps a file with its name across opens of the database, and forgets it on clear', async () => {
  await saveMedia('image', { blob: new Blob(['pixels'], { type: 'image/png' }), name: 'mine.png' })
  const stored = await loadMedia('image')
  expect(stored?.name).toBe('mine.png')
  expect(await stored?.blob.text()).toBe('pixels')
  expect(stored?.blob.type).toBe('image/png')
  expect(await loadMedia('song')).toBeUndefined()
  await clearMedia('image')
  expect(await loadMedia('image')).toBeUndefined()
})
