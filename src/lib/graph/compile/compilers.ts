import { GRAPH_VERSION } from '@/lib/graph/model/doc'
import { checkBufferAllowance } from './checks/buffer-allowance'
import { checkControlCapacity } from './checks/control-capacity'
import { checkExportableOutputs } from './checks/exportable-outputs'
import { checkLinkTypes } from './checks/link-types'
import { checkProbePass } from './checks/probe-pass'
import { requireCppParity } from './checks/require-cpp-parity'
import { checkUsermodInputs } from './checks/usermod-inputs'
import { createCompiler } from './create-compiler'
import type { Hook, Stage } from './context'
import { markCppParity } from './annotations/cpp-parity'
import { choosePass } from './annotations/pass'
import { resolveResources } from './annotations/resources'
import { allocateState } from './annotations/state'
import { inferWidth } from './annotations/width'
import { createGlslTarget } from './targets/glsl'
import { createUsermodTarget } from './targets/usermod'

export { createSlotTable, type GraphIssue, type ProgramUniform, type Slots, type SlotTable } from './context'
export type { CompileResult } from './create-compiler'
export { FRAME_SOURCE_STRING, type GlslProgram } from './targets/glsl'
export { toGlslForm } from './targets/glsl-form'
export type { UsermodProgram } from './targets/usermod'

/** Engine's compiler; standalone = one pixel shader needing no host, for export and shader mode */
export const createGlslCompiler = ({ hooks, standalone }: { hooks?: Partial<Record<Stage, Hook>>; standalone?: boolean } = {}) => createCompiler({
  version: GRAPH_VERSION,
  target: createGlslTarget({ standalone }),
  annotations: [resolveResources(), inferWidth(), choosePass(), allocateState()],
  checks: [checkLinkTypes(), checkControlCapacity(), checkProbePass(), checkExportableOutputs(), checkBufferAllowance(12)],
  optimize: [],
  hooks,
})

/**
 * WLED usermod driving `leds` LEDs; an effect has five sliders (speed, intensity, custom 1 to 3). W/o `checkInputs`
 * probes, MIDI, OSC and every knob stay, for a build that only checks the bodies
 */
export const createUsermodCompiler = (leds: number, { sliders = 5, checkInputs = true } = {}) => createCompiler({
  version: GRAPH_VERSION,
  target: createUsermodTarget({ leds }),
  annotations: [resolveResources(), inferWidth(), choosePass(), allocateState(), markCppParity()],
  checks: [
    checkLinkTypes(), checkControlCapacity(), checkProbePass(), checkExportableOutputs(), checkBufferAllowance(12),
    ...(checkInputs ? [checkUsermodInputs({ sliders })] : []), requireCppParity(),
  ],
  optimize: [],
})
