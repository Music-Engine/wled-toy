// The C++ backend: a Program as one translation unit against cpp/wledtoy.h, for a WLED usermod. The pixel side is the GLSL
// backend's emission read through the header, so a body is written once; only the state targets are spelled for C++.
//
// Frame bodies are JavaScript functions and have no C++ twin, so a Program with frame steps is rejected rather than
// half-built. With no frame steps there is no uniform block either: the per-frame function only fills the header's
// environment and shades every LED, and pixel state lives in an array that keeps one set of state layers per LED.
import { glsl, stateLayers } from './glsl'
import { GraphError, shapeOf, type Program } from './program'

export interface CppOptions {
  /** LEDs the usermod drives; pixel state is kept per LED, so it sizes the state array. */
  leds: number
}

export function cpp(program: Program, options: CppOptions): string {
  return ['#include "wledtoy.h"', '', 'namespace wledtoy {', '', cppDefinitions(program, options), '}', ''].join('\n')
}

/** The program's globals and functions without the include and namespace around them, so several fit in one unit. */
export function cppDefinitions(program: Program, { leds }: CppOptions): string {
  rejectFrameSteps(program)
  const shader = glsl(program)
  if (shader.error) throw shader.errorNode ? new GraphError(shader.error, shader.errorNode) : new Error(shader.error)
  rejectGlslOnly(program)
  const layers = stateLayers(program)
  const state = layers ? [`vec4 pixelState[ledCount][${layers}] = {};`] : []
  return [`constexpr int ledCount = ${leds};`, ...state, cppSource(pixelStateReads(shader.code)), ...RENDER_FRAME].join('\n')
}

function rejectFrameSteps(program: Program): void {
  const step = program.frame[0]
  if (!step) return
  const title = shapeOf(program.nodes[step.nodeId]).title
  throw new GraphError(`${title} runs once per frame in JavaScript, which the C++ backend cannot run`, step.nodeId)
}

function rejectGlslOnly(program: Program): void {
  const node = Object.values(program.nodes).find((n) => n.requires?.includes('glsl'))
  if (node) throw new GraphError(`${shapeOf(node).title} samples a texture or takes a derivative, which C++ has no pixels for`, node.id)
}

/**
 * GLSL keeps pixel state in render targets loaded from last frame's texture; here each layer is that LED's entry in
 * `pixelState`, so a slot the body leaves alone keeps its value. A slot of several floats goes through the header's
 * `stateSlot`, since C++ cannot assign to a run of components.
 */
function pixelStateReads(code: string): string {
  return code
    .replace(/^(uniform highp sampler2DArray iState;|layout\(location = \d+\) out vec4 outState\d+;)\n/gm, '')
    .replace(/^ {2}(outState\d+) = texelFetch\(iState, ivec3\(gl_FragCoord\.xy, (\d+)\), 0\);$/gm, '  [[maybe_unused]] vec4& $1 = pixelState[int(ledIndex)][$2];')
    .replace(/\b(outState\d+)\.([xyzw]{2,4})\b/g, (_, layer: string, run: string) => `stateSlot<vec${run.length}>{${layer}, ${'xyzw'.indexOf(run[0])}}`)
}

// C++ spells a GLSL `out` parameter as a reference. A node variable (`n_` prefix) holds an output whether or not
// anything reads it, so only a stray local of a body or chunk is reported as unused.
// These rewrites match text across the whole source, which is sound only because bodies emit no string literals, so `out float ` can only be a parameter.
export const cppSource = (code: string) =>
  code.replace(/\bout\s+(float|int|vec[234])\s/g, '$1& ').replace(/\b(float|int|vec[234]) (n_\w+)(?=\s*[=;])/g, '[[maybe_unused]] $1 $2')

// the LED pass of the GLSL prelude's main(): each LED shaded where it sits, or along the scanline without a layout
const RENDER_FRAME = [
  '',
  'void renderFrame(float time, int frameIndex, vec3* colors) {',
  '  iTime = time;',
  '  iFrame = frameIndex;',
  '  iLedCount = float(ledCount);',
  '  iResolution = vec3(float(ledCount), 1.0f, 1.0f);',
  '  for (int i = 0; i < ledCount; i++) {',
  '    float ledIndex = float(i);',
  '    vec2 uv = iLayoutCount > 0.5f ? vec2(ledLayout(ledIndex).xy) : vec2((ledIndex + 0.5f) / iLedCount, iScanY);',
  '    vec4 c(0.0f, 0.0f, 0.0f, 1.0f);',
  '    mainImage(c, uv, ledIndex);',
  '    colors[i] = clamp(vec3(c.xyz), 0.0f, 1.0f);',
  '  }',
  '}',
  '',
]
