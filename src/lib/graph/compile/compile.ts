// generateGlsl: compiles a graph into a shader plus the plan for what is evaluated once per frame in JS.
// The front end places each node per frame or per pixel (./placement), infers generic widths (./width), settles streams
// (./streams), and walks the sinks into a plain-data Program (./frame-plan, ./pixel-plan, ./uniforms). The GLSL backend
// (./glsl) and the JS backend (./js) read only that Program; the GLSL backend also records on it what each pixel body
// declared through `ctx.require`, since bodies run only there.
import { itemFor } from '@/lib/graph/registry'
import type { NodeGraph } from '@/lib/graph/model/doc'
import type { FramePlan } from './frame'
import { planStep } from './frame-plan'
import { FrontEnd, type CompileOptions } from './front-end'
import { glsl, type GlslShader } from './glsl'
import { js } from './js'
import { emitPixel } from './pixel-plan'
import { placeNodes } from './placement'
import { GraphError, type Program } from './program'
import { resolveNode } from './streams'
import { inferWidths } from './width'

export type { CompileOptions } from './front-end'
export type { FrozenValue } from './glsl'
export { glslForm } from './glsl-types'
export type { GraphIssue } from './program'

export interface GeneratedShader extends GlslShader {
  /** What is evaluated in JS each frame, and which of its results the shader reads from `iControl`. */
  frame: FramePlan
}

export function generateGlsl(doc: NodeGraph, options: CompileOptions = {}): GeneratedShader {
  const program = buildProgram(doc, options)
  return { ...glsl(program), frame: js(program) }
}

/** Walks the sinks depth-first in document order, each socket in declaration order, as the snapshots expect. */
export function buildProgram(doc: NodeGraph, options: CompileOptions): Program {
  const c = new FrontEnd(doc, options)
  const sinks = doc.nodes.filter((n) => itemFor(n.data.kind) && c.lookup(n.id).shape.isOutput).map((n) => n.id)
  const [output, ...others] = sinks.filter((id) => c.lookup(id).shape.pixel)
  if (!output) return fail(c, 'Add an Output node to see anything.', null)
  // an Output left out is not compiled at all, so its color cannot replace the first one's either
  const built = sinks.filter((id) => !others.includes(id))
  for (const id of others) c.program.issues.push({ nodeId: id, message: `Only the first Output ("${output}") drives the LEDs; this one is left out` })
  try {
    placeNodes(c, built)
    inferWidths(c, built)
    for (const id of built) buildSink(c, id)
    c.program.output = resolveNode(c, output).output ?? null
    return c.program
  } catch (e) {
    return fail(c, (e as Error).message, e instanceof GraphError ? e.nodeId : null)
  }
}

function fail(c: FrontEnd, error: string, errorNode: string | null): Program {
  return Object.assign(c.program, { error, errorNode })
}

/** A sink evaluated only per frame (Scene Switch) or only settles streams (Audio Source) draws nothing, but takes part. */
function buildSink(c: FrontEnd, id: string): void {
  const { shape } = c.lookup(id)
  if (!shape.pixel && !shape.frame) resolveNode(c, id)
  else if (c.placedAt(id) === 'frame') planStep(c, id)
  else emitPixel(c, id)
}
