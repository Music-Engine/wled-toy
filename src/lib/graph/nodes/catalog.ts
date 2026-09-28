import { NODES, type GlslType, type Param, type ShaderNode } from '@/lib/shader/catalog'
import { Color, defineNode, Float, GenType, Int, Sampler2D, Vec2, Vec3, Vec4, type DataType, type InputDef, type NodeItem } from '@/lib/graph/authoring'
import { REPLACED_FUNCTIONS } from './catalog-replaced'

// Time node covers iTime and iFrame
export const CATALOG_UNIFORMS: NodeItem[] = NODES.filter((node) => node.kind === 'uniform' && node.name !== 'iTime' && node.name !== 'iFrame').map(defineUniformItem)

export const CATALOG_FUNCTIONS: NodeItem[] = NODES.filter((node) => node.kind === 'function' && !REPLACED_FUNCTIONS.includes(node.name)).map(defineFunctionItem)

function defineFunctionItem(shaderFunction: ShaderNode): NodeItem {
  return defineNode(shaderFunction.name, {
    title: shaderFunction.title,
    description: shaderFunction.doc,
    category: shaderFunction.category,
    signature: shaderFunction.signature,
    input: Object.fromEntries(shaderFunction.params.map((param) => [param.name, toInputDef(param)])),
    output: { out: { type: toParamType(shaderFunction.output), label: shaderFunction.output.label } },
    // Shader library lives in the prelude, which only the pixel pass has
    varies: 'pixel',
    body: (input, ctx) => {
      const args = shaderFunction.params.map((param) => input[param.name].expr)
      return { out: ctx.declare(shaderFunction.returns === 'genType' ? ctx.gen : shaderFunction.returns, `${shaderFunction.name}(${args.join(', ')})`) }
    },
  })
}

function defineUniformItem(uniform: ShaderNode): NodeItem {
  return defineNode(uniform.name, {
    title: uniform.title,
    description: uniform.doc,
    category: uniform.category,
    signature: uniform.signature,
    input: {},
    output: { out: { type: toGraphType(uniform.returns), label: uniform.output.label } },
    // Frame pass can't hand on a sampler, so readers run per pixel
    ...(uniform.returns === 'sampler2D' && { varies: 'pixel' as const }),
    body: () => ({ out: { expr: uniform.name, type: uniform.returns } }),
  })
}

function toInputDef(param: Param): InputDef {
  const range = param.min === undefined ? undefined : { min: param.min, max: param.max }
  return { type: toParamType(param), label: param.label, default: toUnlinkedDefault(param), props: range }
}

function toUnlinkedDefault(param: Param): unknown {
  // Non-literal default = GLSL the unlinked socket reads, e.g. `uv.x`, `iTime`
  if (typeof param.default === 'string') return { expr: param.default, label: param.default }
  // Unlinked texture samples the loaded image
  if (param.default === undefined && param.type === 'sampler2D') return { expr: 'iImage', label: 'image' }
  return param.default
}

/** Every catalog GLSL type has a graph type of the same id */
function toGraphType(glsl: GlslType): DataType<any, any> {
  const type = [Float, Int, Vec2, Vec3, Vec4, Sampler2D, GenType].find((t) => t.id === glsl)
  if (!type) throw new Error(`No graph type for GLSL type ${glsl}`)
  return type
}

function toParamType(param: Pick<Param, 'type' | 'isColor'>): DataType<any, any> {
  return param.isColor ? Color : toGraphType(param.type)
}
