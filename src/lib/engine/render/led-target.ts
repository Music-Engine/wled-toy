import { createTexture } from './gl-texture'

/** The LED pass's own target, one pixel per LED, for shaders without feedback; and the readback of whichever target the pass drew into. */
export class LedTarget {
  private readonly texture: WebGLTexture
  private readonly framebuffer: WebGLFramebuffer
  private width = 0
  private floats = new Float32Array(0)
  private rgba = new Uint8Array(0)

  constructor(private readonly gl: WebGL2RenderingContext, private readonly floatTargets: boolean) {
    this.texture = createTexture(gl, 2)
    this.framebuffer = gl.createFramebuffer()
  }

  /** Sizes the target to `n` LEDs and binds it for drawing. */
  bind(n: number) {
    const { gl } = this
    if (this.width !== n) {
      this.width = n
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, n, 1, 0, gl.RGBA, gl.HALF_FLOAT, null)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
  }

  /**
   * r, g, b per LED as 0..1 floats from the bound framebuffer, which it then unbinds. With float targets these keep the
   * precision the shader computed, which dithering downstream needs; otherwise they are the 8-bit values over 255.
   */
  read(n: number): Float32Array {
    const { gl } = this
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
}
