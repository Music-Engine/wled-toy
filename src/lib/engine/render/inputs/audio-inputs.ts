import type { Features } from '@/lib/audio/dsp'
import { computeAudioFeatures } from '@/lib/audio/features'
import { AUDIO_BINS, HISTORY_ROWS, MAX_SPECTRUM_BINS, WAVE_ROWS, WAVE_WIDTH, type AudioTextures } from '@/lib/audio/textures'
import { AUDIO_EXTRA_SLOTS } from '@/lib/shader/prelude'
import { createTexture } from '@/lib/engine/render/gl-texture'
import type { UniformLocations } from '@/lib/engine/render/renderer-shaders'

/** Audio textures a shader samples: default analysis on units 0 and 3 to 5, extra analyses on 8 and up */
export class AudioInputs {
  /** Bins per `iAudioSpectra` row: MAX_SPECTRUM_BINS unless the GPU's textures are narrower */
  readonly spectraWidth: number
  private readonly spectrumTexture: WebGLTexture
  private readonly bandsTexture: WebGLTexture
  private readonly historyTexture: WebGLTexture
  // Row per slot on unit 16: units 0 to 15 are taken
  private readonly spectraTexture: WebGLTexture
  private readonly spectrumBins = new Float32Array(AUDIO_EXTRA_SLOTS + 1)
  private readonly waveTexture: WebGLTexture
  private bandCount = 0
  private readonly extra: { bands: WebGLTexture; history: WebGLTexture; bandCount: number; head: number }[] = []
  // Default analysis's newest history row, next wave sample, sample rate; then each extra slot's newest row
  private readonly heads = new Float32Array([0, 0, 48000, ...new Array(AUDIO_EXTRA_SLOTS).fill(0)])
  private readonly features = computeAudioFeatures(null, 48000)
  // Everything until a program declares what it reads
  private readsFeatures = true
  private spectraSlots: readonly number[] = Array.from({ length: AUDIO_EXTRA_SLOTS + 1 }, (_, slot) => slot)

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.spectrumTexture = createTexture(gl, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, AUDIO_BINS, 2, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(AUDIO_BINS * 2))
    this.bandsTexture = createTexture(gl, 3)
    // Rings wrap, so a filtered lookup across the seam blends the right neighbors
    this.historyTexture = createTexture(gl, 4, gl.REPEAT)
    this.waveTexture = createTexture(gl, 5, gl.REPEAT)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, WAVE_WIDTH, WAVE_ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(WAVE_WIDTH * WAVE_ROWS).fill(128))
    this.resizeBands(1)
    this.spectraWidth = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, MAX_SPECTRUM_BINS)
    // R32F unfilterable w/o extension; bins fetched one by one anyway
    this.spectraTexture = createTexture(gl, SPECTRA_UNIT, gl.CLAMP_TO_EDGE, gl.NEAREST)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, this.spectraWidth, AUDIO_EXTRA_SLOTS + 1)
    for (let i = 0; i < AUDIO_EXTRA_SLOTS; i++) {
      const slot = { bands: createTexture(gl, 8 + i * 2), history: createTexture(gl, 9 + i * 2, gl.REPEAT), bandCount: 0, head: 0 }
      this.extra.push(slot)
      this.resizeExtra(i, 12)
    }
  }

  /** Features and spectra rows are computed and uploaded only for what the program reads */
  setReads(features: boolean, spectraSlots: readonly number[]) {
    this.readsFeatures = features
    this.spectraSlots = spectraSlots
  }

  /** `extra`: FFT nodes' analyses from slot 1; `features`: default analysis w/ pulses raised since prev upload */
  upload(audio: AudioTextures, extra: AudioTextures[], features: Features | null) {
    if (audio.bandCount !== this.bandCount) this.resizeBands(audio.bandCount)
    this.uploadBytes(0, this.spectrumTexture, AUDIO_BINS, 2, audio.spectrum)
    if (this.spectraSlots.includes(0)) this.uploadSpectrumRow(0, audio)
    this.uploadBytes(3, this.bandsTexture, audio.bandCount, 2, audio.bands)
    this.uploadBytes(4, this.historyTexture, audio.bandCount, HISTORY_ROWS, audio.history)
    this.uploadBytes(5, this.waveTexture, WAVE_WIDTH, WAVE_ROWS, audio.wave)
    this.heads.set([audio.historyHead, audio.waveHead, audio.sampleRate])
    if (this.readsFeatures) computeAudioFeatures(features, audio.sampleRate, this.features)
    for (let i = 0; i < Math.min(extra.length, AUDIO_EXTRA_SLOTS); i++) this.uploadExtraSlot(i, extra[i])
  }

  /** Only what the program samples */
  bind(uniforms: UniformLocations) {
    const { gl } = this
    this.bindSampler(0, this.spectrumTexture, uniforms.iAudio)
    this.bindSampler(3, this.bandsTexture, uniforms.iAudioBands)
    this.bindSampler(4, this.historyTexture, uniforms.iAudioHistory)
    this.bindSampler(5, this.waveTexture, uniforms.iAudioWave)
    this.bindSampler(SPECTRA_UNIT, this.spectraTexture, uniforms.iAudioSpectra)
    if (uniforms.iAudioSpectrumBins) gl.uniform1fv(uniforms.iAudioSpectrumBins, this.spectrumBins)
    this.bindExtraSlots(uniforms)
    if (uniforms.iAudioHeads) gl.uniform3f(uniforms.iAudioHeads, this.heads[0], this.heads[1], this.heads[2])
    if (uniforms.iAudioFeatures) gl.uniform4fv(uniforms.iAudioFeatures, this.features)
  }

  private uploadBytes(unit: number, texture: WebGLTexture, width: number, height: number, data: Uint8Array) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data)
  }

  /** Bin count stays the analysis's own, so frequencies map right; bins past `spectraWidth` are dropped */
  private uploadSpectrumRow(slot: number, textures: AudioTextures) {
    const { gl } = this
    textures.fillBins()
    const { bins, binCount } = textures
    this.spectrumBins[slot] = binCount
    if (!binCount) return
    gl.activeTexture(gl.TEXTURE0 + SPECTRA_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, this.spectraTexture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, slot, Math.min(binCount, this.spectraWidth), 1, gl.RED, gl.FLOAT, bins)
  }

  private uploadExtraSlot(index: number, textures: AudioTextures) {
    const slot = this.extra[index]
    if (slot.bandCount !== textures.bandCount) this.resizeExtra(index, textures.bandCount)
    this.uploadBytes(8 + index * 2, slot.bands, textures.bandCount, 2, textures.bands)
    this.uploadBytes(9 + index * 2, slot.history, textures.bandCount, HISTORY_ROWS, textures.history)
    if (this.spectraSlots.includes(index + 1)) this.uploadSpectrumRow(index + 1, textures)
    slot.head = textures.historyHead
  }

  private bindSampler(unit: number, texture: WebGLTexture, location: WebGLUniformLocation | null | undefined) {
    if (!location) return
    this.bindTexture(unit, texture)
    this.gl.uniform1i(location, unit)
  }

  // Every sampler of an array needs its own unit, used or not, or two sampler types share unit 0
  private bindExtraSlots(uniforms: UniformLocations) {
    const { gl } = this
    if (uniforms.iAudioBandsExtra) {
      this.extra.forEach((slot, i) => this.bindTexture(8 + i * 2, slot.bands))
      gl.uniform1iv(uniforms.iAudioBandsExtra, BANDS_EXTRA_UNITS)
    }
    if (uniforms.iAudioHistoryExtra) {
      this.extra.forEach((slot, i) => this.bindTexture(9 + i * 2, slot.history))
      gl.uniform1iv(uniforms.iAudioHistoryExtra, HISTORY_EXTRA_UNITS)
    }
    if (uniforms.iAudioHistoryHeadExtra) {
      this.extra.forEach((slot, i) => (this.heads[3 + i] = slot.head))
      gl.uniform1fv(uniforms.iAudioHistoryHeadExtra, this.heads, 3, AUDIO_EXTRA_SLOTS)
    }
  }

  private bindTexture(unit: number, texture: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit)
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
  }

  private resizeBands(count: number) {
    const { gl } = this
    this.bandCount = count
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.bandsTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, count, 2, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(count * 2))
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, this.historyTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, count, HISTORY_ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(count * HISTORY_ROWS))
  }

  private resizeExtra(index: number, count: number) {
    const { gl } = this
    const slot = this.extra[index]
    slot.bandCount = count
    gl.activeTexture(gl.TEXTURE8 + index * 2)
    gl.bindTexture(gl.TEXTURE_2D, slot.bands)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, count, 2, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(count * 2))
    gl.activeTexture(gl.TEXTURE9 + index * 2)
    gl.bindTexture(gl.TEXTURE_2D, slot.history)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, count, HISTORY_ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(count * HISTORY_ROWS))
  }
}

const SPECTRA_UNIT = 16
const BANDS_EXTRA_UNITS = Int32Array.from({ length: AUDIO_EXTRA_SLOTS }, (_, i) => 8 + i * 2)
const HISTORY_EXTRA_UNITS = Int32Array.from({ length: AUDIO_EXTRA_SLOTS }, (_, i) => 9 + i * 2)
