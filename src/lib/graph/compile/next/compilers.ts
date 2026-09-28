import { GRAPH_VERSION } from '@/lib/graph/model/doc'
import { bufferAllowance } from './checks/buffer-allowance'
import { usermodInputs } from './checks/usermod-inputs'
import { createCompiler } from './create-compiler'
import type { Hook, Stage } from './context'
import { pass } from './annotations/pass'
import { resources } from './annotations/resources'
import { state } from './annotations/state'
import { width } from './annotations/width'
import { glsl } from './targets/glsl'
import { usermod } from './targets/usermod'

export { emptySlots, type ProgramUniform, type Slots, type SlotTable } from './context'
export type { CompileResult } from './create-compiler'
export type { GlslProgram } from './targets/glsl'

/** The compiler the engine loads programs with; `hooks` observe each stage, as a test counting compiles does. */
export const createGlslCompiler = ({ hooks }: { hooks?: Partial<Record<Stage, Hook>> } = {}) => createCompiler({
  version: GRAPH_VERSION,
  target: glsl(),
  annotations: [resources(), width(), pass(), state()],
  checks: [bufferAllowance(12)],
  optimize: [],
  hooks,
})

/** The compiler for a WLED usermod driving `leds` LEDs; a WLED effect has five sliders: speed, intensity and custom 1 to 3. */
export const createUsermodCompiler = (leds: number, { sliders = 5 } = {}) => createCompiler({
  version: GRAPH_VERSION,
  target: usermod({ leds }),
  annotations: [resources(), width(), pass(), state()],
  checks: [bufferAllowance(12), usermodInputs({ sliders })],
  optimize: [],
})
