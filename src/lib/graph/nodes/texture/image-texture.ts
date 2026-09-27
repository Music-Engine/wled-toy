import { IMAGE_LAYERS, IMAGE_LAYER_SIZE } from '@/lib/shader/prelude'
import { Color, defineNode, Enum, Float, Reference, resourceIndex } from '@/lib/graph/authoring'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'
import { colorChunk } from './chunks/image-texture-chunk'

const INTERPOLATIONS = [{ value: 'linear', label: 'Linear' }, { value: 'closest', label: 'Closest' }] as const
const EXTENSIONS = [{ value: 'repeat', label: 'Repeat' }, { value: 'extend', label: 'Extend' }, { value: 'mirror', label: 'Mirror' }] as const
const COLOR_SPACES = [{ value: 'linear', label: 'Linear' }, { value: 'srgb', label: 'sRGB' }, { value: 'nonColor', label: 'Non-Color' }] as const
const ALPHA_MODES = [
  { value: 'straight', label: 'Straight' }, { value: 'premultiplied', label: 'Premultiplied' }, { value: 'channelPacked', label: 'Channel Packed' }, { value: 'none', label: 'None' },
] as const

export const imageTextureNode = defineNode('imageTexture', {
  title: 'Image Texture',
  description: `Samples an image from the library: open a file, link a URL, or pick one you added before. A graph can show up to ${IMAGE_LAYERS} different images.`,
  category: 'image',
  includes: [colorChunk],
  input: {
    // the library id of the image; the node's file selector edits it, so no widget. Empty is the built-in image.
    filename: { type: Reference, label: '', default: '', linkable: false },
    interpolation: { type: Enum(INTERPOLATIONS), label: 'Interpolation', linkable: false, props: { label: 'Interpolation' } },
    extension: { type: Enum(EXTENSIONS), label: 'Extension', linkable: false, props: { label: 'Extension' } },
    colorSpace: { type: Enum(COLOR_SPACES), label: 'Color Space', linkable: false, props: { label: 'Color Space' } },
    alphaMode: { type: Enum(ALPHA_MODES), label: 'Alpha', linkable: false, props: { label: 'Alpha' } },
    vector: textureVector,
  },
  output: { color: Color, alpha: Float },
  resolve: ({ filename }, resources) => {
    const requires = [{ kind: 'image', config: filename }]
    const layer = resourceIndex(resources, 'image', filename)
    if (layer < IMAGE_LAYERS) return { requires, data: { layer } }
    return { requires, data: { layer: 0 }, issues: [`A graph can show ${IMAGE_LAYERS} different images; this one shows the first instead`] }
  },
  body: ({ interpolation, extension, colorSpace, alphaMode, vector }, ctx) => {
    const layer = ctx.resolved.layer as number
    ctx.require('glsl')
    const p = ctx.declare('vec2', `${vector.expr}.xy`, 'p').expr
    const st = ctx.declare('vec2', extension === 'repeat' ? `fract(${p})` : extension === 'mirror' ? `1.0 - abs(mod(${p}, 2.0) - 1.0)` : `clamp(${p}, 0.0, 1.0)`, 'st').expr
    // images are stored top row first, the shader's y points up
    const flipped = `vec2(${st}.x, 1.0 - ${st}.y)`
    const texel = ctx.declare('vec4', interpolation === 'closest'
      ? `texelFetch(iImages, ivec3(min(ivec2(${flipped} * ${IMAGE_LAYER_SIZE}.0), ivec2(${IMAGE_LAYER_SIZE - 1})), ${layer}), 0)`
      : `texture(iImages, vec3(${flipped}, ${layer}.0))`, 'texel').expr
    // a premultiplied file stores color times alpha; the graph works with straight color
    const rgb = alphaMode === 'premultiplied' ? `${texel}.rgb / max(${texel}.a, 0.0001)` : `${texel}.rgb`
    return {
      color: ctx.declare('vec3', colorSpace === 'srgb' ? `color_srgb_to_scene_linear(${rgb})` : rgb),
      alpha: ctx.declare('float', alphaMode === 'none' ? '1.0' : `${texel}.a`, 'alpha'),
    }
  },
})
