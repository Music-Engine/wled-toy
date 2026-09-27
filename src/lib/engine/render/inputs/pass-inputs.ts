import { AudioInputs } from './audio-inputs'
import { createTexture } from '@/lib/engine/render/gl-texture'
import type { GlobalPass } from '@/lib/engine/render/global-pass'
import { ImageInputs } from './image-inputs'
import type { UniformLocations } from '@/lib/engine/render/renderer-shaders'
import type { FrameParams } from '@/lib/engine/render/renderer'

/** What frame and pixel passes read: viewport, input textures, global state, per-frame uniforms */
export class PassInputs {
  readonly audio: AudioInputs
  readonly images: ImageInputs
  private readonly layoutTexture: WebGLTexture
  private layoutCount = 0
  private controls: Float32Array | null = null

  constructor(private readonly gl: WebGL2RenderingContext, private readonly global: GlobalPass) {
    this.audio = new AudioInputs(gl)
    this.images = new ImageInputs(gl)
    // Float positions unfilterable w/o extension, and fetched per LED anyway
    this.layoutTexture = createTexture(gl, 6, gl.CLAMP_TO_EDGE, gl.NEAREST)
  }

  /** x, y, z, segment per LED in wire order; null = plain strip along the scanline */
  setLayout(positions: Float32Array | null) {
    const { gl } = this
    this.layoutCount = positions ? positions.length / 4 : 0
    if (!positions) return
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, this.layoutTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.layoutCount, 1, 0, gl.RGBA, gl.FLOAT, positions)
  }

  /** `iControl` values, four floats per vec4, applied on every draw until replaced */
  setControls(block: Float32Array) {
    this.controls = block
  }

  /** Binds only what the pass declares */
  readonly bind = (uniforms: UniformLocations, width: number, height: number, params: FrameParams) => {
    const { gl } = this
    gl.viewport(0, 0, width, height)
    this.audio.bind(uniforms)
    this.images.bind(uniforms)
    if (uniforms.iLayout) {
      gl.activeTexture(gl.TEXTURE6)
      gl.bindTexture(gl.TEXTURE_2D, this.layoutTexture)
      gl.uniform1i(uniforms.iLayout, 6)
    }
    if (uniforms.iGlobal) this.global.bindLatest(uniforms.iGlobal)
    gl.uniform1f(uniforms.iTimeDelta ?? null, params.dt ?? 1 / 60)
    gl.uniform1f(uniforms.iLayoutCount ?? null, this.layoutCount)
    gl.uniform3f(uniforms.iResolution ?? null, width, height, 1)
    gl.uniform1f(uniforms.iTime ?? null, params.time)
    gl.uniform1i(uniforms.iFrame ?? null, params.frame)
    gl.uniform1f(uniforms.iLedCount ?? null, params.ledCount)
    gl.uniform1f(uniforms.iScanY ?? null, params.scanY)
    if (this.controls && uniforms.iControl) gl.uniform4fv(uniforms.iControl, this.controls)
  }
}
