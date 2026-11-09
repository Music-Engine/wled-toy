import { createTexture } from './gl-texture'

/** Two targets of one size: a pass draws into one while reading what it drew last time from the other. */
export interface PingPong {
  textures: [WebGLTexture, WebGLTexture]
  framebuffers: [WebGLFramebuffer, WebGLFramebuffer]
  width: number
  height: number
  /** Which of the two holds the last finished frame. */
  latest: 0 | 1
  /** Per-pixel state beside each color target, a layer per `outStateN`; null when the shader keeps none. */
  states: [WebGLTexture, WebGLTexture] | null
}

export function createPingPong(gl: WebGL2RenderingContext, width: number, height: number, floatTargets: boolean, stateLayers: number): PingPong {
  const side = () => {
    const texture = createTexture(gl, 7)
    if (floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { texture, framebuffer, state: stateLayers > 0 ? attachState(gl, width, height, stateLayers) : null }
  }
  const [a, b] = [side(), side()]
  const states: PingPong['states'] = a.state && b.state ? [a.state, b.state] : null
  return { textures: [a.texture, b.texture], framebuffers: [a.framebuffer, b.framebuffer], width, height, latest: 0, states }
}

/** Attaches a state array to the bound framebuffer, layer k as color attachment k + 1, where `outState<k + 1>` lands. */
function attachState(gl: WebGL2RenderingContext, width: number, height: number, stateLayers: number): WebGLTexture {
  const texture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE14)
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture)
  // WebGL zero-fills new storage, which is the 0 every state starts from
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32F, width, height, stateLayers)
  // 32-bit floats are not filterable without an extension, and a LINEAR filter would leave the array incomplete
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  const buffers: number[] = [gl.COLOR_ATTACHMENT0]
  for (let layer = 0; layer < stateLayers; layer++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1 + layer, texture, 0, layer)
    buffers.push(gl.COLOR_ATTACHMENT1 + layer)
  }
  // draw buffers belong to the framebuffer, so this is set once here and not per frame
  gl.drawBuffers(buffers)
  return texture
}

export function freePingPong(gl: WebGL2RenderingContext, pair: PingPong | null) {
  pair?.textures.forEach((t) => gl.deleteTexture(t))
  pair?.framebuffers.forEach((f) => gl.deleteFramebuffer(f))
  pair?.states?.forEach((t) => gl.deleteTexture(t))
}
