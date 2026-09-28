import { createTexture } from './gl-texture'

/** The LED pass's own target, one pixel per LED, for shaders without feedback; and the readback of whichever target the pass drew into. */
export class LedTarget {
  private readonly texture: WebGLTexture
  private readonly framebuffer: WebGLFramebuffer
  private width = 0
  private floats = new Float32Array(0)
  private rgba = new Uint8Array(0)
  private colors = new Float32Array(0)
  // the LED row and the probes in 32-bit floats, made once a program has probes
  private floatRow: { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number } | null = null

  constructor(private readonly gl: WebGL2RenderingContext, private readonly floatTargets: boolean) {
    this.texture = createTexture(gl, 2)
    this.framebuffer = gl.createFramebuffer()
  }

  /** Sizes the target to `n` LEDs and binds it for drawing; returns its framebuffer. */
  bind(n: number): WebGLFramebuffer {
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
    return this.framebuffer
  }

  /**
   * r, g, b per LED as 0..1 floats from `drawn`, the bound framebuffer the LED pass drew into, which it then unbinds. With float targets these keep the
   * precision the shader computed, which dithering downstream needs; otherwise they are the 8-bit values over 255. With
   * `probes`, their texels come back in the same readPixels, from columns past the LEDs of a float copy of the row.
   * The array is reused by the next read, so a caller that keeps the colors copies them.
   */
  read(n: number, drawn: WebGLFramebuffer, probes: ProbeSource | null = null): Float32Array {
    const { gl } = this
    if (this.colors.length !== n * 3) this.colors = new Float32Array(n * 3)
    const out = this.colors
    if (this.floatTargets) {
      const width = probes ? this.copyLedsAndProbesToFloatRow(n, drawn, probes) : n
      if (this.floats.length !== width * 4) this.floats = new Float32Array(width * 4)
      gl.readPixels(0, 0, width, 1, gl.RGBA, gl.FLOAT, this.floats)
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = this.floats[i * 4 + c]
      if (probes) probes.out.set(this.floats.subarray(n * 4))
    } else {
      if (this.rgba.length !== n * 4) this.rgba = new Uint8Array(n * 4)
      gl.readPixels(0, 0, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba)
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = this.rgba[i * 4 + c] / 255
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out
  }

  /**
   * Copies the LED row from `drawn` and each probe texel after it into a 32-bit float row, which a half float target
   * could not hold the probes in, and leaves that row bound for reading. Returns the row's width.
   */
  private copyLedsAndProbesToFloatRow(n: number, drawn: WebGLFramebuffer, { framebuffer, texels }: ProbeSource): number {
    const { gl } = this
    const width = n + texels.length
    if (this.floatRow?.width !== width) {
      if (this.floatRow) gl.deleteTexture(this.floatRow.texture)
      const texture = gl.createTexture()
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, 1)
      const rowFramebuffer = this.floatRow?.framebuffer ?? gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, rowFramebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      this.floatRow = { texture, framebuffer: rowFramebuffer, width }
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, drawn)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.floatRow.framebuffer)
    gl.blitFramebuffer(0, 0, n, 1, 0, 0, n, 1, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer)
    for (let i = 0; i < texels.length; i++) gl.blitFramebuffer(texels[i], 0, texels[i] + 1, 1, n + i, 0, n + i + 1, 1, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.floatRow.framebuffer)
    return width
  }
}

/** Probe texels to read back with the LEDs: where they are, which texels, and the array they land in, four floats each. */
export interface ProbeSource {
  framebuffer: WebGLFramebuffer
  texels: readonly number[]
  out: Float32Array
}
