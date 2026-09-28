import { GRAPH_VERSION } from '@/lib/graph/model/doc'
import { bufferAllowance } from './checks/buffer-allowance'
import { usermodInputs } from './checks/usermod-inputs'
import { createCompiler } from './create-compiler'
import type { Check, Target } from './context'
import { pass } from './annotations/pass'
import { resources } from './annotations/resources'
import { state } from './annotations/state'
import { width } from './annotations/width'
import { glsl } from './targets/glsl'
import { usermod } from './targets/usermod'

/** The compiler the engine will load programs with. */
export const glslCompiler = () => compilerWith(glsl(), [])

/** The compiler for a WLED usermod driving `leds` LEDs; a WLED effect has five sliders: speed, intensity and custom 1 to 3. */
export const usermodCompiler = (leds: number, { sliders = 5 } = {}) => compilerWith(usermod({ leds }), [usermodInputs({ sliders })])

const compilerWith = <P>(target: Target<P>, checks: Check[]) => createCompiler({
  version: GRAPH_VERSION,
  target,
  annotations: [resources(), width(), pass(), state()],
  checks: [bufferAllowance(12), ...checks],
  optimize: [],
})
