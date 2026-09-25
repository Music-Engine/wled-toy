import { CONTROL_VECTORS } from '@/lib/shader/prelude'
import type { FrameContext, FrameValue, FrameInfo } from '@/lib/graph/define/context'
import type { NodeShape } from '@/lib/graph/define/shape'
import type { DataType } from '@/lib/graph/define/types'

/** Where a frame step takes an input from: a value stored on the node, an earlier step's output, or a frame builtin by name. */
export type FrameBinding = { constant: unknown } | { step: number; output: string } | { frame: 'time' }

export interface FrameStep {
  nodeId: string
  kind: string
  frame: NonNullable<NodeShape['frame']>
  state?: NodeShape['state']
  resolved: Record<string, unknown>
  inputs: Record<string, FrameBinding>
  /** Component count each linked input is cast to before `frame` sees it. */
  dims: Record<string, number>
}

export interface FramePlan {
  steps: FrameStep[]
  /** Step outputs the shader reads, and where in the uniform block they go. */
  exports: { step: number; output: string; slot: number; dim: number }[]
  /** What nodes registered while compiling, by kind: the audio source the graph wants, the analyses it reads. */
  resources: Record<string, unknown[]>
}

/** Runs a plan once per frame and keeps each node's state across plans for as long as the node exists. */
export class FrameRunner {
  private plan: FramePlan = { steps: [], exports: [], resources: {} }
  private steps: LoadedStep[] = []
  private states = new Map<string, Record<string, unknown>>()
  private readonly block = new Float32Array(CONTROL_VECTORS * 4)
  private readonly results: Record<string, FrameValue>[] = []
  private exportBuffers: number[][] = []
  // one object handed to every body and refilled in place, so stepping allocates no context per node or frame
  private readonly info: FrameContext = { time: 0, dt: 0, frameIndex: 0, audio: undefined, midi: undefined, osc: undefined, state: undefined, resolved: {} }

  load(plan: FramePlan) {
    const states = new Map<string, Record<string, unknown>>()
    for (const { nodeId, kind, state } of plan.steps) {
      const key = `${nodeId}:${kind}`
      const kept = this.states.get(key)
      if (state) states.set(key, kept ? fillMissingSlots(kept, state) : initialState(state))
    }
    this.steps = plan.steps.map(loadStep)
    this.exportBuffers = plan.exports.map(({ dim }) => Array(dim).fill(0))
    this.states = states
    this.plan = plan
  }

  /** What a node put out on the last step, for the parts of the app that act on per-frame values (scene recall). */
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
    const { info, results, steps } = this
    Object.assign(info, frame)
    results.length = steps.length
    for (let s = 0; s < steps.length; s++) {
      const step = steps[s]
      for (let i = 0; i < step.inputs.length; i++) {
        const { name, binding, dim, buffer } = step.inputs[i]
        step.input[name] = bindingValue(binding, results, info, dim, buffer)
      }
      info.state = this.states.get(step.stateKey)
      info.resolved = step.resolved
      results[s] = step.frame(step.input, info)
    }
    return this.packExports(results)
  }

  private packExports(results: Record<string, FrameValue>[]): Float32Array {
    const { block, exportBuffers } = this
    const { exports } = this.plan
    block.fill(0)
    for (let e = 0; e < exports.length; e++) {
      const { step, output, slot, dim } = exports[e]
      const value = castFrameValue(results[step][output] ?? 0, dim, exportBuffers[e])
      if (!Array.isArray(value)) {
        block[slot] = Number.isFinite(value) ? value : 0
        continue
      }
      for (let i = 0; i < dim; i++) block[slot + i] = Number.isFinite(value[i]) ? value[i] : 0
    }
    return block
  }
}

/** Fresh state for a slot declaration: every slot at its type's zero. */
export function initialState(slots: NonNullable<NodeShape['state']>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(slots).map(([name, type]) => [name, zeroValue(type)]))
}

/** State kept from an earlier plan, with a zero in every slot the node declares now and did not then. */
function fillMissingSlots(kept: Record<string, unknown>, slots: NonNullable<NodeShape['state']>): Record<string, unknown> {
  for (const [name, type] of Object.entries(slots)) {
    if (!(name in kept)) kept[name] = zeroValue(type)
  }
  return kept
}

/**
 * A number or vector starts at 0 in every component and a stored option at its first value (`false`, an Enum's first
 * option), not at the socket default, which for Float is 0.5.
 */
export function zeroValue(type: DataType<any>): unknown {
  if (type.kind === 'param') return type.initial()
  if (type.kind === 'value' && type.dim !== undefined) return type.dim === 1 ? 0 : Array(type.dim).fill(0)
  throw new Error(`${type.label} cannot hold node state`)
}

/** A binding as the runner reads it: a frame builtin is resolved to its reader when the plan is loaded. */
type LoadedBinding = Exclude<FrameBinding, { frame: string }> | { read: (frame: FrameInfo) => number }
type LoadedInput = { name: string; binding: LoadedBinding; dim: number | undefined; buffer: number[] | undefined }
type LoadedStep = Omit<FrameStep, 'inputs'> & { stateKey: string; inputs: LoadedInput[]; input: Record<string, unknown> }

// bodies get the same input record and vector buffers every frame, so a body that keeps an input past its call must copy it
function loadStep(step: FrameStep): LoadedStep {
  const inputs = Object.entries(step.inputs).map(([name, binding]): LoadedInput => {
    const dim = step.dims[name]
    return { name, binding: loadBinding(binding), dim, buffer: dim !== undefined && dim > 1 ? Array(dim).fill(0) : undefined }
  })
  const input = Object.fromEntries(inputs.map(({ name }) => [name, undefined]))
  return { ...step, stateKey: `${step.nodeId}:${step.kind}`, inputs, input }
}

function loadBinding(binding: FrameBinding): LoadedBinding {
  if (!('frame' in binding)) return binding
  if (binding.frame !== 'time') throw new Error(`unknown frame builtin "${binding.frame}"`)
  return { read: (frame) => frame.time }
}

/** A constant is cast only when its socket is linkable; linked and frame inputs always have a dim. */
function bindingValue(binding: LoadedBinding, results: Record<string, FrameValue>[], frame: FrameInfo, dim: number | undefined, buffer: number[] | undefined): unknown {
  if ('constant' in binding) return dim === undefined ? binding.constant : castFrameValue(binding.constant as FrameValue, dim, buffer)
  if ('read' in binding) return castFrameValue(binding.read(frame), dim!, buffer)
  return castFrameValue(results[binding.step][binding.output] ?? 0, dim!, buffer)
}

/** Same rules as castTo, on numbers: scalars spread, long vectors truncate, short ones pad with 0 and alpha 1. A vector is written into `into` when given. */
export function castFrameValue(value: FrameValue, dim: number, into?: number[]): FrameValue {
  if (!Array.isArray(value)) return dim === 1 ? value : (into ?? Array(dim)).fill(value)
  if (dim === 1) return value[0] ?? 0
  const out = into ?? Array(dim)
  for (let i = 0; i < dim; i++) out[i] = value[i] ?? (i === 3 ? 1 : 0)
  return out
}
