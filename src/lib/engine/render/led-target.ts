import { createTexture } from './gl-texture'

/** LED pass target (pixel per LED) for shaders w/o feedback, and readback of whichever target the pass drew */
export class LedTarget {
  private readonly texture: WebGLTexture
  private readonly framebuffer: WebGLFramebuffer
  private width = 0
  private floats = new Float32Array(0)
  private rgba = new Uint8Array(0)
  private colors = new Float32Array(0)
  // LED row and probes in 32-bit floats, made once a program has probes
  private floatRow: { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number } | null = null

  constructor(private readonly gl: WebGL2RenderingContext, private readonly floatTargets: boolean) {
    this.texture = createTexture(gl, 2)
    this.framebuffer = gl.createFramebuffer()
  }

  /** Sized to `leds` and bound for drawing */
  bind(leds: number): WebGLFramebuffer {
    const { gl } = this
    if (this.width !== leds) {
      this.width = leds
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, leds, 1, 0, gl.RGBA, gl.HALF_FLOAT, null)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, leds, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    return this.framebuffer
  }

  /**
   * r, g, b per LED as 0..1 from bound `drawn`, then unbound. Float targets keep shader precision for dithering, else
   * 8-bit over 255. Probes ride the same readPixels past the LEDs. Array reused by the next read: keepers copy
   */
  read(leds: number, drawn: WebGLFramebuffer, probes: ProbeSource | null = null): Float32Array {
    const { gl } = this
    if (this.colors.length !== leds * 3) this.colors = new Float32Array(leds * 3)
    const out = this.colors
    if (this.floatTargets) {
      const width = probes ? this.copyLedsAndProbesToFloatRow(leds, drawn, probes) : leds
      if (this.floats.length !== width * 4) this.floats = new Float32Array(width * 4)
      gl.readPixels(0, 0, width, 1, gl.RGBA, gl.FLOAT, this.floats)
      for (let i = 0; i < leds; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = this.floats[i * 4 + c]
      if (probes) probes.out.set(this.floats.subarray(leds * 4))
    } else {
      if (this.rgba.length !== leds * 4) this.rgba = new Uint8Array(leds * 4)
      gl.readPixels(0, 0, leds, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba)
      for (let i = 0; i < leds; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = this.rgba[i * 4 + c] / 255
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out
  }

  /** LED row then probe texels into a 32-bit float row (half floats can't hold probes), left bound; returns its width */
  private copyLedsAndProbesToFloatRow(leds: number, drawn: WebGLFramebuffer, { framebuffer, texels }: ProbeSource): number {
    const { gl } = this
    const width = leds + texels.length
    const row = this.resizeFloatRow(width)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, drawn)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, row)
    gl.blitFramebuffer(0, 0, leds, 1, 0, 0, leds, 1, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer)
    // One blit per run of adjacent probe texels
    for (let start = 0, end = 1; start < texels.length; start = end++) {
      while (end < texels.length && texels[end] === texels[end - 1] + 1) end++
      gl.blitFramebuffer(texels[start], 0, texels[end - 1] + 1, 1, leds + start, 0, leds + end, 1, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, row)
    return width
  }

  private resizeFloatRow(width: number): WebGLFramebuffer {
    const { gl } = this
    if (this.floatRow?.width === width) return this.floatRow.framebuffer
    if (this.floatRow) gl.deleteTexture(this.floatRow.texture)
    const texture = createTexture(gl, 2)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, 1)
    const framebuffer = this.floatRow?.framebuffer ?? gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    this.floatRow = { texture, framebuffer, width }
    return framebuffer
  }
}

/** Probe texels read back w/ the LEDs, landing in `out`, four floats each */
export interface ProbeSource {
  /** Moves to the latest copy on every frame pass */
  framebuffer: WebGLFramebuffer
  texels: readonly number[]
  out: Float32Array
}
