import type { NodeGraph } from '@/lib/graph/model/doc'
import { lintEdges } from '@/lib/graph/model/lint'
import { createSlotTable, GraphError, type GraphIssue, type Annotation, type Check, type CompileContext, type Hook, type SlotTable, type Stage, type Target } from './context'
import { topoSort } from './topo'

export function createCompiler<P>(config: CompilerConfig<P>): Compiler<P> {
  checkReads(config.annotations, [...config.checks, config.target])
  return { compile: (doc, options = {}) => compile(config, doc, options.slots ?? createSlotTable()) }
}

interface CompilerConfig<P> {
  /** Any other graph version is refused, never migrated */
  version: number
  target: Target<P>
  annotations: Annotation[]
  checks: Check[]
  /** Empty until a measured shader shows a win the driver misses */
  optimize: Annotation[]
  hooks?: Partial<Record<Stage, Hook>>
}

interface Compiler<P> {
  compile(doc: NodeGraph, options?: { slots?: SlotTable }): CompileResult<P>
}

/** `program` null when a stage failed or a check withheld it; `slots` then the table passed in */
export interface CompileResult<P> {
  program: P | null
  issues: GraphIssue[]
  slots: SlotTable
}

/** A stage reading an annotation not listed before it would read unsettled facts */
function checkReads(annotations: Annotation[], after: { name: string; reads: string[] }[]): void {
  const listed = annotations.map((annotation) => annotation.name)
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

/** `issues` is the context's own list, so what stages reported before a throw is kept */
function runStages<P>(config: CompilerConfig<P>, doc: NodeGraph, previous: SlotTable, issues: GraphIssue[]): CompileResult<P> {
  const fire = (stage: Stage, ctx: CompileContext) => config.hooks?.[stage]?.(stage, ctx)
  const ctx: CompileContext = { doc, order: [], nodes: {}, output: '', resources: {}, settings: null, uniforms: [], previous, slots: createSlotTable(), issues }
  issues.push(...lintEdges(doc))
  fire('lint', ctx)
  if (!topoSort(ctx)) return { program: null, issues, slots: previous }
  fire('topo', ctx)
  for (const annotation of config.annotations) annotation.annotate(ctx)
  fire('annotations', ctx)
  const withheld = runChecks(config.checks, ctx)
  fire('checks', ctx)
  if (withheld) return { program: null, issues, slots: previous }
  for (const rewrite of config.optimize) rewrite.annotate(ctx)
  fire('optimize', ctx)
  const program = config.target.emit(ctx)
  fire('target', ctx)
  return { program, issues, slots: ctx.slots }
}

/** Pushes every check's issues; true when one withholds the program */
function runChecks(checks: Check[], ctx: CompileContext): boolean {
  let withheld = false
  for (const check of checks) {
    const found = check.check(ctx)
    ctx.issues.push(...found)
    if (found.length > 0 && check.withholds !== false) withheld = true
  }
  return withheld
}
