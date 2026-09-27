import { IMAGE_LAYERS, IMAGE_LAYER_SIZE } from '@/lib/shader/prelude'
import { createTexture } from '@/lib/engine/render/gl-texture'
import type { UniformLocations } from '@/lib/engine/render/renderer-shaders'

/** Legacy `iImage` on unit 1, `iImages` layers on unit 2 */
export class ImageInputs {
  private readonly imageTexture: WebGLTexture
  private readonly layersTexture: WebGLTexture

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.imageTexture = createTexture(gl, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 40, 40, 255]))
    // Unit 2 otherwise holds only the never-sampled LED target
    this.layersTexture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layersTexture)
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE, IMAGE_LAYERS)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // Past-edge behaviour is the node's choice, made on shader coordinates
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  setImage(image: TexImageSource) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  }

  /** Resampled to the layer size; sampled by 0..1 coordinates, so its shape survives */
  setLayer(layer: number, image: CanvasImageSource) {
    if (layer < 0 || layer >= IMAGE_LAYERS) return
    const { gl } = this
    const canvas = new OffscreenCanvas(IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE)
    canvas.getContext('2d')!.drawImage(image, 0, 0, IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layersTexture)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, IMAGE_LAYER_SIZE, IMAGE_LAYER_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  }

  /** Only what the program samples */
  bind(uniforms: UniformLocations) {
    const { gl } = this
    if (uniforms.iImage) {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.imageTexture)
      gl.uniform1i(uniforms.iImage, 1)
    }
    if (uniforms.iImages) {
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layersTexture)
      gl.uniform1i(uniforms.iImages, 2)
    }
  }
}
