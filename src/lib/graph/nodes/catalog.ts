import { NODES, type GlslType, type Param, type ShaderNode } from '@/lib/shader/glsl'
import { Color, defineNode, Float, GenType, Int, Sampler2D, Vec2, Vec3, Vec4, type DataType, type InputDef, type NodeItem } from '@/lib/graph/authoring'

const paramType = (param: Pick<Param, 'type' | 'isColor'>) => (param.isColor ? Color : typeForGlsl(param.type))

// these have a graph node of their own (ported from the three.js shader editor), which wins
const replaced = [
  'brightnessContrast', 'checkerboard', 'noise', 'image', 'hsv2rgb', 'rgb2hsv', 'gammaCorrect', 'clamp', 'remap', 'random',
  'tile', 'polar', 'mirror', 'fromCenter', 'rotate2d',
  // Math has every one of these as an operation
  'sin', 'cos', 'abs', 'floor', 'fract', 'mod', 'min', 'max', 'pow', 'exp', 'sqrt', 'atan', 'step', 'saturate',
  // Vector Math, Wave, Mapping + Image Texture, Palette presets, Hue/Saturation/Value, the noise textures and Time
  'length', 'distance', 'dot', 'normalize', 'mix',
  'sawWave', 'triangleWave', 'squareWave', 'sineWave', 'easeInOut', 'bounce', 'pulse',
  'imageScroll', 'imagePixelate', 'imageMirror', 'imageZoom', 'imageLuma',
  'rainbow', 'heatColor', 'hueShift', 'saturation', 'hash', 'fbm', 'voronoi',
  // the Audio node and its samplers cover these
  'fft', 'fftLog', 'waveform', 'band', 'bass', 'mid', 'treble', 'energy', 'beat',
]

// the Time node covers iTime and iFrame on both sides
export const CATALOG_UNIFORMS: NodeItem[] = NODES.filter((node) => node.kind === 'uniform' && node.name !== 'iTime' && node.name !== 'iFrame').map(uniformItem)

export const CATALOG_FUNCTIONS: NodeItem[] = NODES.filter((node) => node.kind === 'function' && !replaced.includes(node.name)).map(functionItem)

function functionItem(fn: ShaderNode): NodeItem {
  return defineNode(fn.name, {
    title: fn.title,
    description: fn.doc,
    category: fn.category,
    signature: fn.signature,
    input: Object.fromEntries(fn.params.map((param) => [param.name, inputFor(param)])),
    output: { out: { type: paramType(fn.output), label: fn.output.label } },
    pixel: (input, ctx) => {
      // a function that takes a sampler samples it, and only GLSL has textures
      if (fn.params.some((param) => param.type === 'sampler2D')) ctx.require('glsl')
      const args = fn.params.map((param) => input[param.name].expr)
      return { out: ctx.declare(fn.returns === 'genType' ? ctx.gen : fn.returns, `${fn.name}(${args.join(', ')})`) }
    },
  })
}

function uniformItem(uniform: ShaderNode): NodeItem {
  return defineNode(uniform.name, {
    title: uniform.title,
    description: uniform.doc,
    category: uniform.category,
    signature: uniform.signature,
    input: {},
    output: { out: { type: typeForGlsl(uniform.returns), label: uniform.output.label } },
    pixel: () => ({ out: { expr: uniform.name, type: uniform.returns } }),
  })
}

function inputFor(param: Param): InputDef {
  const range = param.min === undefined ? undefined : { min: param.min, max: param.max }
  return { type: paramType(param), label: param.label, default: unlinkedDefault(param), props: range }
}

function unlinkedDefault(param: Param): unknown {
  // a default that is not a literal is GLSL the socket evaluates to while unlinked, e.g. `uv.x` or `iTime`
  if (typeof param.default === 'string') return { expr: param.default, label: param.default }
  // a texture with nothing linked samples the loaded image
  if (param.default === undefined && param.type === 'sampler2D') return { expr: 'iImage', label: 'image' }
  return param.default
}

/** Every GLSL type the catalog uses has a graph type of the same id. */
function typeForGlsl(glsl: GlslType): DataType<any, any, any> {
  const type = [Float, Int, Vec2, Vec3, Vec4, Sampler2D, GenType].find((t) => t.id === glsl)
  if (!type) throw new Error(`No graph type for GLSL type ${glsl}`)
  return type
}
