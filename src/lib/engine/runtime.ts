import type { Features } from '@/lib/audio/dsp'
import type { AudioTextures } from '@/lib/audio/textures'
import { emptySlots, type GlslProgram, type ProgramUniform, type Slots, type SlotTable } from '@/lib/graph'
import { CONTROL_VECTORS } from '@/lib/shader/prelude'
import type { FrameParams, ShaderRenderer } from '@/lib/engine/render/renderer'
import type { MidiReader } from './midi'

/**
 * A program loaded on the renderer: its two shaders, the `iControl` block the host writes its uniforms into, the probes
 * read back on each tick, and the slot table its pixel and global state are laid out by. Nothing after `load` allocates.
 */
export class Runtime {
  /** The table the loaded program's state is laid out by; the next compile takes it, so a kept node keeps its slots. */
  slots: SlotTable = emptySlots()
  private program: GlslProgram | null = null
  private readonly block = new Float32Array(CONTROL_VECTORS * 4)
  // node id to its float in the probe readback
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
   * Compiles the program's shaders unless they are the ones running, and lays its state out by `slots`: the global state
   * floats of every slot the previous table held and this one does not keep are zeroed, so a slot handed to another node
   * starts from 0 (pixel state starts from 0 on every compile). Uniforms start at their defaults. Returns the compile time,
   * or null when nothing was compiled; throws the GLSL info log and keeps the previous program.
   */
  load(program: GlslProgram, slots: SlotTable): number | null {
    const running = this.program
    const compiled = running?.pixel === program.pixel && running.frame?.code === program.frame?.code ? null : this.renderer.compile(program.pixel, program.frame ?? undefined)
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

  /** MIDI In and OSC In take the latest message each tick; knobs are set when they move. */
  readMidiAndOsc(midi: MidiReader, osc: (address: string) => readonly number[] | undefined) {
    for (const uniform of this.uniforms) {
      if (uniform.kind === 'midi') {
        const value = midi.value(uniform.message, uniform.channel, uniform.number)
        this.set(uniform, uniform.gate ? Number(value > 0) : value)
      }
      if (uniform.kind === 'osc') this.set(uniform, osc(uniform.address)?.[uniform.argument] ?? 0)
    }
  }

  /** `audio` is the default analysis, `extra` the FFT nodes' in slot order, `features` the default one's for `iAudioFeatures`. */
  feed(audio: AudioTextures, extra: AudioTextures[], features: Features | null) {
    this.renderer.setAudio(audio, extra, features)
  }

  /** The value a probe node read back on the last tick, or undefined before one or when it is not in the program. */
  readProbe(nodeId: string): number | undefined {
    const float = this.probeFloats.get(nodeId)
    return float === undefined || !this.probes ? undefined : this.probes[float]
  }

  /**
   * What a node output holds now, for code that freezes it: a uniform's value, or the global state an output the pixel
   * pass reads is written to. Reads the GPU back, so never on the frame path.
   */
  readValue(nodeId: string, output: string): number | number[] | undefined {
    const uniform = this.uniforms.find((u) => u.node === nodeId && u.output === output)
    if (uniform) return this.block[uniform.offset]
    const slot = this.slots.global[`${nodeId}:${output}`]?.[output]
    if (!slot) return undefined
    const texel = new Float32Array(4)
    this.renderer.readGlobalState([Math.floor(slot.offset / 4)], texel)
    const floats = Array.from(texel.subarray(slot.offset % 4, (slot.offset % 4) + SLOT_FLOATS[slot.type]))
    return floats.length === 1 ? floats[0] : floats
  }

  /** The frame pass, then the LED pass, then the probes; returns the LED colors as `renderLeds` does. */
  tick(params: FrameParams): Float32Array {
    this.renderer.renderGlobalState(params)
    const leds = this.renderer.renderLeds(params)
    this.probes = this.renderer.readProbes()
    return leds
  }

  /** The pixel pass on the canvas; it reads global state and never advances it. */
  preview(params: FrameParams, maxHeight: number) {
    this.renderer.renderPreview(params, maxHeight)
  }

  /** Every node starts over: global state, pixel state and the previous frames all go back to 0. */
  reset() {
    this.renderer.clearGlobalState()
    this.renderer.resetFeedback()
  }
}

// floats in each value type a slot holds; a slot never straddles two texels
const SLOT_FLOATS: Record<string, number> = { float: 1, int: 1, vec2: 2, vec3: 3, color: 3, vec4: 4 }

/** Every float of each entry in `previous` that `next` does not keep whole, as the state annotation keeps an entry or moves it. */
function collectFreedFloats(previous: SlotTable['global'], next: SlotTable['global']): number[] {
  return Object.entries(previous)
    .filter(([key, slots]) => !keepsSlots(next[key], slots))
    .flatMap(([, slots]) => Object.values(slots).flatMap(({ offset, type }) => Array.from({ length: SLOT_FLOATS[type] }, (_, i) => offset + i)))
}

const keepsSlots = (next: Slots | undefined, previous: Slots) =>
  next !== undefined && Object.keys(next).length === Object.keys(previous).length
  && Object.entries(previous).every(([name, slot]) => next[name]?.offset === slot.offset && next[name].type === slot.type && next[name].kind === slot.kind)
