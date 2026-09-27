// createCompiler: the whole compiler as a factory. The order is fixed (lint, topo sort from the Output, annotations,
// checks, optimize, target) and everything else is a list, so a compiler is its configuration.
import type { NodeGraph } from '@/lib/graph/model/doc'
import { GraphError, type GraphIssue } from '@/lib/graph/compile/front-end/program'
import { emptySlots, type Annotation, type Check, type CompileContext, type Hook, type SlotTable, type Stage, type Target } from './context'
import { topoSort } from './topo'

export function createCompiler<P>(config: CompilerConfig<P>): Compiler<P> {
  checkReads(config.annotations, [...config.checks, config.target])
  return { compile: (doc, options = {}) => compile(config, doc, options.slots ?? emptySlots()) }
}

export interface CompilerConfig<P> {
  /** The graph version this compiler reads; any other is refused, never migrated. */
  version: number
  target: Target<P>
  annotations: Annotation[]
  checks: Check[]
  /** Rewrites of the annotated context; empty until a measured shader shows a win the driver misses. */
  optimize: Annotation[]
  hooks?: Partial<Record<Stage, Hook>>
}

export interface Compiler<P> {
  compile(doc: NodeGraph, options?: { slots?: SlotTable }): CompileResult<P>
}

/** `program` is null when a stage failed or a check reported; `slots` is then the table passed in. */
export interface CompileResult<P> {
  program: P | null
  issues: GraphIssue[]
  slots: SlotTable
}

/** An annotation, check or target reading one that is not listed before it would read facts nobody has settled yet. */
function checkReads(annotations: Annotation[], after: { name: string; reads: string[] }[]): void {
  const listed = annotations.map((a) => a.name)
  for (const [index, stage] of [...annotations, ...after].entries()) {
    for (const read of stage.reads) {
      const at = listed.indexOf(read)
      if (at < 0) throw new Error(`${stage.name} reads ${read}, which no annotation provides`)
      if (at >= index) throw new Error(`${stage.name} reads ${read}, so ${read} must be listed before ${stage.name}`)
    }
  }
}

function compile<P>(config: CompilerConfig<P>, doc: NodeGraph, previous: SlotTable): CompileResult<P> {
  if (doc.version !== config.version) {
    return { program: null, issues: [{ nodeId: null, message: `This graph is version ${doc.version}; the compiler reads version ${config.version}` }], slots: previous }
  }
  const issues: GraphIssue[] = []
  try {
    return runStages(config, doc, previous, issues)
  } catch (e) {
    if (!(e instanceof GraphError)) throw e
    return { program: null, issues: [...issues, { nodeId: e.nodeId, message: e.message }], slots: previous }
  }
}

/** `issues` is the context's own list, so what the stages reported before one threw is kept. */
function runStages<P>(config: CompilerConfig<P>, doc: NodeGraph, previous: SlotTable, issues: GraphIssue[]): CompileResult<P> {
  const fire = (stage: Stage, ctx: CompileContext) => config.hooks?.[stage]?.(stage, ctx)
  const ctx: CompileContext = { doc, order: [], nodes: {}, output: '', resources: {}, settings: null, previous, slots: emptySlots(), issues }
  fire('lint', ctx)
  if (!topoSort(ctx)) return { program: null, issues, slots: previous }
  fire('topo', ctx)
  for (const annotation of config.annotations) annotation.annotate(ctx)
  fire('annotations', ctx)
  const failed = config.checks.flatMap((check) => check.check(ctx))
  issues.push(...failed)
  fire('checks', ctx)
  if (failed.length > 0) return { program: null, issues, slots: previous }
  for (const rewrite of config.optimize) rewrite.annotate(ctx)
  fire('optimize', ctx)
  const program = config.target.emit(ctx)
  fire('target', ctx)
  return { program, issues, slots: ctx.slots }
}
