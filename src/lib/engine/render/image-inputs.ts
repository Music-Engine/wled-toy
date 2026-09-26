import { IMAGE_LAYERS, IMAGE_LAYER_SIZE } from '@/lib/shader/prelude'
import { createTexture } from './gl-texture'
import type { UniformLocations } from './renderer-shaders'

/** The image textures a shader samples: the legacy `iImage` on unit 1 and the `iImages` layers on unit 2. */
export class ImageInputs {
  private readonly imageTex: WebGLTexture
  private readonly layersTex: WebGLTexture

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.imageTex = createTexture(gl, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 40, 40, 255]))
    // unit 2 only ever held the LED render target, which is never sampled, so the image layers can live there
    this.layersTex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layersTex)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE, IMAGE_LAYERS)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // how an image continues past its edge is the node's choice, made on the coordinates in the shader
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  setImage(img: TexImageSource) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  }

  /** Puts an image into a layer of `iImages`, resampled to the layer size. Sampling is by 0..1 coordinates, so its shape survives. */
  setLayer(layer: number, image: CanvasImageSource) {
    if (layer < 0 || layer >= IMAGE_LAYERS) return
    const { gl } = this
    const canvas = new OffscreenCanvas(IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE)
    canvas.getContext('2d')!.drawImage(image, 0, 0, IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layersTex)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  }

  bind(u: UniformLocations) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layersTex)
    gl.uniform1i(u.iImages ?? null, 2)
    gl.uniform1i(u.iImage ?? null, 1)
  }
}
