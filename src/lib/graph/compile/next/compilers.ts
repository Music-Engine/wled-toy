import { GRAPH_VERSION } from '@/lib/graph/model/doc'
import { bufferAllowance } from './checks/buffer-allowance'
import { createCompiler } from './create-compiler'
import type { Target } from './context'
import { pass } from './annotations/pass'
import { resources } from './annotations/resources'
import { state } from './annotations/state'
import { width } from './annotations/width'
import { glsl } from './targets/glsl'
import { usermod } from './targets/usermod'

/** The compiler the engine will load programs with. */
export const glslCompiler = () => compilerWith(glsl())

/** The compiler for a WLED usermod driving `leds` LEDs. */
export const usermodCompiler = (leds: number) => compilerWith(usermod({ leds }))

const compilerWith = <P>(target: Target<P>) => createCompiler({
  version: GRAPH_VERSION,
  target,
  annotations: [width(), pass(), state(), resources()],
  checks: [bufferAllowance(12)],
  optimize: [],
})
