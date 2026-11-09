import { linkProgram } from './gl-program'
import { UNIFORMS, type UniformLocations } from './renderer-shaders'

/** Whole fragment shader writing one global state texel per fragment */
export interface FrameSource {
  code: string
  /** Four slots each */
  texels: number
  /** Texel per probe, in readback order */
  probes: readonly number[]
}

/** Linked frame pass w/ its probe readback array, made here so no tick allocates */
export class FramePass {
  readonly program: WebGLProgram
  /** Global state past these is left as is */
  readonly texels: number
  readonly uniforms: UniformLocations
  readonly probeTexels: readonly number[]
  readonly probes: Float32Array

  constructor(gl: WebGL2RenderingContext, source: FrameSource) {
    const program = linkProgram(gl, source.code)
    this.program = program
    this.texels = source.texels
    this.uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]))
    this.probeTexels = source.probes
    this.probes = new Float32Array(source.probes.length * 4)
  }
}
