import { AUDIO_BINS, HISTORY_ROWS, WAVE_ROWS, WAVE_WIDTH, type AudioTextures } from '@/lib/audio/textures'
import { AUDIO_EXTRA_SLOTS, IMAGE_LAYERS, IMAGE_LAYER_SIZE, PRELUDE } from '@/lib/shader/glsl'

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

// copies a feedback target to the canvas
const PRESENT = `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 color;
void main() { color = vec4(texelFetch(source, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }`

/** Two targets of one size: a pass draws into one while reading what it drew last time from the other. */
interface PingPong {
  textures: [WebGLTexture, WebGLTexture]
  framebuffers: [WebGLFramebuffer, WebGLFramebuffer]
  width: number
  height: number
  /** Which of the two holds the last finished frame. */
  latest: 0 | 1
}

const UNIFORMS = [
  'iResolution', 'iTime', 'iFrame', 'iLedCount', 'iScanY', 'iAudio', 'iImage', 'iControl',
  'iAudioBands', 'iAudioHistory', 'iAudioWave', 'iAudioHeads', 'iAudioBandsExtra', 'iAudioHistoryExtra', 'iAudioHistoryHeadExtra', 'iLayout', 'iLayoutCount', 'iPrevFrame', 'iTimeDelta', 'iImages',
] as const

export interface FrameParams {
  time: number
  /** Seconds since this kind of frame (preview or LED) was last drawn; feedback decays by it. Defaults to 1/60. */
  dt?: number
  frame: number
  ledCount: number
  scanY: number
}

export class ShaderRenderer {
  private readonly gl: WebGL2RenderingContext
  private program: WebGLProgram | null = null
  private uniforms: Partial<Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>> = {}
  private readonly audioTex: WebGLTexture
  private readonly imageTex: WebGLTexture
  private readonly ledTex: WebGLTexture
  private readonly bandsTex: WebGLTexture
  private readonly historyTex: WebGLTexture
  private readonly waveTex: WebGLTexture
  private readonly layoutTex: WebGLTexture
  private readonly imagesTex: WebGLTexture
  private layoutCount = 0
  private bandCount = 0
  // band and history textures of the extra analyses, on texture units 8 and up
  private readonly extraAudio: { bands: WebGLTexture; history: WebGLTexture; bandCount: number; head: number }[] = []
  private audioHeads = [0, 0, 48000]
  private readonly ledFb: WebGLFramebuffer
  private ledWidth = 0
  private controls: Float32Array | null = null
  private presentProgram: WebGLProgram | null = null
  private usesFeedback = false
  private readonly feedback: { led: PingPong | null; preview: PingPong | null } = { led: null, preview: null }
  // half floats keep a long fade smooth; 8 bits stall once a step rounds to nothing
  private readonly floatTargets: boolean
  private floats = new Float32Array(0)
  private rgba = new Uint8Array(0)

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 is not supported in this browser')
    this.gl = gl

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float')

    this.audioTex = this.createTexture(0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, AUDIO_BINS, 2, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(AUDIO_BINS * 2))
    this.imageTex = this.createTexture(1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 40, 40, 255]))
    this.ledTex = this.createTexture(2)
    this.bandsTex = this.createTexture(3)
    // both rings wrap, so a filtered lookup across the seam blends the right neighbors
    this.historyTex = this.createTexture(4, gl.REPEAT)
    this.waveTex = this.createTexture(5, gl.REPEAT)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, WAVE_WIDTH, WAVE_ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(WAVE_WIDTH * WAVE_ROWS).fill(128))
    this.resizeBands(1)
    for (let i = 0; i < AUDIO_EXTRA_SLOTS; i++) {
      const slot = { bands: this.createTexture(8 + i * 2), history: this.createTexture(9 + i * 2, gl.REPEAT), bandCount: 0, head: 0 }
      this.extraAudio.push(slot)
      this.resizeExtra(i, 12)
    }
    // unit 2 only ever held the LED render target, which is never sampled, so the image layers can live there
    this.imagesTex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.imagesTex)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE, IMAGE_LAYERS)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // how an image continues past its edge is the node's choice, made on the coordinates in the shader
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.layoutTex = this.createTexture(6)
    // float textures cannot be filtered without an extension, and positions are fetched per LED anyway
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    this.ledFb = gl.createFramebuffer()
  }

  get ready() {
    return this.program !== null
  }

  /** Compiles user code; on failure throws the GLSL info log and keeps the previous program. */
  compile(userCode: string): number {
    const { gl } = this
    const t0 = performance.now()
    const program = this.link(PRELUDE + userCode)
    if (this.program) gl.deleteProgram(this.program)
    this.program = program
    // only shaders that look back pay for the extra targets
    this.usesFeedback = /\b(iPrevFrame|previousFrame)\b/.test(userCode)
    this.resetFeedback()
    this.uniforms = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)]))
    return performance.now() - t0
  }

  setImage(img: TexImageSource) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  }

  /** Puts an image into a layer of `iImages`, resampled to the layer size. Sampling is by 0..1 coordinates, so its shape survives. */
  setImageLayer(layer: number, image: CanvasImageSource) {
    if (layer < 0 || layer >= IMAGE_LAYERS) return
    const { gl } = this
    const canvas = new OffscreenCanvas(IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE)
    canvas.getContext('2d')!.drawImage(image, 0, 0, IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.imagesTex)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  }

  /** x, y, z, segment per LED in wire order, or null for a plain strip along the scanline. */
  setLayout(positions: Float32Array | null) {
    const { gl } = this
    this.layoutCount = positions ? positions.length / 4 : 0
    if (!positions) return
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, this.layoutTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.layoutCount, 1, 0, gl.RGBA, gl.FLOAT, positions)
  }

  /** Values for `iControl`, four floats per vec4; applied on every draw until replaced. */
  setControls(block: Float32Array) {
    this.controls = block
  }

  /** `audio` is the default analysis; `extra` are the analyses of a graph's FFT nodes, in slot order from 1. */
  setAudio(audio: AudioTextures, extra: AudioTextures[] = []) {
    const { gl } = this
    const upload = (unit: number, tex: WebGLTexture, width: number, height: number, data: Uint8Array) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data)
    }
    if (audio.bandCount !== this.bandCount) this.resizeBands(audio.bandCount)
    upload(0, this.audioTex, AUDIO_BINS, 2, audio.spectrum)
    upload(3, this.bandsTex, audio.bandCount, 2, audio.bands)
    upload(4, this.historyTex, audio.bandCount, HISTORY_ROWS, audio.history)
    upload(5, this.waveTex, WAVE_WIDTH, WAVE_ROWS, audio.wave)
    this.audioHeads = [audio.historyHead, audio.waveHead, audio.sampleRate]
    extra.slice(0, AUDIO_EXTRA_SLOTS).forEach((textures, i) => {
      const slot = this.extraAudio[i]
      if (slot.bandCount !== textures.bandCount) this.resizeExtra(i, textures.bandCount)
      upload(8 + i * 2, slot.bands, textures.bandCount, 2, textures.bands)
      upload(9 + i * 2, slot.history, textures.bandCount, HISTORY_ROWS, textures.history)
      slot.head = textures.historyHead
    })
  }

  private resizeExtra(index: number, count: number) {
    const { gl } = this
    const slot = this.extraAudio[index]
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

  /** `maxHeight` caps the rows shaded, the width following the canvas's shape; 0 shades every display pixel. The canvas keeps its size on screen. */
  renderPreview(params: FrameParams, maxHeight = 0) {
    const { canvas } = this
    const displayHeight = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio))
    const h = maxHeight ? Math.min(maxHeight, displayHeight) : displayHeight
    const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio * h / displayHeight))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    if (!this.usesFeedback) {
      this.draw(w, h, params)
      return
    }
    const target = this.drawWithFeedback('preview', w, h, params)
    const { gl } = this
    this.presentProgram ??= this.link(PRESENT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.presentProgram)
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, target)
    gl.uniform1i(gl.getUniformLocation(this.presentProgram, 'source'), 7)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Forgets the previous frames, so trails start from black. */
  resetFeedback() {
    for (const key of ['led', 'preview'] as const) {
      const pair = this.feedback[key]
      pair?.textures.forEach((t) => this.gl.deleteTexture(t))
      pair?.framebuffers.forEach((f) => this.gl.deleteFramebuffer(f))
      this.feedback[key] = null
    }
  }

  /**
   * Renders one pixel per LED and returns r, g, b per LED as 0..1 floats. With float targets these keep the precision
   * the shader computed, which dithering downstream needs; otherwise they are the 8-bit values over 255.
   */
  renderLeds(params: FrameParams): Float32Array {
    const { gl } = this
    const n = params.ledCount
    if (this.usesFeedback) this.drawWithFeedback('led', n, 1, params)
    else {
      this.resizeLedTarget(n)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ledFb)
      this.draw(n, 1, params)
    }
    const out = new Float32Array(n * 3)
    if (this.floatTargets) {
      if (this.floats.length !== n * 4) this.floats = new Float32Array(n * 4)
      gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, this.floats)
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = this.floats[i * 4 + c]
    } else {
      if (this.rgba.length !== n * 4) this.rgba = new Uint8Array(n * 4)
      gl.readPixels(0, 0, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba)
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = this.rgba[i * 4 + c] / 255
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out
  }

  /** Draws into the target that does not hold the last frame, which the shader reads as iPrevFrame. Leaves that target bound. */
  private drawWithFeedback(pass: 'led' | 'preview', width: number, height: number, params: FrameParams): WebGLTexture {
    const { gl } = this
    let pair = this.feedback[pass]
    if (!pair || pair.width !== width || pair.height !== height) {
      pair?.textures.forEach((t) => gl.deleteTexture(t))
      pair?.framebuffers.forEach((f) => gl.deleteFramebuffer(f))
      const make = (): [WebGLTexture, WebGLFramebuffer] => {
        const texture = this.createTexture(7)
        if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null)
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        const framebuffer = gl.createFramebuffer()
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        gl.clearColor(0, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        return [texture, framebuffer]
      }
      const [a, b] = [make(), make()]
      pair = this.feedback[pass] = { textures: [a[0], b[0]], framebuffers: [a[1], b[1]], width, height, latest: 0 }
    }
    const target = pair.latest === 0 ? 1 : 0
    gl.bindFramebuffer(gl.FRAMEBUFFER, pair.framebuffers[target])
    this.draw(width, height, params, pair.textures[pair.latest])
    pair.latest = target
    return pair.textures[target]
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private draw(width: number, height: number, p: FrameParams, previous: WebGLTexture | null = null) {
    const { gl, program, uniforms: u } = this
    if (!program) return
    gl.viewport(0, 0, width, height)
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.bandsTex)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex)
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex)
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, this.layoutTex)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.imagesTex)
    gl.uniform1i(u.iImages ?? null, 2)
    gl.uniform1i(u.iLayout ?? null, 6)
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, previous)
    gl.uniform1i(u.iPrevFrame ?? null, 7)
    gl.uniform1f(u.iTimeDelta ?? null, p.dt ?? 1 / 60)
    gl.uniform1f(u.iLayoutCount ?? null, this.layoutCount)
    this.extraAudio.forEach((slot, i) => {
      gl.activeTexture(gl.TEXTURE8 + i * 2)
      gl.bindTexture(gl.TEXTURE_2D, slot.bands)
      gl.activeTexture(gl.TEXTURE9 + i * 2)
      gl.bindTexture(gl.TEXTURE_2D, slot.history)
    })
    // every sampler of an array needs its own unit, used or not, or two sampler types end up sharing unit 0
    if (u.iAudioBandsExtra) gl.uniform1iv(u.iAudioBandsExtra, this.extraAudio.map((_, i) => 8 + i * 2))
    if (u.iAudioHistoryExtra) gl.uniform1iv(u.iAudioHistoryExtra, this.extraAudio.map((_, i) => 9 + i * 2))
    if (u.iAudioHistoryHeadExtra) gl.uniform1fv(u.iAudioHistoryHeadExtra, this.extraAudio.map((slot) => slot.head))
    gl.uniform1i(u.iAudioBands ?? null, 3)
    gl.uniform1i(u.iAudioHistory ?? null, 4)
    gl.uniform1i(u.iAudioWave ?? null, 5)
    gl.uniform3f(u.iAudioHeads ?? null, this.audioHeads[0], this.audioHeads[1], this.audioHeads[2])
    gl.uniform3f(u.iResolution ?? null, width, height, 1)
    gl.uniform1f(u.iTime ?? null, p.time)
    gl.uniform1i(u.iFrame ?? null, p.frame)
    gl.uniform1f(u.iLedCount ?? null, p.ledCount)
    gl.uniform1f(u.iScanY ?? null, p.scanY)
    gl.uniform1i(u.iAudio ?? null, 0)
    gl.uniform1i(u.iImage ?? null, 1)
    if (this.controls && u.iControl) gl.uniform4fv(u.iControl, this.controls)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private link(fragment: string): WebGLProgram {
    const { gl } = this
    const vs = this.compileShader(gl.VERTEX_SHADER, VERT)
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragment)
    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'p')
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? 'link failed'
      gl.deleteProgram(program)
      throw new Error(info)
    }
    return program
  }

  private resizeLedTarget(n: number) {
    if (this.ledWidth === n) return
    const { gl } = this
    this.ledWidth = n
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.ledTex)
    if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, n, 1, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ledFb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ledTex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private createTexture(unit: number, wrap: number = WebGL2RenderingContext.CLAMP_TO_EDGE): WebGLTexture {
    const { gl } = this
    const tex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    return tex
  }

  private compileShader(type: number, src: string): WebGLShader {
    const { gl } = this
    const shader = gl.createShader(type)
    if (!shader) throw new Error('createShader failed')
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(info)
    }
    return shader
  }
}
