import { createPingPong, freePingPong, type PingPong } from './feedback-targets'
import { linkProgram } from './gl-program'
import { PRESENT } from './renderer-shaders'
import type { FrameParams } from './renderer'

type DrawPass = (width: number, height: number, params: FrameParams, previous: WebGLTexture | null, previousState?: WebGLTexture) => void

/** LED and preview ping-pong targets for programs that read the last frame or keep pixel state */
export class FeedbackPasses {
  private readonly pairs: { led: PingPong | null; preview: PingPong | null } = { led: null, preview: null }
  private presentProgram: WebGLProgram | null = null
  private readsPrevFrame = false
  private stateLayers = 0

  constructor(private readonly gl: WebGL2RenderingContext, private readonly floatTargets: boolean, private readonly drawPass: DrawPass) {}

  get isActive() {
    return this.readsPrevFrame || this.stateLayers > 0
  }

  /** Only shaders that look back pay for the extra targets */
  setProgram(userCode: string, stateLayers: number) {
    this.readsPrevFrame = /\b(iPrevFrame|previousFrame)\b/.test(userCode)
    this.stateLayers = stateLayers
    this.reset()
  }

  /** Draws into the target not holding the last frame (read as iPrevFrame); leaves it bound */
  draw(pass: 'led' | 'preview', width: number, height: number, params: FrameParams): WebGLFramebuffer {
    const { gl } = this
    let pair = this.pairs[pass]
    if (!pair || pair.width !== width || pair.height !== height) {
      freePingPong(gl, pair)
      pair = this.pairs[pass] = createPingPong(gl, width, height, this.floatTargets, this.stateLayers)
    }
    const target = pair.latest === 0 ? 1 : 0
    gl.bindFramebuffer(gl.FRAMEBUFFER, pair.framebuffers[target])
    this.drawPass(width, height, params, pair.textures[pair.latest], pair.states?.[pair.latest])
    pair.latest = target
    return pair.framebuffers[target]
  }

  /** Copies the latest preview target to the canvas */
  present() {
    const { gl } = this
    const pair = this.pairs.preview!
    this.presentProgram ??= linkProgram(gl, PRESENT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.presentProgram)
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, pair.textures[pair.latest])
    gl.uniform1i(gl.getUniformLocation(this.presentProgram, 'source'), 7)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Trails restart from black, pixel state from 0 */
  reset() {
    for (const key of ['led', 'preview'] as const) {
      freePingPong(this.gl, this.pairs[key])
      this.pairs[key] = null
    }
  }
}
