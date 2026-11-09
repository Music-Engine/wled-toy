import { expect, it } from 'vitest'
import { checkTrackFile } from './track-file'

function wav(seconds: number) {
  const rate = 8000
  const samples = rate * seconds
  const view = new DataView(new ArrayBuffer(44 + samples * 2))
  const text = (offset: number, value: string) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples * 2, true)
  return new Blob([view.buffer], { type: 'audio/wav' })
}

it('measures a real audio file with the browser decoder', async () => {
  const result = await checkTrackFile({ name: 'two.wav', blob: wav(2) })
  expect(result.ok && Math.round(result.seconds)).toBe(2)
})

it('refuses bytes that only claim to be audio', async () => {
  const result = await checkTrackFile({ name: 'fake.mp3', blob: new Blob(['this is not audio at all'], { type: 'audio/mpeg' }) })
  expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('could not be decoded') })
})
