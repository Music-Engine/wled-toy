import { EngineError } from '@/lib/engine/engine-error'
import { VERT } from './renderer-shaders'

/** The one triangle every pass draws, covering the viewport; `VERT` reads it as attribute 0. */
export function bindFullScreenTriangle(gl: WebGL2RenderingContext) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
}

/** Links the full-screen triangle's vertex shader with `fragment`; throws the info log on a compile or link failure. */
export function linkProgram(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment)
  const program = gl.createProgram()
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'p')
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? 'link failed'
    gl.deleteProgram(program)
    throw new EngineError('shader-link', info)
  }
  return program
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new EngineError('shader-create', 'createShader failed')
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'compile failed'
    gl.deleteShader(shader)
    throw new EngineError('shader-compile', info)
  }
  return shader
}
