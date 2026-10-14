import type { FramePass } from './frame-pass'
import { GlobalState } from './global-state'
import type { ProbeSource } from './led-target'
import type { UniformLocations } from './renderer-shaders'

/** Binds uniforms, input textures and global state, as for the renderer's own passes */
type BindInputs<P> = (uniforms: UniformLocations, width: number, height: number, params: P) => void

/** Frame pass and the global state it draws into; state outlives the pass, so a recompile keeping slots keeps values */
export class GlobalPass {
  private pass: FramePass | null = null
  private state: GlobalState | null = null
  // Built once per pass so the LED readback allocates nothing per tick
  private probeSource: ProbeSource | null = null

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Deletes the prev pass and grows global state to fit */
  replacePass(pass: FramePass | null, texels: number) {
    if (this.pass) this.gl.deleteProgram(this.pass.program)
    this.pass = pass
    if (pass) (this.state ??= new GlobalState(this.gl)).reserve(texels)
    this.probeSource =
      pass && this.state && pass.probeTexels.length > 0 ? { framebuffer: this.state.latestFramebuffer, texels: pass.probeTexels, out: pass.probes } : null
  }

  drawPass<P>(bind: BindInputs<P>, params: P) {
    const { gl, pass, state } = this
    if (!pass || !state) return
    state.bindTarget()
    gl.useProgram(pass.program)
    // Program's texels only: the rest hold no slot, zero in both copies since freed
    bind(pass.uniforms, pass.texels, 1, params)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    state.swap()
    if (this.probeSource) this.probeSource.framebuffer = state.latestFramebuffer
    // Preview w/o feedback draws into whatever is bound, which must be the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Latest global state as `iGlobal`, while there is a frame pass */
  bindLatest(location: WebGLUniformLocation | null) {
    if (this.pass) this.state?.bind(location)
  }

  /** Where the LED readback takes probes from */
  readProbeSource(): ProbeSource | null {
    return this.probeSource
  }

  /** Four floats per probe texel from the last LED readback; null w/o a frame pass */
  readProbes(): Float32Array | null {
    return this.pass?.probes ?? null
  }

  /** Zeroes these floats, or all */
  clearFloats(floats?: readonly number[]) {
    if (!floats) this.state?.clearAll()
    else this.state?.clear(floats)
  }
}
