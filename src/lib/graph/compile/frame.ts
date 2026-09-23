import { CONTROL_VECTORS } from '@/lib/shader/glsl'
import type { FrameValue, FrameInfo } from '@/lib/graph/define/context'
import type { NodeShape } from '@/lib/graph/define/shape'

/** Where a control step takes an input from: a value stored on the node, an earlier step's output, or a frame builtin by name. */
export type FrameBinding = { constant: unknown } | { step: number; output: string } | { frame: 'time' }

export interface FrameStep {
  nodeId: string
  kind: string
  run: NonNullable<NodeShape['run']>
  state?: NodeShape['state']
  inputs: Record<string, FrameBinding>
  /** Component count each linked input is cast to before `run` sees it. */
  dims: Record<string, number>
}

export interface FramePlan {
  steps: FrameStep[]
  /** Step outputs the shader reads, and where in the uniform block they go. */
  exports: { step: number; output: string; slot: number; dim: number }[]
  /** What nodes registered while compiling, by kind: the audio source the graph wants, the analyses it reads. */
  resources: Record<string, unknown[]>
}

/** Same rules as castTo, on numbers: scalars spread, long vectors truncate, short ones pad with 0 and alpha 1. */
export function castFrameValue(value: FrameValue, dim: number): FrameValue {
  if (!Array.isArray(value)) return dim === 1 ? value : Array(dim).fill(value)
  if (dim === 1) return value[0] ?? 0
  return Array.from({ length: dim }, (_, i) => value[i] ?? (i === 3 ? 1 : 0))
}

/** A binding as the runner reads it: a frame builtin is resolved to its reader when the plan is loaded. */
type LoadedBinding = Exclude<FrameBinding, { frame: string }> | { read: (frame: FrameInfo) => number }
type LoadedStep = Omit<FrameStep, 'inputs'> & { inputs: [string, LoadedBinding][] }

/** Runs a plan once per frame and keeps each node's state across plans for as long as the node exists. */
export class FrameRunner {
  private plan: FramePlan = { steps: [], exports: [], resources: {} }
  private steps: LoadedStep[] = []
  private states = new Map<string, unknown>()
  private readonly block = new Float32Array(CONTROL_VECTORS * 4)
  private results: Record<string, FrameValue>[] = []

  load(plan: FramePlan) {
    const states = new Map<string, unknown>()
    for (const { nodeId, kind, state } of plan.steps) {
      const key = `${nodeId}:${kind}`
      if (state) states.set(key, this.states.get(key) ?? state())
    }
    this.steps = plan.steps.map((step) => ({ ...step, inputs: Object.entries(step.inputs).map(([name, binding]) => [name, loadBinding(binding)]) }))
    this.states = states
    this.plan = plan
  }

  /** What a node put out on the last step, for the parts of the app that act on control values (scene recall). */
  output(nodeId: string, output: string): FrameValue | undefined {
    const index = this.plan.steps.findIndex((step) => step.nodeId === nodeId)
    return this.results[index]?.[output]
  }

  /** Forgets all state, e.g. when the clock is reset. */
  reset() {
    this.states.clear()
    this.load(this.plan)
  }

  step(frame: FrameInfo): Float32Array {
    const results: Record<string, FrameValue>[] = []
    this.results = results
    for (const { nodeId, kind, run, inputs, dims } of this.steps) {
      const input = Object.fromEntries(inputs.map(([name, binding]) => [name, bindingValue(binding, results, frame, dims[name])]))
      results.push(run(input, this.states.get(`${nodeId}:${kind}`), frame))
    }
    return this.packExports(results)
  }

  private packExports(results: Record<string, FrameValue>[]): Float32Array {
    this.block.fill(0)
    for (const { step, output, slot, dim } of this.plan.exports) {
      const value = castFrameValue(results[step][output] ?? 0, dim)
      const components = Array.isArray(value) ? value : [value]
      components.forEach((c, i) => (this.block[slot + i] = Number.isFinite(c) ? c : 0))
    }
    return this.block
  }
}

function loadBinding(binding: FrameBinding): LoadedBinding {
  if (!('frame' in binding)) return binding
  if (binding.frame !== 'time') throw new Error(`unknown frame builtin "${binding.frame}"`)
  return { read: (frame) => frame.time }
}

/** A constant is cast only when its socket is linkable; linked and frame inputs always have a dim. */
function bindingValue(binding: LoadedBinding, results: Record<string, FrameValue>[], frame: FrameInfo, dim: number | undefined): unknown {
  if ('constant' in binding) return dim === undefined ? binding.constant : castFrameValue(binding.constant as FrameValue, dim)
  if ('read' in binding) return castFrameValue(binding.read(frame), dim!)
  return castFrameValue(results[binding.step][binding.output] ?? 0, dim!)
}
