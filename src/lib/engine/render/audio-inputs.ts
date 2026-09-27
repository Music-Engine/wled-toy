import type { Features } from '@/lib/audio/dsp'
import { audioFeatures } from '@/lib/audio/features'
import { AUDIO_BINS, HISTORY_ROWS, MAX_SPECTRUM_BINS, WAVE_ROWS, WAVE_WIDTH, type AudioTextures } from '@/lib/audio/textures'
import { AUDIO_EXTRA_SLOTS } from '@/lib/shader/prelude'
import { EngineError } from '@/lib/engine/engine-error'
import { createTexture } from './gl-texture'
import type { UniformLocations } from './renderer-shaders'

/** The audio textures a shader samples: the default analysis on units 0 and 3 to 5, the extra analyses on 8 and up. */
export class AudioInputs {
  private readonly spectrumTex: WebGLTexture
  private readonly bandsTex: WebGLTexture
  private readonly historyTex: WebGLTexture
  // each analysis's own spectrum in floats, a row per slot, on unit 16: units 0 to 15 are all taken
  private readonly spectraTex: WebGLTexture
  private readonly spectrumBins = new Float32Array(AUDIO_EXTRA_SLOTS + 1)
  private readonly waveTex: WebGLTexture
  private bandCount = 0
  // band and history textures of the extra analyses, on texture units 8 and up
  private readonly extra: { bands: WebGLTexture; history: WebGLTexture; bandCount: number; head: number }[] = []
  // the default analysis's newest history row, next wave sample and sample rate, then each extra slot's newest history row
  private readonly heads = new Float32Array([0, 0, 48000, ...new Array(AUDIO_EXTRA_SLOTS).fill(0)])
  private readonly features = audioFeatures(null, 48000)

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.spectrumTex = createTexture(gl, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, AUDIO_BINS, 2, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(AUDIO_BINS * 2))
    this.bandsTex = createTexture(gl, 3)
    // both rings wrap, so a filtered lookup across the seam blends the right neighbors
    this.historyTex = createTexture(gl, 4, gl.REPEAT)
    this.waveTex = createTexture(gl, 5, gl.REPEAT)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, WAVE_WIDTH, WAVE_ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(WAVE_WIDTH * WAVE_ROWS).fill(128))
    this.resizeBands(1)
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    if (maxSize < MAX_SPECTRUM_BINS) throw new EngineError('texture-size', `This GPU's textures are at most ${maxSize} texels wide; Band Split needs ${MAX_SPECTRUM_BINS}`)
    this.spectraTex = createTexture(gl, SPECTRA_UNIT)
    // 32-bit floats are not filterable without an extension, and the bins are fetched one by one anyway
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, MAX_SPECTRUM_BINS, AUDIO_EXTRA_SLOTS + 1)
    for (let i = 0; i < AUDIO_EXTRA_SLOTS; i++) {
      const slot = { bands: createTexture(gl, 8 + i * 2), history: createTexture(gl, 9 + i * 2, gl.REPEAT), bandCount: 0, head: 0 }
      this.extra.push(slot)
      this.resizeExtra(i, 12)
    }
  }

  /**
   * `audio` is the default analysis; `extra` are the analyses of a graph's FFT nodes, in slot order from 1; `features`
   * is the default analysis with the pulses raised since the previous upload, for `iAudioFeatures`.
   */
  upload(audio: AudioTextures, extra: AudioTextures[], features: Features | null, readsSpectra: boolean) {
    const { gl } = this
    const upload = (unit: number, tex: WebGLTexture, width: number, height: number, data: Uint8Array) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data)
    }
    if (audio.bandCount !== this.bandCount) this.resizeBands(audio.bandCount)
    upload(0, this.spectrumTex, AUDIO_BINS, 2, audio.spectrum)
    if (readsSpectra) this.uploadSpectrumRow(0, audio)
    upload(3, this.bandsTex, audio.bandCount, 2, audio.bands)
    upload(4, this.historyTex, audio.bandCount, HISTORY_ROWS, audio.history)
    upload(5, this.waveTex, WAVE_WIDTH, WAVE_ROWS, audio.wave)
    this.heads.set([audio.historyHead, audio.waveHead, audio.sampleRate])
    audioFeatures(features, audio.sampleRate, this.features)
    extra.slice(0, AUDIO_EXTRA_SLOTS).forEach((textures, i) => {
      const slot = this.extra[i]
      if (slot.bandCount !== textures.bandCount) this.resizeExtra(i, textures.bandCount)
      upload(8 + i * 2, slot.bands, textures.bandCount, 2, textures.bands)
      upload(9 + i * 2, slot.history, textures.bandCount, HISTORY_ROWS, textures.history)
      if (readsSpectra) this.uploadSpectrumRow(i + 1, textures)
      slot.head = textures.historyHead
    })
  }

  /** Binds each audio texture the program samples to its unit and points the program's audio uniforms at them. */
  bind(u: UniformLocations) {
    const { gl } = this
    this.bindSampler(0, this.spectrumTex, u.iAudio)
    this.bindSampler(3, this.bandsTex, u.iAudioBands)
    this.bindSampler(4, this.historyTex, u.iAudioHistory)
    this.bindSampler(5, this.waveTex, u.iAudioWave)
    this.bindSampler(SPECTRA_UNIT, this.spectraTex, u.iAudioSpectra)
    if (u.iAudioSpectrumBins) gl.uniform1fv(u.iAudioSpectrumBins, this.spectrumBins)
    // every sampler of an array needs its own unit, used or not, or two sampler types end up sharing unit 0
    if (u.iAudioBandsExtra) {
      this.extra.forEach((slot, i) => this.bindTexture(8 + i * 2, slot.bands))
      gl.uniform1iv(u.iAudioBandsExtra, BANDS_EXTRA_UNITS)
    }
    if (u.iAudioHistoryExtra) {
      this.extra.forEach((slot, i) => this.bindTexture(9 + i * 2, slot.history))
      gl.uniform1iv(u.iAudioHistoryExtra, HISTORY_EXTRA_UNITS)
    }
    if (u.iAudioHistoryHeadExtra) {
      this.extra.forEach((slot, i) => (this.heads[3 + i] = slot.head))
      gl.uniform1fv(u.iAudioHistoryHeadExtra, this.heads, 3, AUDIO_EXTRA_SLOTS)
    }
    if (u.iAudioHeads) gl.uniform3f(u.iAudioHeads, this.heads[0], this.heads[1], this.heads[2])
    if (u.iAudioFeatures) gl.uniform4fv(u.iAudioFeatures, this.features)
  }

  /** Binds `texture` to `unit` and points `location` at it, when the program samples it. */
  private bindSampler(unit: number, texture: WebGLTexture, location: WebGLUniformLocation | null | undefined) {
    if (!location) return
    this.bindTexture(unit, texture)
    this.gl.uniform1i(location, unit)
  }

  /** Binds `texture` to texture unit `unit`. */
  private bindTexture(unit: number, texture: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit)
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
  }

  /** Uploads an analysis's float bins into its row of `iAudioSpectra`, and records how many it holds. */
  private uploadSpectrumRow(slot: number, textures: AudioTextures) {
    const { gl } = this
    textures.fillBins()
    const { bins, binCount } = textures
    this.spectrumBins[slot] = binCount
    if (!binCount) return
    gl.activeTexture(gl.TEXTURE0 + SPECTRA_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, this.spectraTex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, slot, binCount, 1, gl.RED, gl.FLOAT, bins)
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

  private resizeBands(count: number) {
    const { gl } = this
    this.bandCount = count
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.bandsTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, count, 2, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(count * 2))
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, count, HISTORY_ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(count * HISTORY_ROWS))
  }
}

const SPECTRA_UNIT = 16
const BANDS_EXTRA_UNITS = Int32Array.from({ length: AUDIO_EXTRA_SLOTS }, (_, i) => 8 + i * 2)
const HISTORY_EXTRA_UNITS = Int32Array.from({ length: AUDIO_EXTRA_SLOTS }, (_, i) => 9 + i * 2)
