import { describe, expect, it } from 'vitest'
import { checkTrackFile } from './track-file'

const file = (name: string, type: string, size = 10) => ({ name, blob: new Blob([new Uint8Array(size)], { type }) })

describe('checkTrackFile', () => {
  it('refuses a file that is neither typed nor named as audio, without trying to decode it', async () => {
    let probed = false
    const result = await checkTrackFile(file('notes.txt', 'text/plain'), async () => {
      probed = true
      return 1
    })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('notes.txt is not an audio file (text/plain)') })
    expect(probed).toBe(false)
  })

  it('goes by the extension when the file has no type, as files from the desktop app often do', async () => {
    expect(await checkTrackFile(file('Song.FLAC', ''), async () => 12)).toEqual({ ok: true, seconds: 12 })
  })

  it('refuses an empty file, one that fails to decode, and one with no length', async () => {
    expect(await checkTrackFile(file('a.mp3', 'audio/mpeg', 0), async () => 5)).toMatchObject({ ok: false, reason: 'a.mp3 is empty.' })
    expect(
      await checkTrackFile(file('a.mp3', 'audio/mpeg'), async () => {
        throw new Error('nope')
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('could not be decoded') })
    expect(await checkTrackFile(file('a.mp3', 'audio/mpeg'), async () => Number.NaN)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no playable audio'),
    })
  })
})
