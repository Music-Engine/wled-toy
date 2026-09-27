import type { Features } from '@/lib/audio/dsp'
import { audioFeatures } from '@/lib/audio/features'
import { AUDIO_BINS, HISTORY_ROWS, WAVE_ROWS, WAVE_WIDTH, type AudioTextures } from '@/lib/audio/textures'
import { AUDIO_EXTRA_SLOTS } from '@/lib/shader/prelude'
import { createTexture } from './gl-texture'
import type { UniformLocations } from './renderer-shaders'

/** The audio textures a shader samples: the default analysis on units 0 and 3 to 5, the extra analyses on 8 and up. */
export class AudioInputs {
  private readonly spectrumTex: WebGLTexture
  private readonly bandsTex: WebGLTexture
  private readonly historyTex: WebGLTexture
  private readonly waveTex: WebGLTexture
  private bandCount = 0
  // band and history textures of the extra analyses, on texture units 8 and up
  private readonly extra: { bands: WebGLTexture; history: WebGLTexture; bandCount: number; head: number }[] = []
  private heads = [0, 0, 48000]
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
  upload(audio: AudioTextures, extra: AudioTextures[] = [], features: Features | null = null) {
    const { gl } = this
    const upload = (unit: number, tex: WebGLTexture, width: number, height: number, data: Uint8Array) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data)
    }
    if (audio.bandCount !== this.bandCount) this.resizeBands(audio.bandCount)
    upload(0, this.spectrumTex, AUDIO_BINS, 2, audio.spectrum)
    upload(3, this.bandsTex, audio.bandCount, 2, audio.bands)
    upload(4, this.historyTex, audio.bandCount, HISTORY_ROWS, audio.history)
    upload(5, this.waveTex, WAVE_WIDTH, WAVE_ROWS, audio.wave)
    this.heads = [audio.historyHead, audio.waveHead, audio.sampleRate]
    audioFeatures(features, audio.sampleRate, this.features)
    extra.slice(0, AUDIO_EXTRA_SLOTS).forEach((textures, i) => {
      const slot = this.extra[i]
      if (slot.bandCount !== textures.bandCount) this.resizeExtra(i, textures.bandCount)
      upload(8 + i * 2, slot.bands, textures.bandCount, 2, textures.bands)
      upload(9 + i * 2, slot.history, textures.bandCount, HISTORY_ROWS, textures.history)
      slot.head = textures.historyHead
    })
  }

  /** Binds every audio texture to its unit and points the program's audio uniforms at them. */
  bind(u: UniformLocations) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.spectrumTex)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.bandsTex)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex)
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex)
    this.extra.forEach((slot, i) => {
      gl.activeTexture(gl.TEXTURE8 + i * 2)
      gl.bindTexture(gl.TEXTURE_2D, slot.bands)
      gl.activeTexture(gl.TEXTURE9 + i * 2)
      gl.bindTexture(gl.TEXTURE_2D, slot.history)
    })
    // every sampler of an array needs its own unit, used or not, or two sampler types end up sharing unit 0
    if (u.iAudioBandsExtra) gl.uniform1iv(u.iAudioBandsExtra, this.extra.map((_, i) => 8 + i * 2))
    if (u.iAudioHistoryExtra) gl.uniform1iv(u.iAudioHistoryExtra, this.extra.map((_, i) => 9 + i * 2))
    if (u.iAudioHistoryHeadExtra) gl.uniform1fv(u.iAudioHistoryHeadExtra, this.extra.map((slot) => slot.head))
    gl.uniform1i(u.iAudioBands ?? null, 3)
    gl.uniform1i(u.iAudioHistory ?? null, 4)
    gl.uniform1i(u.iAudioWave ?? null, 5)
    gl.uniform3f(u.iAudioHeads ?? null, this.heads[0], this.heads[1], this.heads[2])
    gl.uniform4fv(u.iAudioFeatures ?? null, this.features)
    gl.uniform1i(u.iAudio ?? null, 0)
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
