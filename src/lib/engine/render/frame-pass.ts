import { linkProgram } from './gl-program'
import { UNIFORMS, type UniformLocations } from './renderer-shaders'

/** A program's frame pass as a whole fragment shader that writes one texel of global state per fragment. */
export interface FrameSource {
  code: string
  /** Texels of global state the pass needs, four slots each. */
  texels: number
  /** The texel of each probe, in the order the host reads them back. */
  probes: readonly number[]
}

/** A linked frame pass, and the array its probes are read back into, made here so no tick allocates. */
export class FramePass {
  readonly program: WebGLProgram
  readonly uniforms: UniformLocations
  readonly probeTexels: readonly number[]
  readonly probes: Float32Array

  constructor(gl: WebGL2RenderingContext, source: FrameSource) {
    const program = linkProgram(gl, source.code)
    this.program = program
    this.uniforms = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)]))
    this.probeTexels = source.probes
    this.probes = new Float32Array(source.probes.length * 4)
  }
}
