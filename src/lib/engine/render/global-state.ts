import { createTexture } from './gl-texture'

/**
 * RGBA32F texel per four slots, N x 1, in two copies: frame pass reads last tick's while writing this one's; pixel
 * passes read the latest on unit 15
 */
export class GlobalState {
  private copies: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] = []
  private latest = 0
  /** Texels per copy, 0 until first reserved */
  width = 0

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Grows from 16 by doubling, keeping every value */
  reserve(texels: number) {
    let width = this.width || 16
    while (width < texels) width *= 2
    if (width === this.width) return
    const { gl } = this
    const copies = [this.createCopy(width), this.createCopy(width)]
    if (this.width) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copies[this.latest].framebuffer)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copies[0].framebuffer)
      gl.blitFramebuffer(0, 0, this.width, 1, 0, 0, this.width, 1, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.copies.forEach(({ texture, framebuffer }) => {
      gl.deleteTexture(texture)
      gl.deleteFramebuffer(framebuffer)
    })
    this.copies = copies
    this.latest = 0
    this.width = width
  }

  get latestFramebuffer(): WebGLFramebuffer {
    return this.copies[this.latest].framebuffer
  }

  /** Copy not holding the latest, for the frame pass to draw into */
  bindTarget() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.copies[1 - this.latest].framebuffer)
  }

  /** Copy just drawn becomes the latest */
  swap() {
    this.latest = 1 - this.latest
  }

  /** Unit 15 as `iGlobal` */
  bind(location: WebGLUniformLocation | null) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, this.copies[this.latest].texture)
    gl.uniform1i(location, 15)
  }

  /** Both copies, so a texel the frame pass skips stays 0 */
  clear(floats: readonly number[]) {
    const { gl } = this
    gl.enable(gl.SCISSOR_TEST)
    for (const { framebuffer } of this.copies) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      for (const float of floats) {
        const component = float % 4
        gl.colorMask(component === 0, component === 1, component === 2, component === 3)
        gl.scissor(Math.floor(float / 4), 0, 1, 1)
        gl.clearBufferfv(gl.COLOR, 0, ZERO)
      }
    }
    gl.colorMask(true, true, true, true)
    gl.disable(gl.SCISSOR_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  clearAll() {
    const { gl } = this
    for (const { framebuffer } of this.copies) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.clearBufferfv(gl.COLOR, 0, ZERO)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private createCopy(width: number) {
    const { gl } = this
    // RGBA32F unfilterable w/o extension: LINEAR would leave it incomplete
    const texture = createTexture(gl, 15, gl.CLAMP_TO_EDGE, gl.NEAREST)
    // Zero-filled storage = the 0 every slot starts from
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, 1)
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    return { texture, framebuffer }
  }
}

const ZERO = new Float32Array(4)
