import type { FramePass } from './frame-pass'
import { GlobalState } from './global-state'
import type { ProbeSource } from './led-target'
import type { UniformLocations } from './renderer-shaders'

/** Binds what a pass reads, as the renderer does for its own passes: the uniforms, the input textures and global state. */
export type BindInputs<P> = (uniforms: UniformLocations, width: number, height: number, params: P) => void

/**
 * The program's frame pass and the global state it draws into. Global state outlives the frame pass, so a recompile
 * that keeps a node's slots keeps its values.
 */
export class GlobalPass {
  private pass: FramePass | null = null
  private state: GlobalState | null = null

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Makes `pass` the one drawn, deleting the previous one, and grows global state to what it needs. */
  replacePass(pass: FramePass | null, texels: number) {
    if (this.pass) this.gl.deleteProgram(this.pass.program)
    this.pass = pass
    if (pass) (this.state ??= new GlobalState(this.gl)).reserve(texels)
  }

  /** Draws the frame pass once, if the program has one. */
  drawPass<P>(bind: BindInputs<P>, params: P) {
    const { gl, pass, state } = this
    if (!pass || !state) return
    state.bindTarget()
    gl.useProgram(pass.program)
    // only the program's texels: the rest are floats no slot holds, zero in both copies since they were freed
    bind(pass.uniforms, pass.texels, 1, params)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    state.swap()
    // a preview without feedback draws into whatever is bound, which must be the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Binds the latest global state as `iGlobal` while the program has a frame pass. */
  bindLatest(location: WebGLUniformLocation | null) {
    if (this.pass) this.state?.bind(location)
  }

  /** Where the LED readback takes the probes from: the latest copy of global state, the probe texels and the array made at link. */
  readProbeSource(): ProbeSource | null {
    const { pass, state } = this
    return pass && state && pass.probeTexels.length > 0 ? { framebuffer: state.latestFramebuffer, texels: pass.probeTexels, out: pass.probes } : null
  }

  /** The probe values the last LED readback took, four floats per probe texel; null without a frame pass. */
  readProbes(): Float32Array | null {
    return this.pass?.probes ?? null
  }

  /** Reads the latest RGBA of each texel in `texels` into `out`, four floats apiece. */
  readTexels(texels: readonly number[], out: Float32Array) {
    this.state?.read(texels, out)
  }

  /** Zeroes these floats of global state, or all of it. */
  clearFloats(floats?: readonly number[]) {
    if (!floats) this.state?.clearAll()
    else this.state?.clear(floats)
  }
}
