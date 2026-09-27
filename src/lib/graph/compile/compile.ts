// generateGlsl: compiles a graph into a shader plus the plan for what is evaluated once per frame in JS.
// The front end places each node per frame or per pixel (front-end/placement), infers generic widths (front-end/width),
// settles streams (front-end/streams), and walks the sinks into a plain-data Program (front-end/frame-plan, pixel-plan,
// uniforms). The GLSL backend (glsl/glsl) and the JS backend (js/js) read only that Program; the GLSL backend also
// records on it what each pixel body declared through `ctx.require`, since bodies run only there.
import { nodeItem } from '@/lib/graph/registry'
import type { NodeGraph } from '@/lib/graph/model/doc'
import type { FramePlan } from '@/lib/graph/compile/js/frame'
import { planStep } from '@/lib/graph/compile/front-end/frame-plan'
import { FrontEnd, type CompileOptions } from '@/lib/graph/compile/front-end/front-end'
import { glsl, type GlslShader } from '@/lib/graph/compile/glsl/glsl'
import { js } from '@/lib/graph/compile/js/js'
import { emitPixel } from '@/lib/graph/compile/front-end/pixel-plan'
import { placeNodes } from '@/lib/graph/compile/front-end/placement'
import { GraphError, type Program } from '@/lib/graph/compile/front-end/program'
import { resolveNode } from '@/lib/graph/compile/front-end/streams'
import { inferWidths } from '@/lib/graph/compile/front-end/width'

export function generateGlsl(doc: NodeGraph, options: CompileOptions = {}): GeneratedShader {
  const program = buildProgram(doc, options)
  return { ...glsl(program), frame: js(program) }
}

export interface GeneratedShader extends GlslShader {
  /** What is evaluated in JS each frame, and which of its results the shader reads from `iControl`. */
  frame: FramePlan
}

/** Walks the sinks depth-first in document order, each socket in declaration order, as the snapshots expect. */
export function buildProgram(doc: NodeGraph, options: CompileOptions): Program {
  const c = new FrontEnd(doc, options)
  const sinks = doc.nodes.filter((n) => nodeItem(n.data.kind) && c.lookup(n.id).shape.isOutput).map((n) => n.id)
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

export { offlineUnit } from '@/lib/graph/compile/cpp/cpp'
export type { CompileOptions } from '@/lib/graph/compile/front-end/front-end'
export type { FrozenValue } from '@/lib/graph/compile/glsl/glsl'
export { glslForm } from '@/lib/graph/compile/glsl/glsl-types'
export type { GraphIssue } from '@/lib/graph/compile/front-end/program'
