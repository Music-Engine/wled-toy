import type { Features } from '@/lib/audio/dsp'
import type { AudioTextures } from '@/lib/audio/textures'
import { PRELUDE } from '@/lib/shader/prelude'
import { EngineError } from '@/lib/engine/engine-error'
import { FeedbackPasses } from './feedback-passes'
import { FramePass, type FrameSource } from './frame-pass'
import { bindFullScreenTriangle, linkProgram } from './gl-program'
import { GlobalPass } from './global-pass'
import { PassInputs } from './inputs/pass-inputs'
import { LedTarget } from './led-target'
import { UNIFORMS, type UniformLocations } from './renderer-shaders'

export class ShaderRenderer {
  private readonly gl: WebGL2RenderingContext
  private program: WebGLProgram | null = null
  private uniforms: UniformLocations = {}
  private readonly inputs: PassInputs
  private readonly led: LedTarget
  private readonly feedback: FeedbackPasses
  private readonly global: GlobalPass
  // Half floats keep a long fade smooth; 8 bits stall once a step rounds to nothing
  private readonly floatTargets: boolean

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new EngineError('webgl-unavailable', 'WebGL2 is not supported in this browser')
    this.gl = gl

    bindFullScreenTriangle(gl)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float')

    this.led = new LedTarget(gl, this.floatTargets)
    this.global = new GlobalPass(gl)
    this.inputs = new PassInputs(gl, this.global)
    this.feedback = new FeedbackPasses(gl, this.floatTargets, this.draw)
  }

  get ready() {
    return this.program !== null
  }

  /** Bins per `iAudioSpectra` row this GPU holds */
  get spectraWidth() {
    return this.inputs.audio.spectraWidth
  }

  /** Throws the GLSL info log and keeps the prev program on failure */
  compile(userCode: string, frame?: FrameSource): number {
    const { gl } = this
    const t0 = performance.now()
    const stateLayers = this.countStateLayers(userCode, frame)
    const framePass = frame ? new FramePass(gl, frame) : null
    let program: WebGLProgram
    try {
      program = linkProgram(gl, PRELUDE + userCode)
    } catch (e) {
      if (framePass) gl.deleteProgram(framePass.program)
      throw e
    }
    if (this.program) gl.deleteProgram(this.program)
    this.program = program
    this.global.replacePass(framePass, frame?.texels ?? 0)
    this.feedback.setProgram(userCode, stateLayers)
    this.uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]))
    return performance.now() - t0
  }

  setImage(image: TexImageSource) {
    this.inputs.images.setImage(image)
  }

  /** Resampled to the layer size; sampled by 0..1 coordinates, so its shape survives */
  setImageLayer(layer: number, image: CanvasImageSource) {
    this.inputs.images.setLayer(layer, image)
  }

  setLayout(positions: Float32Array | null) {
    this.inputs.setLayout(positions)
  }

  setControls(block: Float32Array) {
    this.inputs.setControls(block)
  }

  /** `extra`: FFT nodes' analyses from slot 1; `features` fills iAudioFeatures */
  setAudio(audio: AudioTextures, extra: AudioTextures[] = [], features: Features | null = null) {
    this.inputs.audio.upload(audio, extra, features)
  }

  setAudioReads(features: boolean, spectraSlots: readonly number[]) {
    this.inputs.audio.setReads(features, spectraSlots)
  }

  /** `maxHeight` caps rows shaded, width following the canvas's shape; 0 = every display pixel */
  renderPreview(params: FrameParams, maxHeight = 0) {
    const { canvas } = this
    const displayHeight = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio))
    const height = maxHeight ? Math.min(maxHeight, displayHeight) : displayHeight
    const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio * height / displayHeight))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    if (!this.feedback.isActive) {
      this.draw(width, height, params)
      return
    }
    this.feedback.draw('preview', width, height, params)
    this.feedback.present()
  }

  /** Trails restart from black, pixel state from 0 */
  resetFeedback() {
    this.feedback.reset()
  }

  /** Once per LED tick, so LED and preview passes read one history; no-op w/o a frame pass */
  renderGlobalState(params: FrameParams) {
    this.global.drawPass(this.inputs.bind, params)
  }

  /** Probe texels the last `renderLeds` read back, four floats each; null w/o a frame pass */
  readProbes(): Float32Array | null {
    return this.global.readProbes()
  }

  /** Zeroes these floats of global state, or all of it */
  clearGlobalState(floats?: readonly number[]) {
    this.global.clearFloats(floats)
  }

  /** r, g, b per LED as 0..1, in an array the next call reuses; probes ride the same readback */
  renderLeds(params: FrameParams): Float32Array {
    const leds = params.ledCount
    let drawn: WebGLFramebuffer
    if (this.feedback.isActive) drawn = this.feedback.draw('led', leds, 1, params)
    else {
      drawn = this.led.bind(leds)
      this.draw(leds, 1, params)
    }
    return this.led.read(leds, drawn, this.global.readProbeSource())
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  /** Throws unless outState indices run from 1 and the GPU can keep the state asked for */
  private countStateLayers(userCode: string, frame: FrameSource | undefined): number {
    const indices = [...new Set(Array.from(userCode.matchAll(/\boutState([1-3])\b/g), (m) => Number(m[1])))].sort()
    // Layer k = attachment k + 1, so a gap leaves an output nowhere to land
    if (indices.some((index, i) => index !== i + 1)) throw new EngineError('state-outputs', `outState indices must be contiguous from 1, found ${indices.join(', ')}`)
    if (indices.length > 0 && !this.floatTargets) throw new EngineError('no-float-targets', 'this GPU cannot keep per-pixel state')
    if (frame && !this.floatTargets) throw new EngineError('no-float-targets', 'this GPU cannot keep global state')
    return indices.length
  }

  private readonly draw = (width: number, height: number, params: FrameParams, previous: WebGLTexture | null = null, previousState?: WebGLTexture) => {
    const { gl, program, uniforms } = this
    if (!program) return
    gl.useProgram(program)
    this.inputs.bind(uniforms, width, height, params)
    if (uniforms.iPrevFrame) {
      gl.activeTexture(gl.TEXTURE7)
      gl.bindTexture(gl.TEXTURE_2D, previous)
      gl.uniform1i(uniforms.iPrevFrame, 7)
    }
    if (previousState) {
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, previousState)
      gl.uniform1i(uniforms.iState ?? null, 14)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}

export interface FrameParams {
  time: number
  /** Seconds since this kind of frame (preview or LED) was last drawn; feedback decays by it. Default 1/60 */
  dt?: number
  frame: number
  ledCount: number
  scanY: number
}
