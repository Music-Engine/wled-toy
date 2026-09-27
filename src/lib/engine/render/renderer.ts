import type { AudioTextures } from '@/lib/audio/textures'
import { PRELUDE } from '@/lib/shader/prelude'
import { AudioInputs } from './audio-inputs'
import { EngineError } from '@/lib/engine/engine-error'
import { createPingPong, freePingPong, type PingPong } from './feedback-targets'
import { FramePass, type FrameSource } from './frame-pass'
import { bindFullScreenTriangle, linkProgram } from './gl-program'
import { createTexture } from './gl-texture'
import { GlobalState } from './global-state'
import { ImageInputs } from './image-inputs'
import { LedTarget } from './led-target'
import { PRESENT, UNIFORMS, type UniformLocations } from './renderer-shaders'

export class ShaderRenderer {
  private readonly gl: WebGL2RenderingContext
  private program: WebGLProgram | null = null
  private uniforms: UniformLocations = {}
  private readonly audio: AudioInputs
  private readonly images: ImageInputs
  private readonly led: LedTarget
  private readonly layoutTex: WebGLTexture
  private layoutCount = 0
  private controls: Float32Array | null = null
  private presentProgram: WebGLProgram | null = null
  private usesFeedback = false
  private stateLayers = 0
  private readonly feedback: { led: PingPong | null; preview: PingPong | null } = { led: null, preview: null }
  private framePass: FramePass | null = null
  // outlives the program so a recompile that keeps the frame pass keeps its values
  private globalState: GlobalState | null = null
  // half floats keep a long fade smooth; 8 bits stall once a step rounds to nothing
  private readonly floatTargets: boolean

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new EngineError('webgl-unavailable', 'WebGL2 is not supported in this browser')
    this.gl = gl

    bindFullScreenTriangle(gl)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float')

    this.audio = new AudioInputs(gl)
    this.images = new ImageInputs(gl)
    this.led = new LedTarget(gl, this.floatTargets)
    this.layoutTex = createTexture(gl, 6)
    // float textures cannot be filtered without an extension, and positions are fetched per LED anyway
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  }

  get ready() {
    return this.program !== null
  }

  /** Compiles user code and its frame pass, if any; on failure throws the GLSL info log and keeps the previous program. */
  compile(userCode: string, frame?: FrameSource): number {
    const { gl } = this
    const t0 = performance.now()
    const indices = [...new Set(Array.from(userCode.matchAll(/\boutState([1-3])\b/g), (m) => Number(m[1])))].sort()
    // layer k is attachment k + 1, so a gap would leave an output with nowhere to land
    if (indices.some((index, i) => index !== i + 1)) throw new EngineError('state-outputs', `outState indices must be contiguous from 1, found ${indices.join(', ')}`)
    const stateLayers = indices.length
    if (stateLayers > 0 && !this.floatTargets) throw new EngineError('no-float-targets', 'this GPU cannot keep per-pixel state')
    if (frame && !this.floatTargets) throw new EngineError('no-float-targets', 'this GPU cannot keep global state')
    const framePass = frame ? new FramePass(gl, frame) : null
    let program: WebGLProgram
    try {
      program = linkProgram(gl, PRELUDE + userCode)
    } catch (e) {
      if (framePass) gl.deleteProgram(framePass.program)
      throw e
    }
    if (this.program) gl.deleteProgram(this.program)
    if (this.framePass) gl.deleteProgram(this.framePass.program)
    this.program = program
    this.framePass = framePass
    if (frame) (this.globalState ??= new GlobalState(gl)).reserve(frame.texels)
    // only shaders that look back pay for the extra targets
    this.usesFeedback = /\b(iPrevFrame|previousFrame)\b/.test(userCode)
    this.stateLayers = stateLayers
    this.resetFeedback()
    this.uniforms = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)]))
    return performance.now() - t0
  }

  setImage(img: TexImageSource) {
    this.images.setImage(img)
  }

  /** Puts an image into a layer of `iImages`, resampled to the layer size. Sampling is by 0..1 coordinates, so its shape survives. */
  setImageLayer(layer: number, image: CanvasImageSource) {
    this.images.setLayer(layer, image)
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
    this.audio.upload(audio, extra)
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
    if (!this.usesFeedback && this.stateLayers === 0) {
      this.draw(w, h, params)
      return
    }
    const target = this.drawWithFeedback('preview', w, h, params)
    const { gl } = this
    this.presentProgram ??= linkProgram(gl, PRESENT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.presentProgram)
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, target)
    gl.uniform1i(gl.getUniformLocation(this.presentProgram, 'source'), 7)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Forgets the previous frames and per-pixel state, so trails start from black and state from 0. */
  resetFeedback() {
    for (const key of ['led', 'preview'] as const) {
      freePingPong(this.gl, this.feedback[key])
      this.feedback[key] = null
    }
  }

  /** Runs the frame pass once per LED tick, so the LED and preview passes read one history. A program without one draws nothing. */
  renderGlobalState(params: FrameParams) {
    const { gl, framePass, globalState } = this
    if (!framePass || !globalState) return
    globalState.bindTarget()
    gl.useProgram(framePass.program)
    this.bindInputs(framePass.uniforms, globalState.width, 1, params)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    globalState.swap()
    // a preview without feedback draws into whatever is bound, which must be the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Reads the probe texels back after the LED pass, four floats each, into the array made at compile; null without a frame pass. */
  readProbes(): Float32Array | null {
    const { framePass, globalState } = this
    if (!framePass || !globalState) return null
    globalState.read(framePass.probeTexels, framePass.probes)
    return framePass.probes
  }

  /** Renders one pixel per LED and returns r, g, b per LED as 0..1 floats, as `LedTarget.read` describes. */
  renderLeds(params: FrameParams): Float32Array {
    const n = params.ledCount
    if (this.usesFeedback || this.stateLayers > 0) this.drawWithFeedback('led', n, 1, params)
    else {
      this.led.bind(n)
      this.draw(n, 1, params)
    }
    return this.led.read(n)
  }

  /** Draws into the target that does not hold the last frame, which the shader reads as iPrevFrame. Leaves that target bound. */
  private drawWithFeedback(pass: 'led' | 'preview', width: number, height: number, params: FrameParams): WebGLTexture {
    const { gl } = this
    let pair = this.feedback[pass]
    if (!pair || pair.width !== width || pair.height !== height) {
      freePingPong(this.gl, pair)
      pair = this.feedback[pass] = createPingPong(gl, width, height, this.floatTargets, this.stateLayers)
    }
    const target = pair.latest === 0 ? 1 : 0
    gl.bindFramebuffer(gl.FRAMEBUFFER, pair.framebuffers[target])
    this.draw(width, height, params, pair.textures[pair.latest], pair.states?.[pair.latest])
    pair.latest = target
    return pair.textures[target]
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private draw(width: number, height: number, p: FrameParams, previous: WebGLTexture | null = null, previousState?: WebGLTexture) {
    const { gl, program, uniforms: u } = this
    if (!program) return
    gl.useProgram(program)
    this.bindInputs(u, width, height, p)
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, previous)
    gl.uniform1i(u.iPrevFrame ?? null, 7)
    if (previousState) {
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, previousState)
      gl.uniform1i(u.iState ?? null, 14)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** What the frame and pixel passes both read: the viewport, the input textures, global state and the per-frame uniforms. */
  private bindInputs(u: UniformLocations, width: number, height: number, p: FrameParams) {
    const { gl } = this
    gl.viewport(0, 0, width, height)
    this.audio.bind(u)
    this.images.bind(u)
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, this.layoutTex)
    gl.uniform1i(u.iLayout ?? null, 6)
    if (this.framePass) this.globalState?.bind(u.iGlobal ?? null)
    gl.uniform1f(u.iTimeDelta ?? null, p.dt ?? 1 / 60)
    gl.uniform1f(u.iLayoutCount ?? null, this.layoutCount)
    gl.uniform3f(u.iResolution ?? null, width, height, 1)
    gl.uniform1f(u.iTime ?? null, p.time)
    gl.uniform1i(u.iFrame ?? null, p.frame)
    gl.uniform1f(u.iLedCount ?? null, p.ledCount)
    gl.uniform1f(u.iScanY ?? null, p.scanY)
    if (this.controls && u.iControl) gl.uniform4fv(u.iControl, this.controls)
  }
}

export interface FrameParams {
  time: number
  /** Seconds since this kind of frame (preview or LED) was last drawn; feedback decays by it. Defaults to 1/60. */
  dt?: number
  frame: number
  ledCount: number
  scanY: number
}
