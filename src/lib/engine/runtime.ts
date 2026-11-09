import { createSlotTable, type GlslProgram, type ProgramUniform, type Slots, type SlotTable } from '@/lib/graph'
import { CONTROL_VECTORS } from '@/lib/shader/prelude'
import type { FrameParams, ShaderRenderer } from '@/lib/engine/render/renderer'
import type { MidiReader } from './midi'

/** Program loaded on the renderer w/ its `iControl` block, probes and slot table; nothing after `load` allocates */
export class Runtime {
  /** Next compile takes it, so a kept node keeps its slots */
  slots: SlotTable = createSlotTable()
  private program: GlslProgram | null = null
  private readonly block = new Float32Array(CONTROL_VECTORS * 4)
  // Node id to its float in the probe readback
  private probeFloats = new Map<string, number>()
  private probes: Float32Array | null = null

  constructor(private readonly renderer: ShaderRenderer) {
    renderer.setControls(this.block)
  }

  get ready() {
    return this.renderer.ready
  }

  get uniforms(): readonly ProgramUniform[] {
    return this.program?.uniforms ?? []
  }

  /**
   * Compiles unless the shaders are running; zeroes global floats of slots `slots` no longer keeps, so a reassigned
   * slot starts from 0; uniforms start at defaults. Returns compile ms, or null when nothing compiled; throws the GLSL
   * info log and keeps the prev program
   */
  load(program: GlslProgram, slots: SlotTable): number | null {
    const running = this.program
    const compiled =
      running?.pixel === program.pixel && running.frame?.code === program.frame?.code ? null : this.renderer.compile(program.pixel, program.frame ?? undefined)
    this.renderer.setAudioReads(program.resources.audioFeatures !== undefined, (program.resources.spectra ?? []) as number[])
    this.renderer.clearGlobalState(collectFreedFloats(this.slots.global, slots.global))
    this.slots = slots
    this.program = program
    this.block.fill(0)
    for (const uniform of program.uniforms) this.block[uniform.offset] = uniform.default
    this.probeFloats = new Map(Object.entries(program.probes).map(([id, offset], i) => [id, i * 4 + (offset % 4)]))
    this.probes = null
    return compiled
  }

  set(uniform: ProgramUniform, value: number) {
    this.block[uniform.offset] = value
  }

  /** MIDI and OSC take the latest message each tick; knobs are set when they move */
  readMidiAndOsc(midi: MidiReader, osc: (address: string) => readonly number[] | undefined) {
    for (const uniform of this.uniforms) {
      if (uniform.kind === 'midi') {
        const value = midi.value(uniform.message, uniform.channel, uniform.number)
        this.set(uniform, uniform.gate ? Number(value > 0) : value)
      }
      if (uniform.kind === 'osc') this.set(uniform, osc(uniform.address)?.[uniform.argument] ?? 0)
    }
  }

  /** Undefined before the first tick or when the probe is not in the program */
  readProbe(nodeId: string): number | undefined {
    const float = this.probeFloats.get(nodeId)
    return float === undefined || !this.probes ? undefined : this.probes[float]
  }

  /** Frame pass, LED pass, then probes; returns LED colors as `renderLeds` does */
  tick(params: FrameParams): Float32Array {
    this.renderer.renderGlobalState(params)
    const leds = this.renderer.renderLeds(params)
    this.probes = this.renderer.readProbes()
    return leds
  }

  /** Global state, pixel state and prev frames back to 0 */
  reset() {
    this.renderer.clearGlobalState()
    this.renderer.resetFeedback()
  }
}

/** Floats of each `previous` entry `next` does not keep whole, as the state annotation keeps or moves entries */
function collectFreedFloats(previous: SlotTable['global'], next: SlotTable['global']): number[] {
  return Object.entries(previous)
    .filter(([key, slots]) => !keepsSlots(next[key], slots))
    .flatMap(([, slots]) => Object.values(slots).flatMap(({ offset, dim }) => Array.from({ length: dim }, (_, i) => offset + i)))
}

const keepsSlots = (next: Slots | undefined, previous: Slots) =>
  next !== undefined &&
  Object.keys(next).length === Object.keys(previous).length &&
  Object.entries(previous).every(([name, slot]) => next[name]?.offset === slot.offset && next[name].type === slot.type && next[name].kind === slot.kind)
