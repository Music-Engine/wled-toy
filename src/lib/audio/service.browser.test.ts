import { afterEach, expect, it, vi } from 'vitest'
import { Filterbank } from './dsp'
import { AudioService } from './service'
import { DEFAULT_ANALYSIS } from './settings'

let service: AudioService | undefined
afterEach(() => {
  service?.dispose()
  vi.restoreAllMocks()
})

const until = async (condition: () => boolean, ms = 4000) => {
  const deadline = performance.now() + ms
  while (!condition() && performance.now() < deadline) await new Promise((r) => setTimeout(r, 50))
  return condition()
}

it('analyzes a capture device: hops arrive from the worklet and the beeping fake microphone registers', async () => {
  service = new AudioService('/assets/audio.mp3')
  await service.configure({ source: 'device' })
  await service.start()
  expect(service.state.error).toBeNull()
  expect(service.state.sampleRate).toBeGreaterThan(8000)
  expect(await until(() => (service!.features?.peak ?? 0) > 0.01)).toBe(true)
  expect(await until(() => Math.max(...service!.textures.bands) > 0)).toBe(true)
})

/** 16-bit mono PCM as a WAV file. */
function wavFile(pcm: Int16Array<ArrayBuffer>, rate: number, name: string) {
  const header = new DataView(new ArrayBuffer(44))
  const text = (at: number, s: string) => [...s].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF'); header.setUint32(4, 36 + pcm.byteLength, true); text(8, 'WAVEfmt '); header.setUint32(16, 16, true)
  header.setUint16(20, 1, true); header.setUint16(22, 1, true); header.setUint32(24, rate, true); header.setUint32(28, rate * 2, true)
  header.setUint16(32, 2, true); header.setUint16(34, 16, true); text(36, 'data'); header.setUint32(40, pcm.byteLength, true)
  return { blob: new Blob([header, pcm], { type: 'audio/wav' }), name }
}

it('takeFeatures holds an onset until it is read, so a reader slower than the hop rate sees every click', async () => {
  // four clicks a second for three seconds, 10 ms of noise each
  const rate = 8000
  const pcm = new Int16Array(rate * 3).map((_, i) => (i % (rate / 4) < rate / 100 ? (Math.random() * 2 - 1) * 20000 : 0))
  service = new AudioService('/assets/audio.mp3')
  await service.setFile(wavFile(pcm, rate, 'clicks.wav'))
  await service.start()
  expect(await until(() => (service!.features?.peak ?? 0) > 0.1)).toBe(true)
  // polling every 50 ms is several hops apart, so reading the features directly would see about one click in four
  let onsets = 0
  const deadline = performance.now() + 2000
  while (performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50))
    if (service.takeFeatures()[0]?.onset) onsets++
  }
  expect(onsets).toBeGreaterThanOrEqual(6)
})

it('switching source stops the tracks of the old one', async () => {
  const streams: MediaStream[] = []
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async (constraints) => {
    const stream = await original(constraints)
    streams.push(stream)
    return stream
  })
  service = new AudioService('/assets/audio.mp3')
  await service.configure({ source: 'device' })
  await service.start()
  expect(streams[0].getAudioTracks()[0].readyState).toBe('live')
  await service.configure({ source: 'file' })
  expect(streams[0].getAudioTracks()[0].readyState).toBe('ended')
  expect(service.state.settings.source).toBe('file')
})

it('a refused permission is reported and the previous source stays selected', async () => {
  service = new AudioService('/assets/audio.mp3')
  await service.start()
  vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
  await service.configure({ source: 'device' })
  expect(service.state.error).toBe('Permission to capture audio was refused')
  expect(service.state.settings.source).toBe('file')
})

it('runs a second analysis with its own window, hop and bands next to the default one', async () => {
  service = new AudioService('/assets/audio.mp3')
  await service.configure({ source: 'device' })
  await service.start()
  service.setAnalyses([{ ...DEFAULT_ANALYSIS, bands: 24, windowSize: 4096, hop: 1024 }])
  expect(service.slots.map((slot) => slot.textures.bandCount)).toEqual([64, 24])
  // each analysis fills at its own hop from the same stream of blocks
  expect(await until(() => service!.slots.every((slot) => slot.features !== null))).toBe(true)
  expect(service.slots[1].features!.bands).toHaveLength(24)
  expect(service.slots[1].features!.spectrum).toHaveLength(2048)
  // going back to the default alone keeps slot 0, history and all
  const kept = service.slots[0].textures
  service.setAnalyses([])
  expect(service.slots).toHaveLength(1)
  expect(service.slots[0].textures).toBe(kept)
})

it('plays a song the user chose, and goes back to the built-in one', async () => {
  // one second of a 440 Hz tone
  const rate = 8000
  const song = wavFile(new Int16Array(rate).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / rate) * 20000), rate, 'tone.wav')

  service = new AudioService('/assets/audio.mp3')
  await service.setFile(song)
  await service.start()
  expect(service.state.fileName).toBe('tone.wav')
  expect(service.state.error).toBeNull()
  // the tone is loud and steady, so gain control settles with a clear peak near 440 Hz
  expect(await until(() => (service!.features?.rms ?? 0) > 0.2)).toBe(true)
  const bands = service.features!.bands
  const loudest = bands.indexOf(Math.max(...bands))
  const expected = new Filterbank(DEFAULT_ANALYSIS, service.state.sampleRate, DEFAULT_ANALYSIS.windowSize).bandAt(440)
  expect(Math.abs(loudest - expected)).toBeLessThanOrEqual(1)

  await service.setFile(null)
  expect(service.state.fileName).toBe('Built-in track')
})

const setPlatform = (value: string) => {
  Object.defineProperty(navigator, 'platform', { value, configurable: true })
  return () => { delete (navigator as { platform?: string }).platform }
}

it('an error clears as soon as the next attempt starts, and stays clear when it works', async () => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  service = new AudioService('/assets/audio.mp3')
  await service.start()
  const capture = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
  await service.configure({ source: 'device' })
  expect(service.state.error).toBe('Permission to capture audio was refused')

  let answer!: () => void
  capture.mockImplementationOnce((constraints) => new Promise((resolve) => { answer = () => resolve(original(constraints)) }))
  const attempt = service.configure({ source: 'device' })
  expect(service.state.error).toBeNull()
  answer()
  await attempt
  expect([service.state.error, service.state.settings.source]).toEqual([null, 'device'])
})

it('system audio asked for without a click raises the share prompt instead of failing, and the button path then captures', async () => {
  const microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
  const share = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockResolvedValue(microphone)
  service = new AudioService('/assets/audio.mp3')
  await service.start()
  // nothing was clicked in this page
  expect(navigator.userActivation.isActive).toBe(false)
  await service.configure({ source: 'loopback' })
  expect(share).not.toHaveBeenCalled()
  expect([service.state.sharePrompt, service.state.error, service.state.settings.source]).toEqual([true, null, 'file'])

  await service.shareSystemAudio()
  expect(share).toHaveBeenCalledOnce()
  expect([service.state.sharePrompt, service.state.error, service.state.settings.source, service.state.playing]).toEqual([false, null, 'loopback', true])
  expect(microphone.getAudioTracks()[0].readyState).toBe('live')
})

it('a share without an audio track is stopped and explained, and the source stays what it was', async () => {
  const restore = setPlatform('MacIntel')
  try {
    const canvas = document.createElement('canvas')
    canvas.getContext('2d')
    const shared = canvas.captureStream()
    expect(shared.getAudioTracks()).toHaveLength(0)
    vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockResolvedValue(shared)
    service = new AudioService('/assets/audio.mp3')
    await service.start()
    await service.shareSystemAudio()
    expect(service.state.error).toBe('No audio was shared. Choose a Chrome Tab and tick Share tab audio; macOS does not share audio for windows or screens.')
    expect(shared.getTracks().map((track) => track.readyState)).toEqual(['ended'])
    expect([service.state.settings.source, service.state.playing]).toEqual(['file', true])
  } finally {
    restore()
  }
})

it('the macOS desktop app refuses system audio with the way around it, without asking the webview', async () => {
  const restore = setPlatform('MacIntel')
  ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  try {
    const share = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia')
    service = new AudioService('/assets/audio.mp3')
    await service.start()
    await service.configure({ source: 'loopback' })
    expect(share).not.toHaveBeenCalled()
    expect(service.state.error).toBe('System audio capture is not available in the desktop app yet. Route audio through a loopback device such as BlackHole and pick it as the capture device.')
    expect(service.state.settings.source).toBe('file')
  } finally {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    restore()
  }
})
