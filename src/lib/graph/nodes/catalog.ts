import { NODES, type Param, type ShaderNode } from '@/lib/shader/glsl'
import { defineNode } from '@/lib/graph/define/define'
import type { LinkedInputDef, NodeItem } from '@/lib/graph/define/node'
import { Color, typeForGlsl } from '@/lib/graph/define/types'

const paramType = (param: Pick<Param, 'type' | 'isColor'>) => (param.isColor ? Color : typeForGlsl(param.type))

function inputFor(param: Param): LinkedInputDef {
  // a default that is not a literal is GLSL the socket evaluates to while unlinked, e.g. `uv.x` or `iTime`
  const fallback = typeof param.default === 'string' ? { expr: param.default, label: param.default } : param.default
  const range = param.min === undefined ? undefined : { min: param.min, max: param.max }
  return { type: paramType(param), label: param.label, default: fallback, props: range }
}

function functionItem(fn: ShaderNode): NodeItem {
  return defineNode(fn.name, {
    title: fn.title,
    description: fn.doc,
    category: fn.category,
    signature: fn.signature,
    input: Object.fromEntries(fn.params.map((param) => [param.name, inputFor(param)])),
    output: { out: { type: paramType(fn.output), label: fn.output.label } },
    exec: (input, ctx) => {
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
    exec: () => ({ out: { expr: uniform.name, type: uniform.returns } }),
  })
}

// the Time node covers iTime and iFrame on both sides
export const CATALOG_UNIFORMS: NodeItem[] = NODES.filter((node) => node.kind === 'uniform' && node.name !== 'iTime' && node.name !== 'iFrame').map(uniformItem)
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

export const CATALOG_FUNCTIONS: NodeItem[] = NODES.filter((node) => node.kind === 'function' && !replaced.includes(node.name)).map(functionItem)
