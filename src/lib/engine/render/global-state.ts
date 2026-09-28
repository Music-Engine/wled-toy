/**
 * A program's global state: one RGBA32F texel per four slots, N by 1, in two copies so the frame pass reads the last
 * tick's values while it writes this tick's. The pixel passes read the latest copy on texture unit 15.
 */
export class GlobalState {
  private copies: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] = []
  private latest = 0
  /** Texels in each copy, 0 until a program first reserves some. */
  width = 0

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Makes room for `texels`, starting at 16 and doubling, and keeps every value written so far. */
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

  /** The framebuffer of the copy holding the latest values. */
  get latestFramebuffer(): WebGLFramebuffer {
    return this.copies[this.latest].framebuffer
  }

  /** Binds the copy that does not hold the latest values for the frame pass to draw into. */
  bindTarget() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.copies[1 - this.latest].framebuffer)
  }

  /** Makes the copy the frame pass just drew the latest. */
  swap() {
    this.latest = 1 - this.latest
  }

  /** Binds the latest values to unit 15 as `iGlobal`. */
  bind(location: WebGLUniformLocation | null) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, this.copies[this.latest].texture)
    gl.uniform1i(location, 15)
  }

  /** Reads the latest RGBA of each texel in `texels` into `out`, four floats apiece in the same order. */
  read(texels: readonly number[], out: Float32Array) {
    const { gl } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.copies[this.latest].framebuffer)
    for (let i = 0; i < texels.length; i++) gl.readPixels(texels[i], 0, 1, 1, gl.RGBA, gl.FLOAT, out, i * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Zeroes each of `floats` in both copies, four floats to a texel, so a frame pass that does not draw a texel leaves it at 0. */
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

  /** Zeroes every texel of both copies. */
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
    const texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    // WebGL zero-fills new storage, which is the 0 every slot starts from
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, 1)
    // 32-bit floats are not filterable without an extension, and a LINEAR filter would leave the texture incomplete
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    return { texture, framebuffer }
  }
}

const ZERO = new Float32Array(4)
