import { PRELUDE } from '@/lib/shader/prelude'

/** Same fragment program and one-pixel-per-LED target as ShaderRenderer.renderLeds, three readback modes over one draw */
export class ReadbackProbe {
  readonly floatTargets: boolean
  lateReads = 0
  reads = 0
  private readonly program: WebGLProgram
  private readonly framebuffer: WebGLFramebuffer
  private readonly texture: WebGLTexture
  private readonly packBuffers: [WebGLBuffer, WebGLBuffer]
  private readonly fences: (WebGLSync | null)[] = [null, null]
  private width = 0
  private slot = 0
  private floats = new Float32Array(0)
  private readonly uniforms: Record<string, WebGLUniformLocation | null>

  constructor(
    private readonly gl: WebGL2RenderingContext,
    code: string,
  ) {
    bindProbeTriangle(gl)
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float')
    this.program = linkProbeProgram(gl, PRELUDE + code)
    this.uniforms = Object.fromEntries(
      ['iResolution', 'iTime', 'iFrame', 'iLedCount', 'iScanY', 'iTimeDelta', 'iLayoutCount'].map((name) => [name, gl.getUniformLocation(this.program, name)]),
    )
    this.texture = gl.createTexture()
    this.framebuffer = gl.createFramebuffer()
    this.packBuffers = [gl.createBuffer(), gl.createBuffer()]
  }

  /** Mode a: sync readPixels, as LedTarget.read */
  drawAndReadSync(leds: number, frame: number) {
    this.draw(leds, frame)
    const { gl } = this
    gl.readPixels(0, 0, leds, 1, gl.RGBA, gl.FLOAT, this.floats)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Mode b: submission only, GPU never waited on */
  drawOnly(leds: number, frame: number) {
    this.draw(leds, frame)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
  }

  /** Mode c: pack into a PBO behind a fence, collect prev tick's PBO w/o blocking */
  drawAndReadAsync(leds: number, frame: number) {
    const { gl } = this
    const previous = this.slot
    const next = this.slot ^ 1
    this.draw(leds, frame)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.packBuffers[next])
    gl.readPixels(0, 0, leds, 1, gl.RGBA, gl.FLOAT, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.fences[next] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    this.collectPrevious(previous)
    this.slot = next
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  private draw(leds: number, frame: number) {
    const { gl, uniforms } = this
    this.resize(leds)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.viewport(0, 0, leds, 1)
    gl.useProgram(this.program)
    gl.uniform3f(uniforms.iResolution ?? null, leds, 1, 1)
    gl.uniform1f(uniforms.iTime ?? null, frame / 60)
    gl.uniform1i(uniforms.iFrame ?? null, frame)
    gl.uniform1f(uniforms.iLedCount ?? null, leds)
    gl.uniform1f(uniforms.iScanY ?? null, 0.5)
    gl.uniform1f(uniforms.iTimeDelta ?? null, 1 / 60)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private resize(leds: number) {
    if (this.width === leds) return
    const { gl } = this
    this.width = leds
    this.floats = new Float32Array(leds * 4)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, leds, 1, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, leds, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0)
    for (const buffer of this.packBuffers) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, leds * 4 * 4, gl.STREAM_READ)
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private collectPrevious(previous: number) {
    const { gl } = this
    const fence = this.fences[previous]
    if (!fence) return
    this.reads++
    if (gl.clientWaitSync(fence, gl.SYNC_FLUSH_COMMANDS_BIT, 0) === gl.TIMEOUT_EXPIRED) {
      this.lateReads++
      return
    }
    gl.deleteSync(fence)
    this.fences[previous] = null
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.packBuffers[previous])
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.floats)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
  }
}

/** Full-screen triangle on attribute 0 */
export function bindProbeTriangle(gl: WebGL2RenderingContext) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
}

export function linkProbeProgram(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const program = gl.createProgram()
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, `#version 300 es\nin vec2 p;\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }`))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragment))
  gl.bindAttribLocation(program, 0, 'p')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
  return program
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failed')
  return shader
}
